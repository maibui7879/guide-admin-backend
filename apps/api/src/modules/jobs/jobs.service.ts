import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import type { Principal } from '../auth/services/auth.service';
import { ContentAccessService } from '../guides/services/content-access.service';
import { parseInput } from '../../common/validation/parse-input';
import { JobsQuery, ReviewFlagsQuery } from './jobs-query.dto';
const page = <T>(data: T[], total: number, q: { page: number; limit: number }) => ({
  data,
  meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
});
@Injectable()
export class JobsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
  ) {}
  async list(actor: Principal, game: string, q: JobsQuery) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.access.assert(m, actor, game, ['users:manage']);
      const params = [game, q.state ?? null],
        where = 'FROM outbox_events WHERE game_id=$1 AND ($2::text IS NULL OR state=$2)';
      const [{ total }] = await m.query(`SELECT count(*)::int AS total ${where}`, params);
      const rows = await m.query(
        `SELECT id,event_type AS "eventType",aggregate_id AS "aggregateId",state,dispatch_attempts AS "dispatchAttempts",next_attempt_at AS "nextAttemptAt",error_code AS "errorCode",created_at AS "createdAt",completed_at AS "completedAt" ${where} ORDER BY created_at DESC,id ASC LIMIT $3 OFFSET $4`,
        [...params, q.limit, (q.page - 1) * q.limit],
      );
      return page(rows, total, q);
    });
  }
  async replay(actor: Principal, game: string, id: string) {
    return this.db.transaction(async (m) => {
      await this.access.assert(m, actor, game, ['users:manage']);
      const [event] = await m.query(
        'SELECT state FROM outbox_events WHERE id=$1 AND game_id=$2 FOR UPDATE',
        [id, game],
      );
      if (!event) throw new NotFoundException('Event not found');
      if (event.state !== 'failed')
        throw new ConflictException('Only failed events can be replayed');
      await m.query(
        "UPDATE outbox_events SET state='pending',dispatch_attempts=0,next_attempt_at=now(),lease_id=NULL,lease_until=NULL,error_code=NULL WHERE id=$1",
        [id],
      );
      return { data: { id, state: 'pending' } };
    });
  }
  async flags(actor: Principal, game: string, q: ReviewFlagsQuery) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.access.assert(m, actor, game, [
        'content:write',
        'content:review',
        'content:publish',
      ]);
      const where = 'FROM editorial_review_flags WHERE game_id=$1 AND status=$2',
        params = [game, q.status];
      const [{ total }] = await m.query(`SELECT count(*)::int AS total ${where}`, params);
      const data = await m.query(
        `SELECT id,content_id AS "contentId",strategy_id AS "strategyId",reason,game_version_id AS "gameVersionId",status,resolved_by AS "resolvedBy",resolved_at AS "resolvedAt",resolution_note AS "resolutionNote",created_at AS "createdAt" ${where} ORDER BY created_at DESC,id ASC LIMIT $3 OFFSET $4`,
        [...params, q.limit, (q.page - 1) * q.limit],
      );
      return page(data, total, q);
    });
  }
  async resolve(actor: Principal, game: string, id: string, input: unknown) {
    const { note } = parseInput(
      z.object({ note: z.string().trim().min(1).max(1000) }).strict(),
      input,
    );
    return this.db.transaction(async (m) => {
      await this.access.assert(m, actor, game, ['content:review']);
      const [row] = await m.query(
        'SELECT status FROM editorial_review_flags WHERE id=$1 AND game_id=$2 FOR UPDATE',
        [id, game],
      );
      if (!row) throw new NotFoundException('Review flag not found');
      if (row.status !== 'open') throw new ConflictException('Review flag already resolved');
      await m.query(
        "UPDATE editorial_review_flags SET status='resolved',resolved_by=$3,resolved_at=now(),resolution_note=$4 WHERE id=$1 AND game_id=$2",
        [id, game, actor.id, note],
      );
      return { data: { id, status: 'resolved' } };
    });
  }
}
