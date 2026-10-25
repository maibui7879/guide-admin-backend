import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { parseInput } from '../../../common/validation/parse-input';
import type { Principal } from '../../auth/services/auth.service';
import { ContentAccessService } from '../../guides/services/content-access.service';
import {
  createEquipmentInput,
  expectedVersionInput,
  replaceEquipmentInput,
} from '../domain/strategy-input';
import { EquipmentAdminQuery } from '../dto/strategy-query.dto';

const fields = `id,game_id AS "gameId",slug,name,category,rarity,description,image_url AS "imageUrl",source_url AS "sourceUrl",verified_at AS "verifiedAt",status,version,created_at AS "createdAt",updated_at AS "updatedAt"`;
const paging = <T>(data: T[], total: number, query: { page: number; limit: number }) => ({
  data,
  meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
});
@Injectable()
export class EquipmentService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
  ) {}
  async list(game: string, query: EquipmentAdminQuery, actor?: Principal) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const [g] = await manager.query(
        `SELECT id FROM games WHERE ${actor ? 'id=$1::uuid' : 'slug=$1'} AND status='active'`,
        [game],
      );
      if (!g) throw new NotFoundException('Game not found');
      if (actor)
        await this.access.assert(manager, actor, g.id, [
          'catalog:write',
          'catalog:draft:write',
          'content:review',
        ]);
      const where = `FROM equipment WHERE game_id=$1 AND ($2::text IS NULL OR category=$2) AND ($3::text IS NULL OR status=$3)`;
      const args = [g.id, query.category ?? null, actor ? (query.status ?? null) : 'published'];
      const [{ total }] = await manager.query(`SELECT count(*)::int AS total ${where}`, args);
      const rows = await manager.query(
        `SELECT ${fields} ${where} ORDER BY name,id LIMIT $4 OFFSET $5`,
        [...args, query.limit, (query.page - 1) * query.limit],
      );
      return paging(rows, total, query);
    });
  }
  async get(game: string, id: string, actor?: Principal) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const [g] = await manager.query(
        `SELECT id FROM games WHERE ${actor ? 'id=$1::uuid' : 'slug=$1'} AND status='active'`,
        [game],
      );
      if (!g) throw new NotFoundException('Game not found');
      if (actor)
        await this.access.assert(manager, actor, g.id, [
          'catalog:write',
          'catalog:draft:write',
          'content:review',
        ]);
      const [row] = await manager.query(
        `SELECT ${fields} FROM equipment WHERE game_id=$1 AND ${actor ? 'id=$2::uuid' : "slug=$2 AND status='published'"}`,
        [g.id, id],
      );
      if (!row) throw new NotFoundException('Equipment not found');
      return { data: row };
    });
  }
  async create(actor: Principal, gameId: string, input: unknown) {
    const value = parseInput(createEquipmentInput, input);
    try {
      return await this.db.transaction(async (manager) => {
        await this.access.assert(manager, actor, gameId, ['catalog:write', 'catalog:draft:write']);
        const [row] = await manager.query(
          `INSERT INTO equipment(id,game_id,slug,name,category,rarity,description,image_url,source_url,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${fields}`,
          [
            randomUUID(),
            gameId,
            value.slug,
            value.name,
            value.category,
            value.rarity,
            value.description,
            value.imageUrl,
            value.sourceUrl,
            value.verifiedAt,
          ],
        );
        return { data: row };
      });
    } catch (error) {
      if ((error as { driverError?: { code: string } }).driverError?.code === '23505')
        throw new ConflictException('Equipment slug already exists');
      throw error;
    }
  }
  async mutate(
    actor: Principal,
    gameId: string,
    id: string,
    action: 'edit' | 'publish' | 'archive',
    input: unknown,
  ) {
    const editValue = action === 'edit' ? parseInput(replaceEquipmentInput, input) : null;
    const value = editValue ?? parseInput(expectedVersionInput, input);
    return this.db.transaction(async (manager) => {
      await this.access.assert(
        manager,
        actor,
        gameId,
        action === 'edit' ? ['catalog:write', 'catalog:draft:write'] : ['content:publish'],
      );
      const [row] = await manager.query(
        'SELECT id,status,version FROM equipment WHERE id=$1 AND game_id=$2 FOR UPDATE',
        [id, gameId],
      );
      if (!row) throw new NotFoundException('Equipment not found');
      if (row.version !== value.expectedVersion || row.status === 'archived')
        throw new ConflictException('Equipment changed or archived');
      if (editValue) {
        const [[updated]] = await manager.query(
          `UPDATE equipment SET name=$3,category=$4,rarity=$5,description=$6,image_url=$7,source_url=$8,verified_at=$9,status='draft',version=version+1,updated_at=now() WHERE id=$1 AND game_id=$2 RETURNING ${fields}`,
          [
            id,
            gameId,
            editValue.name,
            editValue.category,
            editValue.rarity,
            editValue.description,
            editValue.imageUrl,
            editValue.sourceUrl,
            editValue.verifiedAt,
          ],
        );
        return { data: updated };
      }
      const [[updated]] = await manager.query(
        `UPDATE equipment SET status=$3,version=version+1,updated_at=now() WHERE id=$1 AND game_id=$2 RETURNING ${fields}`,
        [id, gameId, action === 'publish' ? 'published' : 'archived'],
      );
      return { data: updated };
    });
  }
}
