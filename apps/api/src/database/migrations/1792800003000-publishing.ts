import { MigrationInterface, QueryRunner } from 'typeorm';

export class Publishing1792800003000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE contents (
      id uuid CONSTRAINT pk_contents PRIMARY KEY,
      game_id uuid NOT NULL, slug varchar(100) NOT NULL, content_type varchar(16) NOT NULL DEFAULT 'guide',
      author_id uuid NOT NULL, state varchar(16) NOT NULL DEFAULT 'draft',
      version integer NOT NULL DEFAULT 1, current_revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_contents_game FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE RESTRICT,
      CONSTRAINT fk_contents_author FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT uq_contents_game_slug UNIQUE(game_id,slug),
      CONSTRAINT ck_contents_slug CHECK(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      CONSTRAINT ck_contents_type CHECK(content_type='guide'),
      CONSTRAINT ck_contents_state CHECK(state IN ('draft','in_review','approved','published','archived')),
      CONSTRAINT ck_contents_version CHECK(version>0 AND current_revision>0 AND version>=current_revision))`);
    await r.query('CREATE INDEX ix_contents_author ON contents(author_id)');
    await r.query('CREATE INDEX ix_contents_admin ON contents(game_id,state,updated_at,id)');
    await r.query(`CREATE TABLE content_revisions (
      content_id uuid NOT NULL, revision integer NOT NULL, author_id uuid NOT NULL, derived_from integer,
      title varchar(150) NOT NULL, description varchar(500) NOT NULL, category varchar(50) NOT NULL,
      schema_version smallint NOT NULL DEFAULT 1, body jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]',
      reading_minutes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_content_revisions PRIMARY KEY(content_id,revision),
      CONSTRAINT fk_revisions_content FOREIGN KEY(content_id) REFERENCES contents(id) ON DELETE RESTRICT,
      CONSTRAINT fk_revisions_author FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_revisions_source FOREIGN KEY(content_id,derived_from) REFERENCES content_revisions(content_id,revision) ON DELETE RESTRICT,
      CONSTRAINT ck_revisions_version CHECK(revision>0 AND (derived_from IS NULL OR derived_from<revision)),
      CONSTRAINT ck_revisions_document CHECK(schema_version=1 AND jsonb_typeof(body)='object'),
      CONSTRAINT ck_revisions_sources CHECK(jsonb_typeof(sources)='array'),
      CONSTRAINT ck_revisions_reading CHECK(reading_minutes>0))`);
    await r.query('CREATE INDEX ix_revisions_author ON content_revisions(author_id)');
    await r.query('CREATE INDEX ix_revisions_source ON content_revisions(content_id,derived_from)');
    await r.query(`CREATE TABLE publications (
      content_id uuid CONSTRAINT pk_publications PRIMARY KEY, revision integer NOT NULL,
      published_by uuid NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_publications_revision FOREIGN KEY(content_id,revision) REFERENCES content_revisions(content_id,revision) ON DELETE RESTRICT,
      CONSTRAINT fk_publications_actor FOREIGN KEY(published_by) REFERENCES users(id) ON DELETE RESTRICT)`);
    await r.query('CREATE INDEX ix_publications_revision ON publications(content_id,revision)');
    await r.query('CREATE INDEX ix_publications_actor ON publications(published_by)');
    await r.query('CREATE INDEX ix_publications_feed ON publications(published_at,content_id)');
    await r.query(`CREATE TABLE content_relations (
      id uuid CONSTRAINT pk_content_relations PRIMARY KEY, content_id uuid NOT NULL, revision integer NOT NULL,
      character_id uuid, game_version_id uuid,
      CONSTRAINT fk_relations_revision FOREIGN KEY(content_id,revision) REFERENCES content_revisions(content_id,revision) ON DELETE RESTRICT,
      CONSTRAINT fk_relations_character FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE RESTRICT,
      CONSTRAINT fk_relations_patch FOREIGN KEY(game_version_id) REFERENCES game_versions(id) ON DELETE RESTRICT,
      CONSTRAINT ck_relations_target CHECK((character_id IS NOT NULL)::int + (game_version_id IS NOT NULL)::int=1),
      CONSTRAINT uq_relations_character UNIQUE(content_id,revision,character_id),
      CONSTRAINT uq_relations_patch UNIQUE(content_id,revision,game_version_id))`);
    await r.query('CREATE INDEX ix_relations_character ON content_relations(character_id)');
    await r.query('CREATE INDEX ix_relations_patch ON content_relations(game_version_id)');
    await r.query(`CREATE TABLE audit_entries (
      id uuid CONSTRAINT pk_audit_entries PRIMARY KEY, actor_id uuid NOT NULL, content_id uuid NOT NULL,
      action varchar(32) NOT NULL, version integer NOT NULL, revision integer NOT NULL,
      request_id varchar(64) NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_audit_actor FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_audit_content FOREIGN KEY(content_id) REFERENCES contents(id) ON DELETE RESTRICT,
      CONSTRAINT uq_audit_version UNIQUE(content_id,version),
      CONSTRAINT ck_audit_details CHECK(jsonb_typeof(details)='object'))`);
    await r.query('CREATE INDEX ix_audit_actor ON audit_entries(actor_id)');
    await r.query(`CREATE FUNCTION reject_editorial_mutation() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
      BEGIN
        RAISE EXCEPTION 'Editorial snapshots and audit entries are append-only' USING ERRCODE='23514';
      END; $$`);
    await r.query('REVOKE ALL ON FUNCTION reject_editorial_mutation() FROM PUBLIC');
    for (const table of ['content_revisions', 'content_relations', 'audit_entries'])
      await r.query(`CREATE TRIGGER prevent_editorial_mutation BEFORE UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION reject_editorial_mutation()`);
    for (const table of [
      'contents',
      'content_revisions',
      'publications',
      'content_relations',
      'audit_entries',
    ])
      await r.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  }
  async down(r: QueryRunner): Promise<void> {
    for (const table of [
      'audit_entries',
      'content_relations',
      'publications',
      'content_revisions',
      'contents',
    ])
      await r.query(`DROP TABLE "${table}"`);
    await r.query('DROP FUNCTION reject_editorial_mutation()');
  }
}
