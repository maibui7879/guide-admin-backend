import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { parseInput } from '../../../common/validation/parse-input';
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';
import type { Principal } from '../../auth/services/auth.service';
import { ContentAccessService } from '../../guides/services/content-access.service';
import {
  createBuildInput,
  createTierInput,
  expectedVersionInput,
  replaceBuildInput,
  replaceTierInput,
  StrategyKind,
  StrategyPayload,
} from '../domain/strategy-input';
import { StrategyAdminQuery } from '../dto/strategy-query.dto';
import { z } from 'zod';

interface Head {
  id: string;
  game_id: string;
  kind: StrategyKind;
  slug: string;
  character_id: string | null;
  state: string;
  version: number;
  current_revision: number;
  published_revision: number | null;
}
const present = (h: Head) => ({
  id: h.id,
  gameId: h.game_id,
  kind: h.kind,
  slug: h.slug,
  characterId: h.character_id,
  state: h.state,
  version: h.version,
  currentRevision: h.current_revision,
  publishedRevision: h.published_revision,
});
const publicShape = (h: Head) => ({
  id: h.id,
  gameId: h.game_id,
  kind: h.kind,
  slug: h.slug,
  characterId: h.character_id,
});
const paging = <T>(data: T[], total: number, q: PaginationQuery) => ({
  data,
  meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
});
export const availableStrategy = `g.status='active' AND s.state<>'archived' AND s.published_revision IS NOT NULL
 AND (s.character_id IS NULL OR EXISTS(SELECT 1 FROM characters pc WHERE pc.id=s.character_id AND pc.status='published'))
 AND (r.game_version_id IS NULL OR EXISTS(SELECT 1 FROM game_versions pv WHERE pv.id=r.game_version_id AND pv.status='published'))
 AND NOT EXISTS(SELECT 1 FROM strategy_references ref LEFT JOIN equipment e ON e.id=ref.equipment_id LEFT JOIN characters ch ON ch.id=ref.character_id
   WHERE ref.page_id=s.id AND ref.revision=r.revision AND ((ref.equipment_id IS NOT NULL AND e.status<>'published') OR (ref.character_id IS NOT NULL AND ch.status<>'published')))`;

@Injectable()
export class StrategyService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
  ) {}
  async list(kind: StrategyKind, game: string, q: StrategyAdminQuery, actor?: Principal) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [g] = await m.query(
        `SELECT id FROM games WHERE ${actor ? 'id=$1::uuid' : 'slug=$1'} AND status='active'`,
        [game],
      );
      if (!g) throw new NotFoundException('Game not found');
      if (actor)
        await this.access.assert(m, actor, g.id, [
          'content:write',
          'content:review',
          'content:publish',
        ]);
      const from = `FROM strategy_pages s JOIN games g ON g.id=s.game_id JOIN strategy_revisions r ON r.page_id=s.id AND r.revision=${actor ? 's.current_revision' : 's.published_revision'}
        WHERE s.game_id=$1 AND s.kind=$2 AND ($3::uuid IS NULL OR s.character_id=$3) AND ${actor ? '($4::text IS NULL OR s.state=$4)' : availableStrategy}`;
      const params: unknown[] = [g.id, kind, q.characterId ?? null];
      if (actor) params.push(q.state ?? null);
      const [{ total }] = await m.query(`SELECT count(*)::int AS total ${from}`, params);
      const limit = params.length + 1,
        offset = limit + 1;
      const rows = await m.query(
        `SELECT s.*,r.revision,r.payload ${from} ORDER BY s.updated_at DESC,s.id ASC LIMIT $${limit} OFFSET $${offset}`,
        [...params, q.limit, (q.page - 1) * q.limit],
      );
      return paging(
        rows.map((h: Head & { revision: number; payload: StrategyPayload }) => ({
          ...(actor ? present(h) : publicShape(h)),
          revision: h.revision,
          payload: h.payload,
        })),
        total,
        q,
      );
    });
  }
  async get(kind: StrategyKind, game: string, id: string, actor?: Principal) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [h] = await m.query(
        `SELECT s.*,r.revision,r.payload FROM strategy_pages s JOIN games g ON g.id=s.game_id JOIN strategy_revisions r ON r.page_id=s.id AND r.revision=${actor ? 's.current_revision' : 's.published_revision'}
        WHERE ${actor ? 's.game_id=$1::uuid AND s.id=$2::uuid' : 'g.slug=$1 AND s.slug=$2'} AND s.kind=$3 AND ${actor ? "g.status='active'" : availableStrategy}`,
        [game, id, kind],
      );
      if (!h) throw new NotFoundException('Strategy page not found');
      if (actor)
        await this.access.assert(m, actor, h.game_id, [
          'content:write',
          'content:review',
          'content:publish',
        ]);
      return {
        data: {
          ...(actor ? present(h) : publicShape(h)),
          revision: h.revision,
          payload: h.payload,
        },
      };
    });
  }
  async create(actor: Principal, gameId: string, kind: StrategyKind, input: unknown) {
    const v =
      kind === 'build' ? parseInput(createBuildInput, input) : parseInput(createTierInput, input);
    try {
      return await this.db.transaction(async (m) => {
        await this.access.assert(m, actor, gameId, ['content:write']);
        await this.validate(
          m,
          { game_id: gameId, character_id: 'characterId' in v ? v.characterId : null } as Head,
          v.payload,
        );
        const id = randomUUID();
        const [h] = await m.query(
          `INSERT INTO strategy_pages(id,game_id,kind,slug,character_id,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [id, gameId, kind, v.slug, 'characterId' in v ? v.characterId : null, actor.id],
        );
        await this.snapshot(m, h, v.payload, actor);
        await this.audit(m, h, actor, 'created');
        return { data: present(h) };
      });
    } catch (error) {
      if ((error as { driverError?: { code: string } }).driverError?.code === '23505')
        throw new ConflictException('Strategy slug already exists');
      throw error;
    }
  }
  async edit(actor: Principal, gameId: string, kind: StrategyKind, id: string, input: unknown) {
    const v =
      kind === 'build' ? parseInput(replaceBuildInput, input) : parseInput(replaceTierInput, input);
    return this.change(actor, gameId, kind, id, v.expectedVersion, 'edited', async (m, h) => {
      h.current_revision++;
      h.state = 'draft';
      await this.snapshot(m, h, v.payload, actor);
    });
  }
  async command(
    actor: Principal,
    gameId: string,
    kind: StrategyKind,
    id: string,
    action: 'publish' | 'unpublish' | 'archive' | 'restore',
    input: unknown,
  ) {
    const v =
      action === 'restore'
        ? parseInput(
            expectedVersionInput
              .extend({ sourceRevision: z.number().int().positive().max(2147483647) })
              .strict(),
            input,
          )
        : parseInput(expectedVersionInput, input);
    return this.change(actor, gameId, kind, id, v.expectedVersion, action, async (m, h) => {
      if (action === 'publish') {
        const [r] = await m.query(
          'SELECT payload FROM strategy_revisions WHERE page_id=$1 AND revision=$2',
          [id, h.current_revision],
        );
        await this.validate(m, h, r.payload, true);
        h.published_revision = h.current_revision;
        h.state = 'published';
      } else if (action === 'unpublish') {
        if (h.published_revision === null) throw new ConflictException('No publication exists');
        h.published_revision = null;
        h.state = 'draft';
      } else if (action === 'archive') {
        h.published_revision = null;
        h.state = 'archived';
      } else if ('sourceRevision' in v) {
        const [r] = await m.query(
          'SELECT payload FROM strategy_revisions WHERE page_id=$1 AND revision=$2',
          [id, v.sourceRevision],
        );
        if (!r) throw new NotFoundException('Revision not found');
        h.current_revision++;
        h.state = 'draft';
        await this.snapshot(m, h, r.payload, actor);
      }
    });
  }
  async history(
    actor: Principal,
    gameId: string,
    kind: StrategyKind,
    id: string,
    q: PaginationQuery,
  ) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.access.assert(m, actor, gameId, [
        'content:write',
        'content:review',
        'content:publish',
      ]);
      if (
        !(
          await m.query('SELECT id FROM strategy_pages WHERE id=$1 AND game_id=$2 AND kind=$3', [
            id,
            gameId,
            kind,
          ])
        ).length
      )
        throw new NotFoundException('Strategy page not found');
      const [{ total }] = await m.query(
        'SELECT count(*)::int AS total FROM strategy_revisions WHERE page_id=$1',
        [id],
      );
      const rows = await m.query(
        'SELECT revision,author_id AS "authorId",game_version_id AS "gameVersionId",payload,created_at AS "createdAt" FROM strategy_revisions WHERE page_id=$1 ORDER BY revision DESC LIMIT $2 OFFSET $3',
        [id, q.limit, (q.page - 1) * q.limit],
      );
      return paging(rows, total, q);
    });
  }
  private async change(
    actor: Principal,
    gameId: string,
    kind: StrategyKind,
    id: string,
    version: number,
    action: string,
    change: (m: EntityManager, h: Head) => Promise<void>,
  ) {
    return this.db.transaction(async (m) => {
      await this.access.assert(
        m,
        actor,
        gameId,
        ['edited', 'restore'].includes(action) ? ['content:write'] : ['content:publish'],
      );
      const [h] = await m.query<Head[]>(
        'SELECT * FROM strategy_pages WHERE id=$1 AND game_id=$2 AND kind=$3 FOR UPDATE',
        [id, gameId, kind],
      );
      if (!h) throw new NotFoundException('Strategy page not found');
      if (h.version !== version || h.state === 'archived')
        throw new ConflictException('Strategy changed or archived');
      await change(m, h);
      h.version++;
      await m.query(
        'UPDATE strategy_pages SET current_revision=$2,published_revision=$3,state=$4,version=$5,updated_at=now() WHERE id=$1',
        [id, h.current_revision, h.published_revision, h.state, h.version],
      );
      await this.audit(m, h, actor, action);
      return { data: present(h) };
    });
  }
  private async audit(m: EntityManager, h: Head, actor: Principal, action: string) {
    await m.query(
      'INSERT INTO strategy_audit(id,page_id,actor_id,version,action) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), h.id, actor.id, h.version, action],
    );
  }
  private refs(payload: StrategyPayload) {
    return 'recommendations' in payload
      ? {
          equipment: [...new Set(payload.recommendations.map((r) => r.equipmentId))],
          characters: [] as string[],
        }
      : {
          equipment: [] as string[],
          characters: payload.categories.flatMap((c) => c.entries.map((e) => e.characterId)),
        };
  }
  private async validate(m: EntityManager, h: Head, payload: StrategyPayload, published = false) {
    const refs = this.refs(payload);
    const characters = [
      ...new Set([...refs.characters, ...(h.character_id ? [h.character_id] : [])]),
    ].sort();
    for (const [table, ids] of [
      ['equipment', refs.equipment.sort()],
      ['characters', characters],
    ] as const) {
      if (!ids.length) continue;
      const rows = await m.query(
        `SELECT id FROM ${table} WHERE game_id=$1 AND id=ANY($2::uuid[]) ${published ? "AND status='published'" : "AND status<>'archived'"} ORDER BY id FOR SHARE`,
        [h.game_id, ids],
      );
      if (rows.length !== ids.length)
        throw new BadRequestException(
          'Referenced record is missing, unavailable or belongs to another game',
        );
    }
    if (
      payload.gameVersionId &&
      !(
        await m.query(
          `SELECT id FROM game_versions WHERE id=$1 AND game_id=$2 ${published ? "AND status='published'" : ''} FOR SHARE`,
          [payload.gameVersionId, h.game_id],
        )
      ).length
    )
      throw new BadRequestException('Game version is unavailable');
    return refs;
  }
  private async snapshot(m: EntityManager, h: Head, payload: StrategyPayload, actor: Principal) {
    const refs = await this.validate(m, h, payload);
    await m.query(
      'INSERT INTO strategy_revisions(page_id,revision,game_id,author_id,payload,game_version_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
      [
        h.id,
        h.current_revision,
        h.game_id,
        actor.id,
        JSON.stringify(payload),
        payload.gameVersionId,
      ],
    );
    for (const [column, ids] of [
      ['equipment_id', refs.equipment],
      ['character_id', refs.characters],
    ] as const)
      for (const id of ids)
        await m.query(
          `INSERT INTO strategy_references(id,page_id,revision,game_id,${column}) VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), h.id, h.current_revision, h.game_id, id],
        );
  }
}
