import { MigrationInterface, QueryRunner } from 'typeorm';
export class ImportStaging1792800013000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE import_batches (
      id uuid PRIMARY KEY,game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,idempotency_key uuid NOT NULL,
      checksum varchar(64) NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),game_version_id uuid,source_url text NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      state varchar(16) NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','applied','cancelled')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),records jsonb NOT NULL,result jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz,
      UNIQUE(game_id,idempotency_key),CHECK(jsonb_typeof(records)='array' AND jsonb_array_length(records) BETWEEN 1 AND 10),
      FOREIGN KEY(game_version_id,game_id) REFERENCES game_versions(id,game_id) ON DELETE RESTRICT)`);
    await r.query(`CREATE INDEX ix_import_game ON import_batches(game_id,created_at,id)`);
    await r.query(`CREATE TABLE patch_diffs (
      id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
      game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,game_version_id uuid,
      character_id uuid NOT NULL,before_snapshot jsonb,after_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(batch_id,character_id),FOREIGN KEY(character_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(game_version_id,game_id) REFERENCES game_versions(id,game_id) ON DELETE RESTRICT)`);
    await r.query(
      `CREATE INDEX ix_patch_diffs_game_version ON patch_diffs(game_id,game_version_id,created_at,id)`,
    );
    await r.query(
      `CREATE TRIGGER tr_patch_diff_immutable BEFORE UPDATE OR DELETE ON patch_diffs FOR EACH ROW EXECUTE FUNCTION reject_editorial_mutation()`,
    );
    await r.query(`CREATE FUNCTION protect_import_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.state<>'staged' OR NEW.records IS DISTINCT FROM OLD.records OR NEW.game_id<>OLD.game_id OR NEW.checksum<>OLD.checksum OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.created_by<>OLD.created_by OR NEW.source_url<>OLD.source_url OR NEW.game_version_id IS DISTINCT FROM OLD.game_version_id
      THEN RAISE EXCEPTION 'Import snapshots are immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$`);
    await r.query(
      `CREATE TRIGGER tr_import_immutable BEFORE UPDATE ON import_batches FOR EACH ROW EXECUTE FUNCTION protect_import_batch()`,
    );
    await r.query('ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY');
    await r.query('ALTER TABLE patch_diffs ENABLE ROW LEVEL SECURITY');
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE patch_diffs,import_batches');
    await r.query('DROP FUNCTION protect_import_batch()');
  }
}
