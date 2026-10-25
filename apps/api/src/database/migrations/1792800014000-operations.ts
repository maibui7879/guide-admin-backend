import { MigrationInterface, QueryRunner } from 'typeorm';
export class Operations1792800014000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE TABLE worker_heartbeats(id uuid PRIMARY KEY,started_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz)`,
    );
    await r.query('ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY');
    await r.query('CREATE INDEX ix_worker_last_seen ON worker_heartbeats(last_seen_at)');
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE worker_heartbeats');
  }
}
