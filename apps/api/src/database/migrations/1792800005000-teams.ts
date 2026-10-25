import { MigrationInterface, QueryRunner } from 'typeorm';

export class Teams1792800005000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query('CREATE UNIQUE INDEX uq_characters_team_reference ON characters(id,game_id)');
    await r.query(`CREATE TABLE teams (
      id uuid CONSTRAINT pk_teams PRIMARY KEY, game_id uuid NOT NULL, slug varchar(100) NOT NULL,
      name varchar(150) NOT NULL, description varchar(2000) NOT NULL DEFAULT '', status varchar(16) NOT NULL DEFAULT 'draft',
      version integer NOT NULL DEFAULT 1, main_character_id uuid NOT NULL, support_one_id uuid NOT NULL, support_two_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_teams_game FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE RESTRICT,
      CONSTRAINT fk_teams_main FOREIGN KEY(main_character_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      CONSTRAINT fk_teams_support_one FOREIGN KEY(support_one_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      CONSTRAINT fk_teams_support_two FOREIGN KEY(support_two_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      CONSTRAINT uq_teams_slug UNIQUE(game_id,slug),
      CONSTRAINT uq_teams_lineup UNIQUE(game_id,main_character_id,support_one_id,support_two_id),
      CONSTRAINT ck_teams_status CHECK(status IN ('draft', 'published', 'archived')),
      CONSTRAINT ck_teams_version CHECK(version > 0),
      CONSTRAINT ck_teams_slug CHECK(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      CONSTRAINT ck_teams_members CHECK(main_character_id <> support_one_id AND main_character_id <> support_two_id AND support_one_id < support_two_id))`);
    await r.query('CREATE INDEX ix_teams_public ON teams(game_id,status,name,id)');
    await r.query('CREATE INDEX ix_teams_main ON teams(main_character_id)');
    await r.query('CREATE INDEX ix_teams_support_one ON teams(support_one_id)');
    await r.query('CREATE INDEX ix_teams_support_two ON teams(support_two_id)');
    await r.query('ALTER TABLE teams ENABLE ROW LEVEL SECURITY');
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE teams');
    await r.query('DROP INDEX uq_characters_team_reference');
  }
}
