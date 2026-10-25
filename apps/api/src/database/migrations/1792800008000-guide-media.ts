import { MigrationInterface, QueryRunner } from 'typeorm';
export class GuideMedia1792800008000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE media_assets (
      id uuid CONSTRAINT pk_media_assets PRIMARY KEY, game_id uuid NOT NULL, uploaded_by uuid NOT NULL,
      storage_key varchar(150) NOT NULL, mime_type varchar(30) NOT NULL, byte_size integer NOT NULL, width integer NOT NULL, height integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_media_game FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE RESTRICT,
      CONSTRAINT fk_media_uploader FOREIGN KEY(uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT uq_media_storage UNIQUE(storage_key), CONSTRAINT uq_media_game_reference UNIQUE(id,game_id),
      CONSTRAINT ck_media_image CHECK(mime_type='image/webp' AND byte_size BETWEEN 1 AND 5242880 AND width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192 AND width::bigint*height<=16777216))`);
    await r.query('CREATE INDEX ix_media_game ON media_assets(game_id,created_at)');
    await r.query('CREATE INDEX ix_media_uploader ON media_assets(uploaded_by)');
    await r.query('CREATE UNIQUE INDEX uq_contents_media_reference ON contents(id,game_id)');
    await r.query(
      `ALTER TABLE content_revisions ADD COLUMN cover_image_id uuid, ADD COLUMN cover_alt varchar(300) NOT NULL DEFAULT '', ADD COLUMN cover_caption varchar(500) NOT NULL DEFAULT '', ADD CONSTRAINT fk_revision_cover FOREIGN KEY(cover_image_id) REFERENCES media_assets(id) ON DELETE RESTRICT`,
    );
    await r.query(`CREATE INDEX ix_revision_cover ON content_revisions(cover_image_id)`);
    await r.query(`CREATE TABLE content_revision_media (
      content_id uuid NOT NULL, revision integer NOT NULL, media_id uuid NOT NULL, game_id uuid NOT NULL,
      CONSTRAINT pk_content_revision_media PRIMARY KEY(content_id,revision,media_id),
      CONSTRAINT fk_revision_media_revision FOREIGN KEY(content_id,revision) REFERENCES content_revisions(content_id,revision) ON DELETE RESTRICT,
      CONSTRAINT fk_revision_media_content_game FOREIGN KEY(content_id,game_id) REFERENCES contents(id,game_id) ON DELETE RESTRICT,
      CONSTRAINT fk_revision_media_asset_game FOREIGN KEY(media_id,game_id) REFERENCES media_assets(id,game_id) ON DELETE RESTRICT)`);
    await r.query(
      'CREATE INDEX ix_revision_media_asset ON content_revision_media(media_id,game_id)',
    );
    await r.query('ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY');
    await r.query('ALTER TABLE content_revision_media ENABLE ROW LEVEL SECURITY');
    await r.query(
      `CREATE TRIGGER tr_revision_media_immutable BEFORE UPDATE OR DELETE ON content_revision_media FOR EACH ROW EXECUTE FUNCTION reject_editorial_mutation()`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE content_revision_media');
    await r.query(
      'ALTER TABLE content_revisions DROP COLUMN cover_image_id, DROP COLUMN cover_alt, DROP COLUMN cover_caption',
    );
    await r.query('DROP INDEX uq_contents_media_reference');
    await r.query('DROP TABLE media_assets');
  }
}
