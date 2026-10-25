import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { parseInput } from '../../common/validation/parse-input';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
import type { Principal } from '../auth/services/auth.service';
import { ContentAccessService } from '../guides/services/content-access.service';
import { CatalogWriterService, characterInput } from '../catalog/services/catalog-writer.service';
import { expectedVersionInput } from '../strategy/domain/strategy-input';
const stageInput = z
  .object({
    idempotencyKey: z.uuid(),
    gameVersionId: z.uuid().nullable().default(null),
    sourceUrl: z.url().startsWith('https://').max(2048),
    records: z
      .array(z.object({ id: z.uuid().optional(), input: characterInput }).strict())
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((v, ctx) => {
    const slugs = v.records.map((r) => r.input.slug),
      ids = v.records.flatMap((r) => (r.id ? [r.id] : []));
    if (new Set(slugs).size !== slugs.length || new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate import targets' });
  });
type StagedRecord = { id?: string; input: z.infer<typeof characterInput>; baseline: unknown };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const batchFields = `id,game_id AS "gameId",game_version_id AS "gameVersionId",source_url AS "sourceUrl",state,version,checksum,created_at AS "createdAt",applied_at AS "appliedAt",result`;
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
    private readonly writer: CatalogWriterService,
  ) {}
  private async snapshot(m: EntityManager, game: string, id: string) {
    const [r] = await m.query(
      `SELECT jsonb_build_object('profile',to_jsonb(c),
      'aliases',(SELECT coalesce(jsonb_agg(a ORDER BY a.position),'[]') FROM character_aliases a WHERE a.character_id=c.id),
      'stats',(SELECT coalesce(jsonb_agg(s ORDER BY s.position),'[]') FROM character_stats s WHERE s.character_id=c.id),
      'skills',(SELECT coalesce(jsonb_agg(s ORDER BY s.position),'[]') FROM skills s WHERE s.character_id=c.id),
      'talents',(SELECT coalesce(jsonb_agg(t ORDER BY t.id),'[]') FROM character_talents t WHERE t.character_id=c.id),
      'potentials',(SELECT coalesce(jsonb_agg(p ORDER BY p.id),'[]') FROM character_potentials p WHERE p.character_id=c.id)) AS snapshot FROM characters c WHERE c.id=$1 AND c.game_id=$2`,
      [id, game],
    );
    return r?.snapshot ?? null;
  }
  async stage(actor: Principal, game: string, input: unknown) {
    const v = parseInput(stageInput, input),
      checksum = hash(v);
    return this.db.transaction(async (m) => {
      await this.access.assert(m, actor, game, ['catalog:write']);
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [game + ':' + v.idempotencyKey]);
      const [prior] = await m.query(
        `SELECT ${batchFields} FROM import_batches WHERE game_id=$1 AND idempotency_key=$2`,
        [game, v.idempotencyKey],
      );
      if (prior) {
        if (prior.checksum !== checksum)
          throw new ConflictException('Idempotency key was used with different input');
        return { data: prior };
      }
      if (
        v.gameVersionId &&
        !(
          await m.query('SELECT id FROM game_versions WHERE id=$1 AND game_id=$2', [
            v.gameVersionId,
            game,
          ])
        ).length
      )
        throw new BadRequestException('Invalid game version');
      const records: StagedRecord[] = [];
      for (const record of v.records) {
        const baseline = record.id ? await this.snapshot(m, game, record.id) : null;
        if (record.id && !baseline)
          throw new BadRequestException('Character is missing or belongs to another game');
        if (
          !record.id &&
          (
            await m.query('SELECT id FROM characters WHERE game_id=$1 AND slug=$2', [
              game,
              record.input.slug,
            ])
          ).length
        )
          throw new ConflictException('Existing characters require an explicit update ID');
        records.push({ ...record, baseline });
      }
      const [row] = await m.query(
        `INSERT INTO import_batches(id,game_id,idempotency_key,checksum,game_version_id,source_url,created_by,records) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING ${batchFields}`,
        [
          randomUUID(),
          game,
          v.idempotencyKey,
          checksum,
          v.gameVersionId,
          v.sourceUrl,
          actor.id,
          JSON.stringify(records),
        ],
      );
      return { data: row };
    });
  }
  async get(actor: Principal, game: string, id: string) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.access.assert(m, actor, game, ['catalog:write']);
      const [row] = await m.query(
        `SELECT ${batchFields},records FROM import_batches WHERE id=$1 AND game_id=$2`,
        [id, game],
      );
      if (!row) throw new NotFoundException('Import batch not found');
      return { data: row };
    });
  }
  async list(actor: Principal, game: string, q: PaginationQuery) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.access.assert(m, actor, game, ['catalog:write']);
      const [{ total }] = await m.query(
        'SELECT count(*)::int AS total FROM import_batches WHERE game_id=$1',
        [game],
      );
      const data = await m.query(
        `SELECT ${batchFields} FROM import_batches WHERE game_id=$1 ORDER BY created_at DESC,id ASC LIMIT $2 OFFSET $3`,
        [game, q.limit, (q.page - 1) * q.limit],
      );
      return {
        data,
        meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      };
    });
  }
  async apply(actor: Principal, game: string, id: string, input: unknown, cancel = false) {
    const { expectedVersion } = parseInput(expectedVersionInput, input);
    return this.db.transaction(async (m) => {
      await this.access.assert(m, actor, game, ['catalog:write']);
      const [batch] = await m.query(
        'SELECT * FROM import_batches WHERE id=$1 AND game_id=$2 FOR UPDATE',
        [id, game],
      );
      if (!batch) throw new NotFoundException('Import batch not found');
      if (!cancel && batch.state === 'applied' && batch.version === expectedVersion + 1)
        return { data: { id, state: 'applied', version: batch.version, result: batch.result } };
      if (batch.state !== 'staged' || batch.version !== expectedVersion)
        throw new ConflictException('Import changed or is no longer staged');
      const results: string[] = [];
      if (!cancel) {
        const records = batch.records as StagedRecord[];
        const ids = records.flatMap((r) => (r.id ? [r.id] : [])).sort();
        if (ids.length)
          await m.query(
            'SELECT id FROM characters WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
            [ids],
          );
        for (const record of records) {
          const before = record.id ? await this.snapshot(m, game, record.id) : null;
          if (hash(before) !== hash(record.baseline))
            throw new ConflictException(
              'Character changed since staging; create a new import batch',
            );
          const character = await this.writer.writeCharacter(
            game,
            record.input,
            record.id,
            undefined,
            m,
          );
          const after = await this.snapshot(m, game, character.id);
          results.push(character.id);
          await m.query(
            'INSERT INTO patch_diffs(id,batch_id,game_id,game_version_id,character_id,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
            [
              randomUUID(),
              id,
              game,
              batch.game_version_id,
              character.id,
              JSON.stringify(before),
              JSON.stringify(after),
            ],
          );
        }
      }
      await m.query(
        "UPDATE import_batches SET state=$3::varchar,version=version+1,result=$4::jsonb,applied_at=CASE WHEN $3::varchar='applied' THEN now() ELSE NULL END WHERE id=$1 AND game_id=$2",
        [id, game, cancel ? 'cancelled' : 'applied', JSON.stringify(results)],
      );
      return {
        data: {
          id,
          state: cancel ? 'cancelled' : 'applied',
          version: expectedVersion + 1,
          result: results,
        },
      };
    });
  }
  async diffs(actor: Principal, game: string, q: PaginationQuery) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.access.assert(m, actor, game, ['catalog:write', 'content:review']);
      const [{ total }] = await m.query(
        'SELECT count(*)::int AS total FROM patch_diffs WHERE game_id=$1',
        [game],
      );
      const data = await m.query(
        'SELECT id,batch_id AS "batchId",game_version_id AS "gameVersionId",character_id AS "characterId",before_snapshot AS "before",after_snapshot AS "after",created_at AS "createdAt" FROM patch_diffs WHERE game_id=$1 ORDER BY created_at DESC,id ASC LIMIT $2 OFFSET $3',
        [game, q.limit, (q.page - 1) * q.limit],
      );
      return {
        data,
        meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      };
    });
  }
}
