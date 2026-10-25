import { MigrationInterface, QueryRunner } from 'typeorm';

export class MediaLibrary1792800009000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE media_assets ADD COLUMN checksum varchar(64), ADD COLUMN deleted_at timestamptz,
      ADD CONSTRAINT ck_media_checksum CHECK(checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$')`);
    await r.query(`CREATE FUNCTION protect_media_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND (
          EXISTS(SELECT 1 FROM content_revision_media WHERE media_id=NEW.id) OR
          EXISTS(SELECT 1 FROM content_revisions WHERE cover_image_id=NEW.id)
        ) THEN RAISE EXCEPTION 'Referenced media cannot be deleted' USING ERRCODE='23503'; END IF;
        IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
          RAISE EXCEPTION 'Media deletion cannot be reversed' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await r.query(
      `CREATE TRIGGER tr_media_lifecycle BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION protect_media_lifecycle()`,
    );
    await r.query(`CREATE FUNCTION require_available_media() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE asset_id uuid;
      BEGIN
        IF TG_TABLE_NAME='content_revisions' THEN asset_id=NEW.cover_image_id; ELSE asset_id=NEW.media_id; END IF;
        IF asset_id IS NOT NULL THEN
          PERFORM id FROM media_assets WHERE id=asset_id AND deleted_at IS NULL FOR SHARE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Media is unavailable' USING ERRCODE='23503'; END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await r.query(
      `CREATE TRIGGER tr_revision_available_media BEFORE INSERT ON content_revisions FOR EACH ROW EXECUTE FUNCTION require_available_media()`,
    );
    await r.query(
      `CREATE TRIGGER tr_usage_available_media BEFORE INSERT ON content_revision_media FOR EACH ROW EXECUTE FUNCTION require_available_media()`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TRIGGER tr_usage_available_media ON content_revision_media');
    await r.query('DROP TRIGGER tr_revision_available_media ON content_revisions');
    await r.query('DROP FUNCTION require_available_media()');
    await r.query('DROP TRIGGER tr_media_lifecycle ON media_assets');
    await r.query('DROP FUNCTION protect_media_lifecycle()');
    await r.query('ALTER TABLE media_assets DROP COLUMN checksum, DROP COLUMN deleted_at');
  }
}
