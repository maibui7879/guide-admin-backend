import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
export interface OutboxEvent {
  id: string;
  game_id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  dispatch_attempts: number;
  lease_id: string;
  created_at: Date;
}
export interface EventQueue {
  enqueue(eventId: string): Promise<void>;
}
@Injectable()
export class OutboxService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async dispatch(queue: EventQueue, limit = 20): Promise<number> {
    const lease = randomUUID();
    const events = await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE outbox_events SET state='failed',error_code='DISPATCH_EXHAUSTED',lease_id=NULL,lease_until=NULL WHERE dispatch_attempts>=20 AND state IN ('pending','dispatched','dispatching') AND (lease_until IS NULL OR lease_until<now())`,
      );
      const rows = await m.query<OutboxEvent[]>(
        `SELECT * FROM outbox_events WHERE
        ((state IN ('pending','dispatched') AND next_attempt_at<=now()) OR (state='dispatching' AND lease_until<now()))
        AND dispatch_attempts<20 ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      if (rows.length)
        await m.query(
          `UPDATE outbox_events SET state='dispatching',lease_id=$2,lease_until=now()+interval '60 seconds',dispatch_attempts=dispatch_attempts+1 WHERE id=ANY($1::uuid[])`,
          [rows.map((r) => r.id), lease],
        );
      return rows;
    });
    for (const event of events) {
      try {
        await queue.enqueue(event.id);
        await this.db.query(
          `UPDATE outbox_events SET state='dispatched',next_attempt_at=now()+interval '5 minutes',lease_id=NULL,lease_until=NULL,error_code=NULL WHERE id=$1 AND lease_id=$2 AND state='dispatching'`,
          [event.id, lease],
        );
      } catch {
        const attempts = event.dispatch_attempts + 1;
        await this.db.query(
          `UPDATE outbox_events SET state=$3,next_attempt_at=now()+($4::int*interval '1 second'),lease_id=NULL,lease_until=NULL,error_code='QUEUE_UNAVAILABLE' WHERE id=$1 AND lease_id=$2 AND state='dispatching'`,
          [
            event.id,
            lease,
            attempts >= 20 ? 'failed' : 'pending',
            Math.min(300, 2 ** Math.min(attempts, 8)),
          ],
        );
      }
    }
    return events.length;
  }
  async process(id: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const [event] = await m.query<OutboxEvent[]>(
        'SELECT * FROM outbox_events WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!event) throw Error('Outbox event is unavailable');
      if ((await m.query('SELECT event_id FROM processed_events WHERE event_id=$1', [id])).length)
        return;
      const patch = event.event_type === 'game.patch.released',
        character = event.event_type === 'character.updated';
      if (patch || character) {
        const params = [
          event.game_id,
          event.id,
          patch ? 'patch_released' : 'character_updated',
          patch ? event.aggregate_id : null,
          event.aggregate_id,
          event.created_at,
        ];
        await m.query(
          `INSERT INTO editorial_review_flags(game_id,event_id,reason,game_version_id,content_id)
          SELECT c.game_id,$2::uuid,$3::varchar,$4::uuid,c.id FROM contents c WHERE c.game_id=$1 AND c.state<>'archived' AND c.created_at<=$6 AND ($3::varchar='patch_released' OR c.wiki_character_id=$5 OR
            EXISTS(SELECT 1 FROM content_relations rel WHERE rel.content_id=c.id AND rel.character_id=$5) OR
            EXISTS(SELECT 1 FROM teams t WHERE t.id=c.wiki_team_id AND $5 IN (t.main_character_id,t.support_one_id,t.support_two_id))) ON CONFLICT DO NOTHING`,
          params,
        );
        await m.query(
          `INSERT INTO editorial_review_flags(game_id,event_id,reason,game_version_id,strategy_id)
          SELECT s.game_id,$2::uuid,$3::varchar,$4::uuid,s.id FROM strategy_pages s WHERE s.game_id=$1 AND s.state<>'archived' AND s.created_at<=$6 AND ($3::varchar='patch_released' OR s.character_id=$5 OR
            EXISTS(SELECT 1 FROM strategy_references ref WHERE ref.page_id=s.id AND ref.character_id=$5)) ON CONFLICT DO NOTHING`,
          params,
        );
      }
      await m.query(
        `INSERT INTO game_content_versions(game_id,version) VALUES($1,1) ON CONFLICT(game_id) DO UPDATE SET version=game_content_versions.version+1,updated_at=now()`,
        [event.game_id],
      );
      await m.query('INSERT INTO processed_events(event_id) VALUES($1)', [id]);
      await m.query(
        "UPDATE outbox_events SET state='completed',completed_at=now(),lease_id=NULL,lease_until=NULL,error_code=NULL WHERE id=$1",
        [id],
      );
    });
  }
}
