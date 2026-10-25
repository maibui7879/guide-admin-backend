import { MigrationInterface, QueryRunner } from 'typeorm';
export class ReliableEvents1792800012000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE outbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
      event_type varchar(64) NOT NULL,aggregate_id uuid NOT NULL,payload jsonb NOT NULL DEFAULT '{}',transaction_id bigint NOT NULL DEFAULT txid_current(),
      state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatching','dispatched','completed','failed')),
      dispatch_attempts integer NOT NULL DEFAULT 0 CHECK(dispatch_attempts>=0),next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz,
      error_code varchar(64),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
      UNIQUE(event_type,aggregate_id,transaction_id),CHECK(jsonb_typeof(payload)='object'))`);
    await r.query(
      `CREATE INDEX ix_outbox_pending ON outbox_events(next_attempt_at,created_at,id) WHERE state IN ('pending','dispatching','dispatched')`,
    );
    await r.query(`CREATE INDEX ix_outbox_game ON outbox_events(game_id,created_at,id)`);
    await r.query(
      `CREATE TABLE processed_events (event_id uuid PRIMARY KEY REFERENCES outbox_events(id) ON DELETE RESTRICT,processed_at timestamptz NOT NULL DEFAULT now())`,
    );
    await r.query(
      `CREATE TABLE game_content_versions (game_id uuid PRIMARY KEY REFERENCES games(id) ON DELETE RESTRICT,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),updated_at timestamptz NOT NULL DEFAULT now())`,
    );
    await r.query(`CREATE TABLE editorial_review_flags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
      event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,content_id uuid,strategy_id uuid,
      reason varchar(32) NOT NULL CHECK(reason IN ('character_updated','patch_released')),game_version_id uuid,
      status varchar(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      resolved_at timestamptz,resolution_note varchar(1000),created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(content_id,game_id) REFERENCES contents(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(strategy_id,game_id) REFERENCES strategy_pages(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(game_version_id,game_id) REFERENCES game_versions(id,game_id) ON DELETE RESTRICT,
      CHECK((content_id IS NULL)<>(strategy_id IS NULL)),
      CHECK((status='open' AND resolved_by IS NULL AND resolved_at IS NULL) OR (status='resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)))`);
    await r.query(
      `CREATE UNIQUE INDEX uq_review_content_event ON editorial_review_flags(event_id,content_id) WHERE content_id IS NOT NULL`,
    );
    await r.query(
      `CREATE UNIQUE INDEX uq_review_strategy_event ON editorial_review_flags(event_id,strategy_id) WHERE strategy_id IS NOT NULL`,
    );
    await r.query(
      `CREATE INDEX ix_review_queue ON editorial_review_flags(game_id,status,created_at,id)`,
    );
    await r.query(`CREATE FUNCTION capture_domain_event() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE game uuid; aggregate uuid; event_name text; info jsonb; source_row jsonb;
      BEGIN
        IF TG_TABLE_NAME='publications' THEN
          source_row=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
          aggregate=(source_row->>'content_id')::uuid;SELECT game_id INTO game FROM contents WHERE id=aggregate;
          event_name=CASE WHEN TG_OP='DELETE' THEN 'content.unpublished' ELSE 'content.published' END;info=jsonb_build_object('revision',source_row->'revision');
        ELSIF TG_TABLE_NAME='characters' THEN
          game=NEW.game_id;aggregate=NEW.id;event_name='character.updated';
          info=jsonb_build_object('table','characters','operation',TG_OP);
        ELSIF TG_TABLE_NAME='game_versions' THEN
          IF NEW.status<>'published' THEN RETURN NEW;END IF;
          IF TG_OP='UPDATE' THEN IF OLD.status='published' THEN RETURN NEW;END IF;END IF;
          game=NEW.game_id;aggregate=NEW.id;event_name='game.patch.released';info=jsonb_build_object('version',NEW.version);
        ELSIF TG_TABLE_NAME='strategy_pages' THEN
          IF NEW.published_revision IS NOT DISTINCT FROM OLD.published_revision THEN RETURN NEW;END IF;
          game=NEW.game_id;aggregate=NEW.id;event_name=CASE WHEN NEW.published_revision IS NULL THEN 'strategy.unpublished' ELSE 'strategy.published' END;
          info=jsonb_build_object('revision',NEW.published_revision);
        ELSE
          source_row=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
          aggregate=(source_row->>'character_id')::uuid;SELECT game_id INTO game FROM characters WHERE id=aggregate;
          event_name='character.updated';info=jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP);
        END IF;
        IF game IS NOT NULL THEN INSERT INTO outbox_events(game_id,event_type,aggregate_id,payload) VALUES(game,event_name,aggregate,info) ON CONFLICT(event_type,aggregate_id,transaction_id) DO NOTHING;END IF;
        IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
      END $$`);
    await r.query(
      `CREATE TRIGGER tr_publication_event AFTER INSERT OR UPDATE OR DELETE ON publications FOR EACH ROW EXECUTE FUNCTION capture_domain_event()`,
    );
    await r.query(
      `CREATE TRIGGER tr_character_event AFTER INSERT OR UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION capture_domain_event()`,
    );
    for (const table of [
      'character_aliases',
      'character_stats',
      'skills',
      'character_talents',
      'character_potentials',
    ])
      await r.query(
        `CREATE TRIGGER tr_character_child_event AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION capture_domain_event()`,
      );
    await r.query(
      `CREATE TRIGGER tr_patch_event AFTER INSERT OR UPDATE ON game_versions FOR EACH ROW EXECUTE FUNCTION capture_domain_event()`,
    );
    await r.query(
      `CREATE TRIGGER tr_strategy_event AFTER UPDATE ON strategy_pages FOR EACH ROW EXECUTE FUNCTION capture_domain_event()`,
    );
    for (const table of [
      'outbox_events',
      'processed_events',
      'game_content_versions',
      'editorial_review_flags',
    ])
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TRIGGER tr_strategy_event ON strategy_pages');
    await r.query('DROP TRIGGER tr_patch_event ON game_versions');
    for (const table of [
      'character_aliases',
      'character_stats',
      'skills',
      'character_talents',
      'character_potentials',
    ])
      await r.query(`DROP TRIGGER tr_character_child_event ON ${table}`);
    await r.query('DROP TRIGGER tr_character_event ON characters');
    await r.query('DROP TRIGGER tr_publication_event ON publications');
    await r.query('DROP FUNCTION capture_domain_event()');
    await r.query(
      'DROP TABLE editorial_review_flags,processed_events,game_content_versions,outbox_events',
    );
  }
}
