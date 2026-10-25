import { MigrationInterface, QueryRunner } from 'typeorm';

export class Strategy1792800010000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE UNIQUE INDEX uq_patch_strategy_reference ON game_versions(id,game_id)`);
    await r.query(`CREATE TABLE equipment (
      id uuid PRIMARY KEY,game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
      slug varchar(100) NOT NULL,name varchar(150) NOT NULL,category varchar(16) NOT NULL,
      rarity integer NOT NULL,description text NOT NULL DEFAULT '',image_url text,source_url text,verified_at timestamptz,
      status varchar(16) NOT NULL DEFAULT 'draft',version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(game_id,slug),UNIQUE(id,game_id),CHECK(category IN ('disc','weapon','armor','accessory')),
      CHECK(rarity BETWEEN 1 AND 6),CHECK(version>0),CHECK(status IN ('draft','published','archived')),
      CHECK(char_length(description)<=10000))`);
    await r.query(`CREATE INDEX ix_equipment_browse ON equipment(game_id,status,category,name,id)`);
    await r.query(`CREATE TABLE strategy_pages (
      id uuid PRIMARY KEY,game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
      kind varchar(16) NOT NULL CHECK(kind IN ('build','tier_list')),slug varchar(100) NOT NULL,character_id uuid,
      state varchar(16) NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),current_revision integer NOT NULL DEFAULT 1 CHECK(current_revision>0),published_revision integer,
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(game_id,kind,slug),UNIQUE(id,game_id),
      CHECK((kind='build' AND character_id IS NOT NULL) OR (kind='tier_list' AND character_id IS NULL)),
      FOREIGN KEY(character_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT)`);
    await r.query(
      `CREATE INDEX ix_strategy_queue ON strategy_pages(game_id,kind,state,updated_at,id)`,
    );
    await r.query(`CREATE TABLE strategy_revisions (
      page_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),game_id uuid NOT NULL,
      author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,payload jsonb NOT NULL,
      game_version_id uuid,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(page_id,revision),
      UNIQUE(page_id,revision,game_id),FOREIGN KEY(page_id,game_id) REFERENCES strategy_pages(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(game_version_id,game_id) REFERENCES game_versions(id,game_id) ON DELETE RESTRICT,
      CHECK(jsonb_typeof(payload)='object'))`);
    await r.query(`ALTER TABLE strategy_pages ADD CONSTRAINT fk_strategy_current FOREIGN KEY(id,current_revision) REFERENCES strategy_revisions(page_id,revision) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_strategy_publication FOREIGN KEY(id,published_revision) REFERENCES strategy_revisions(page_id,revision) DEFERRABLE INITIALLY DEFERRED`);
    await r.query(`CREATE TABLE strategy_references (
      id uuid PRIMARY KEY,page_id uuid NOT NULL,revision integer NOT NULL,game_id uuid NOT NULL,equipment_id uuid,character_id uuid,
      FOREIGN KEY(page_id,revision,game_id) REFERENCES strategy_revisions(page_id,revision,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(equipment_id,game_id) REFERENCES equipment(id,game_id) ON DELETE RESTRICT,
      FOREIGN KEY(character_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      CHECK((equipment_id IS NULL)<>(character_id IS NULL)))`);
    await r.query(
      `CREATE UNIQUE INDEX uq_strategy_equipment_ref ON strategy_references(page_id,revision,equipment_id) WHERE equipment_id IS NOT NULL`,
    );
    await r.query(
      `CREATE UNIQUE INDEX uq_strategy_character_ref ON strategy_references(page_id,revision,character_id) WHERE character_id IS NOT NULL`,
    );
    await r.query(
      `CREATE INDEX ix_strategy_equipment_ref ON strategy_references(equipment_id) WHERE equipment_id IS NOT NULL`,
    );
    await r.query(
      `CREATE INDEX ix_strategy_character_ref ON strategy_references(character_id) WHERE character_id IS NOT NULL`,
    );
    await r.query(
      `CREATE INDEX ix_strategy_patch_ref ON strategy_revisions(game_version_id) WHERE game_version_id IS NOT NULL`,
    );
    await r.query(`CREATE TABLE strategy_audit (
      id uuid PRIMARY KEY,page_id uuid NOT NULL REFERENCES strategy_pages(id) ON DELETE RESTRICT,
      actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,version integer NOT NULL,action varchar(32) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(page_id,version))`);
    for (const table of ['strategy_revisions', 'strategy_references', 'strategy_audit'])
      await r.query(
        `CREATE TRIGGER tr_${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_editorial_mutation()`,
      );
    for (const table of [
      'equipment',
      'strategy_pages',
      'strategy_revisions',
      'strategy_references',
      'strategy_audit',
    ])
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE strategy_audit,strategy_references');
    await r.query(
      'ALTER TABLE strategy_pages DROP CONSTRAINT fk_strategy_current,DROP CONSTRAINT fk_strategy_publication',
    );
    await r.query('DROP TABLE strategy_revisions,strategy_pages,equipment');
    await r.query('DROP INDEX uq_patch_strategy_reference');
  }
}
