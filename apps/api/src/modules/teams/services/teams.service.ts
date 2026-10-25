import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import { Principal } from '../../auth/services/auth.service';
import { CharacterEntity } from '../../catalog/entities/catalog.entities';
import { parseInput } from '../../../common/validation/parse-input';
import {
  createTeamInput,
  deleteTeamInput,
  replaceTeamInput,
  TeamInput,
} from '../domain/team-input';
import { Team, TeamEntity } from '../entities/team.entity';
import { AdminTeamQuery, PublicTeamDto, TeamQuery } from '../dto/team.dto';

export const teamReadPermissions = ['catalog:write', 'catalog:draft:write', 'content:review'];
const publicJoin = `FROM teams t JOIN games g ON g.id=t.game_id
 JOIN characters m ON m.id=t.main_character_id AND m.game_id=t.game_id
 JOIN characters s1 ON s1.id=t.support_one_id AND s1.game_id=t.game_id
 JOIN characters s2 ON s2.id=t.support_two_id AND s2.game_id=t.game_id
 WHERE g.slug=$1 AND g.status='active' AND t.status='published'
 AND m.status='published' AND s1.status='published' AND s2.status='published'`;
const member = (alias: string, role: string) =>
  `jsonb_build_object('role','${role}','characterId',${alias}.id,'slug',${alias}.slug,'name',${alias}.name,'element',${alias}.element,'rarity',${alias}.rarity,'portraitUrl',${alias}.portrait_url)`;
const publicFields = `t.id,t.slug,t.name,t.description,jsonb_build_array(${member('m', 'main')},${member('s1', 'support')},${member('s2', 'support')}) AS members`;
const page = <T>(data: T[], total: number, query: { page: number; limit: number }) => ({
  data,
  meta: { ...query, total, totalPages: Math.ceil(total / query.limit) },
});

@Injectable()
export class TeamsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  async list(game: string, query: TeamQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      if (
        !(await manager.query("SELECT id FROM games WHERE slug=$1 AND status='active'", [game]))
          .length
      )
        throw new NotFoundException('Game not found');
      const filter = `${publicJoin} AND ($2::uuid IS NULL OR $2 IN (t.main_character_id,t.support_one_id,t.support_two_id))`;
      const params = [game, query.characterId ?? null];
      const [{ total }] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total ${filter}`,
        params,
      );
      const rows = await manager.query<PublicTeamDto[]>(
        `SELECT ${publicFields} ${filter} ORDER BY t.name,t.id LIMIT $3 OFFSET $4`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return page(rows, total, { page: query.page, limit: query.limit });
    });
  }

  async get(game: string, slug: string) {
    const [row] = await this.db.query<PublicTeamDto[]>(
      `SELECT ${publicFields} ${publicJoin} AND t.slug=$2`,
      [game, slug],
    );
    if (!row) throw new NotFoundException('Team not found');
    return { data: row };
  }

  async adminList(actor: Principal, gameId: string, query: AdminTeamQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorize(manager, actor, gameId);
      const [rows, total] = await manager.getRepository(TeamEntity).findAndCount({
        where: { gameId, ...(query.status ? { status: query.status } : {}) },
        order: { name: 'ASC', id: 'ASC' },
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      });
      return page(rows.map(this.adminShape), total, { page: query.page, limit: query.limit });
    });
  }

  async adminGet(actor: Principal, gameId: string, id: string) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorize(manager, actor, gameId);
      const row = await manager.getRepository(TeamEntity).findOneBy({ id, gameId });
      if (!row) throw new NotFoundException('Team not found');
      return { data: this.adminShape(row) };
    });
  }

  async create(actor: Principal, gameId: string, input: unknown) {
    const value = parseInput(createTeamInput, input);
    return this.translate(() =>
      this.db.transaction(async (manager) => {
        await this.authorize(manager, actor, gameId, true, value.status);
        await this.validateMembers(
          manager,
          gameId,
          value.mainCharacterId,
          value.supportCharacterIds,
          value.status,
        );
        const row = await manager
          .getRepository(TeamEntity)
          .save({ id: randomUUID(), gameId, ...this.storageFields(value), version: 1 });
        return { data: this.adminShape(row) };
      }),
    );
  }

  async replace(actor: Principal, gameId: string, id: string, input: unknown) {
    const value = parseInput(replaceTeamInput, input);
    return this.translate(() =>
      this.db.transaction(async (manager) => {
        const row = await this.lock(manager, gameId, id);
        await this.authorize(manager, actor, gameId, true, value.status, row.status);
        if (row.version !== value.expectedVersion) throw new ConflictException('Team has changed');
        await this.validateMembers(
          manager,
          gameId,
          value.mainCharacterId,
          value.supportCharacterIds,
          value.status,
        );
        const updated = await manager.getRepository(TeamEntity).save({
          ...row,
          ...this.storageFields(value),
          version: row.version + 1,
          updatedAt: new Date(),
        });
        return { data: this.adminShape(updated) };
      }),
    );
  }

  async remove(actor: Principal, gameId: string, id: string, input: unknown) {
    const value = parseInput(deleteTeamInput, input);
    return this.db.transaction(async (manager) => {
      const row = await this.lock(manager, gameId, id);
      // Editors may archive existing drafts, but may not modify published/archived records.
      await this.authorize(manager, actor, gameId, true, 'draft', row.status);
      if (row.version !== value.expectedVersion) throw new ConflictException('Team has changed');
      if (row.status === 'archived') throw new ConflictException('Team is already archived');
      const updated = await manager
        .getRepository(TeamEntity)
        .save({ ...row, status: 'archived', version: row.version + 1, updatedAt: new Date() });
      return { data: this.adminShape(updated) };
    });
  }

  private async lock(manager: EntityManager, gameId: string, id: string) {
    const row = await manager
      .getRepository(TeamEntity)
      .findOne({ where: { id, gameId }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw new NotFoundException('Team not found');
    return row;
  }

  private async authorize(
    manager: EntityManager,
    actor: Principal,
    gameId: string,
    write = false,
    status = 'draft',
    existing?: string,
  ) {
    const permissions = write ? ['catalog:write', 'catalog:draft:write'] : teamReadPermissions;
    if (!permissions.some((permission) => actor.permissions.includes(permission)))
      throw new ForbiddenException('Insufficient permissions');
    if (
      !(
        await manager.query("SELECT id FROM games WHERE id=$1 AND status='active' FOR SHARE", [
          gameId,
        ])
      ).length
    )
      throw new NotFoundException('Game not found');
    if (actor.permissions.includes('catalog:write')) return;
    if (write && (status !== 'draft' || (existing && existing !== 'draft')))
      throw new ForbiddenException('Editors can only manage drafts');
    if (
      !(
        await manager.query(
          'SELECT 1 FROM user_game_access WHERE user_id=$1 AND game_id=$2 FOR SHARE',
          [actor.id, gameId],
        )
      ).length
    )
      throw new ForbiddenException('Game access required');
  }

  private async validateMembers(
    manager: EntityManager,
    gameId: string,
    main: string,
    supports: string[],
    status: string,
  ) {
    const rows = await manager.getRepository(CharacterEntity).find({
      where: { gameId, id: In([main, ...supports]) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    if (
      rows.length !== 3 ||
      (status === 'published' && rows.some((row) => row.status !== 'published'))
    )
      throw new BadRequestException(
        'Members must belong to the same game; published teams require published characters',
      );
  }

  private storageFields(value: TeamInput) {
    const { slug, name, description, status, mainCharacterId } = value;
    const [supportOneId, supportTwoId] = [...value.supportCharacterIds].sort();
    return { slug, name, description, status, mainCharacterId, supportOneId, supportTwoId };
  }

  private adminShape(row: Team) {
    const { supportOneId, supportTwoId, ...fields } = row;
    return { ...fields, supportCharacterIds: [supportOneId, supportTwoId] };
  }

  private async translate<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const code = (error.driverError as { code?: string }).code;
        if (code === '23505') throw new ConflictException('Team slug or lineup already exists');
        if (code === '23503' || code === '23514')
          throw new BadRequestException('Invalid team members');
      }
      throw error;
    }
  }
}
