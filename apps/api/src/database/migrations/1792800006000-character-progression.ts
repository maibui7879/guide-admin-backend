import { MigrationInterface, QueryRunner } from 'typeorm';

export class CharacterProgression1792800006000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE character_talents (
      id uuid CONSTRAINT pk_character_talents PRIMARY KEY,
      character_id uuid NOT NULL,
      position integer NOT NULL,
      name varchar(150) NOT NULL,
      boosts jsonb NOT NULL,
      CONSTRAINT fk_character_talents_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT uq_talent_position UNIQUE (character_id, position),
      CONSTRAINT ck_talent_position CHECK (position >= 0),
      CONSTRAINT ck_talent_boosts CHECK (jsonb_typeof(boosts) = 'array' AND jsonb_array_length(boosts) BETWEEN 1 AND 100)
    )`);
    await runner.query(`CREATE TABLE character_potentials (
      id uuid CONSTRAINT pk_character_potentials PRIMARY KEY,
      character_id uuid NOT NULL,
      position integer NOT NULL,
      source_id integer,
      category varchar(20) NOT NULL,
      name varchar(150) NOT NULL,
      description text NOT NULL,
      params jsonb NOT NULL,
      hidden_params jsonb NOT NULL,
      icon varchar(150), rarity varchar(16), corner varchar(16),
      CONSTRAINT fk_character_potentials_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT uq_potential_position UNIQUE (character_id, position),
      CONSTRAINT uq_potential_source UNIQUE (character_id, source_id),
      CONSTRAINT ck_potential_position CHECK (position >= 0),
      CONSTRAINT ck_potential_source CHECK (source_id > 0),
      CONSTRAINT ck_potential_category CHECK (category IN ('mainCore', 'mainNormal', 'common', 'supportCore', 'supportNormal')),
      CONSTRAINT ck_potential_params CHECK (jsonb_typeof(params) = 'array' AND jsonb_typeof(hidden_params) = 'array'),
      CONSTRAINT ck_potential_rarity CHECK (rarity IN ('core', 'common', 'rare')),
      CONSTRAINT ck_potential_corner CHECK (corner IN ('Diamond', 'Triangle', 'Round'))
    )`);
    // Catalog is served through Nest's publication filters, never direct anonymous Data API reads.
    await runner.query('ALTER TABLE character_talents ENABLE ROW LEVEL SECURITY');
    await runner.query('ALTER TABLE character_potentials ENABLE ROW LEVEL SECURITY');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE character_potentials');
    await runner.query('DROP TABLE character_talents');
  }
}
