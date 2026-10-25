import { MigrationInterface, QueryRunner } from 'typeorm';
const protect = (
  character: boolean,
) => `CREATE OR REPLACE FUNCTION protect_media_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND (
    EXISTS(SELECT 1 FROM content_revision_media WHERE media_id=NEW.id) OR EXISTS(SELECT 1 FROM content_revisions WHERE cover_image_id=NEW.id)
    ${character ? 'OR EXISTS(SELECT 1 FROM character_media WHERE portrait_media_id=NEW.id OR image_media_id=NEW.id)' : ''}
  ) THEN RAISE EXCEPTION 'Referenced media cannot be deleted' USING ERRCODE='23503';END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN RAISE EXCEPTION 'Media deletion cannot be reversed' USING ERRCODE='23514';END IF;RETURN NEW;END $$`;
export class CharacterMedia1792800015000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE character_media (
      character_id uuid PRIMARY KEY,game_id uuid NOT NULL,portrait_media_id uuid,image_media_id uuid,
      portrait_alt varchar(300) NOT NULL DEFAULT '',image_alt varchar(300) NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(character_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(portrait_media_id,game_id) REFERENCES media_assets(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(image_media_id,game_id) REFERENCES media_assets(id,game_id) ON DELETE RESTRICT,
      CHECK(portrait_media_id IS NULL OR char_length(portrait_alt)>0),CHECK(image_media_id IS NULL OR char_length(image_alt)>0))`);
    await r.query(
      'CREATE INDEX ix_character_portrait_media ON character_media(portrait_media_id) WHERE portrait_media_id IS NOT NULL',
    );
    await r.query(
      'CREATE INDEX ix_character_image_media ON character_media(image_media_id) WHERE image_media_id IS NOT NULL',
    );
    await r.query('ALTER TABLE character_media ENABLE ROW LEVEL SECURITY');
    await r.query(protect(true));
    await r.query(`CREATE FUNCTION require_available_character_media() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE asset uuid;BEGIN
      FOR asset IN SELECT DISTINCT unnest(array_remove(ARRAY[NEW.portrait_media_id,NEW.image_media_id],NULL)) ORDER BY 1 LOOP
        PERFORM id FROM media_assets WHERE id=asset AND deleted_at IS NULL FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Media is unavailable' USING ERRCODE='23503';END IF;
      END LOOP;RETURN NEW;END $$`);
    await r.query(
      `CREATE TRIGGER tr_character_media_available BEFORE INSERT OR UPDATE ON character_media FOR EACH ROW EXECUTE FUNCTION require_available_character_media()`,
    );
    await r.query(`CREATE FUNCTION capture_character_media_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF to_regclass('outbox_events') IS NOT NULL THEN
        INSERT INTO outbox_events(game_id,event_type,aggregate_id,payload) VALUES(NEW.game_id,'media.updated',NEW.character_id,'{}') ON CONFLICT(event_type,aggregate_id,transaction_id) DO NOTHING;
      END IF;RETURN NEW;END $$`);
    await r.query(
      `CREATE TRIGGER tr_character_media_event AFTER INSERT OR UPDATE ON character_media FOR EACH ROW EXECUTE FUNCTION capture_character_media_event()`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query(protect(false));
    await r.query('DROP TABLE character_media');
    await r.query('DROP FUNCTION require_available_character_media()');
    await r.query('DROP FUNCTION capture_character_media_event()');
  }
}
