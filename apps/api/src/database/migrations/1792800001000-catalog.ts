import { MigrationInterface, QueryRunner } from 'typeorm';

export class Catalog1792800001000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE games (
      id uuid CONSTRAINT pk_games PRIMARY KEY, slug varchar(100) NOT NULL, name varchar(150) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_games_slug UNIQUE(slug), CONSTRAINT ck_games_status CHECK(status IN ('active','archived')),
      CONSTRAINT ck_games_metadata CHECK(jsonb_typeof(metadata) = 'object'))`);
    await r.query(`CREATE TABLE game_versions (
      id uuid CONSTRAINT pk_game_versions PRIMARY KEY, game_id uuid NOT NULL,
      version varchar(100) NOT NULL, release_date date, status varchar(16) NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_versions_game FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE,
      CONSTRAINT uq_versions_game_version UNIQUE(game_id,version),
      CONSTRAINT ck_versions_status CHECK(status IN ('draft','published','archived')))`);
    await r.query(`CREATE TABLE characters (
      id uuid CONSTRAINT pk_characters PRIMARY KEY, game_id uuid NOT NULL, slug varchar(100) NOT NULL,
      name varchar(150) NOT NULL, status varchar(16) NOT NULL DEFAULT 'draft', rarity smallint NOT NULL,
      element varchar(16) NOT NULL, role varchar(50), portrait_url varchar(2048), image_url varchar(2048),
      voice varchar(150), source_url varchar(2048), verified_at timestamptz,
      mechanics_schema_version smallint NOT NULL DEFAULT 1, mechanics jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_characters_game FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE,
      CONSTRAINT uq_characters_game_slug UNIQUE(game_id,slug),
      CONSTRAINT ck_characters_status CHECK(status IN ('draft','published','archived')),
      CONSTRAINT ck_characters_rarity CHECK(rarity IN (4,5)),
      CONSTRAINT ck_characters_element CHECK(element IN ('Ignis','Aqua','Ventus','Terra','Lux','Umbra')),
      CONSTRAINT ck_characters_mechanics CHECK(mechanics_schema_version = 1 AND jsonb_typeof(mechanics) = 'object'))`);
    await r.query('CREATE INDEX ix_characters_catalog ON characters(game_id,status,name,id)');
    await r.query('CREATE INDEX ix_characters_element ON characters(game_id,element)');
    await r.query(`CREATE TABLE character_aliases (
      id uuid CONSTRAINT pk_character_aliases PRIMARY KEY, character_id uuid NOT NULL, alias varchar(150) NOT NULL,
      position integer NOT NULL, CONSTRAINT fk_character_aliases_character FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT uq_alias_name UNIQUE(character_id,alias), CONSTRAINT uq_alias_position UNIQUE(character_id,position),
      CONSTRAINT ck_alias_position CHECK(position >= 0))`);
    await r.query(`CREATE TABLE character_stats (
      id uuid CONSTRAINT pk_character_stats PRIMARY KEY, character_id uuid NOT NULL, code varchar(50) NOT NULL,
      value double precision NOT NULL, level smallint NOT NULL, position integer NOT NULL,
      CONSTRAINT fk_character_stats_character FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT uq_stat_code_level UNIQUE(character_id,code,level), CONSTRAINT uq_stat_position UNIQUE(character_id,position),
      CONSTRAINT ck_stat_value CHECK(value >= 0 AND value < 'Infinity'::float8),
      CONSTRAINT ck_stat_level CHECK(level BETWEEN 1 AND 1000), CONSTRAINT ck_stat_position CHECK(position >= 0))`);
    await r.query(`CREATE TABLE skills (
      id uuid CONSTRAINT pk_skills PRIMARY KEY, character_id uuid NOT NULL, name varchar(150) NOT NULL,
      kind varchar(16) NOT NULL, description text NOT NULL, position integer NOT NULL,
      CONSTRAINT fk_skills_character FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT uq_skill_position UNIQUE(character_id,position),
      CONSTRAINT ck_skill_kind CHECK(kind IN ('normal','main','support','ultimate')),
      CONSTRAINT ck_skill_position CHECK(position >= 0))`);
    // Data is served through NestJS. Supabase's Data API must not expose catalog drafts.
    for (const table of [
      'games',
      'game_versions',
      'characters',
      'character_aliases',
      'character_stats',
      'skills',
      'platform_metadata',
      'migrations',
    ]) {
      await r.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  }
  async down(r: QueryRunner): Promise<void> {
    for (const table of [
      'skills',
      'character_stats',
      'character_aliases',
      'characters',
      'game_versions',
      'games',
    ]) {
      await r.query(`DROP TABLE "${table}"`);
    }
    // Retain RLS on foundation metadata even when rolling catalog back.
  }
}
