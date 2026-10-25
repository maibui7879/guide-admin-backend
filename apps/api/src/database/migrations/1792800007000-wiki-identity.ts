import { MigrationInterface, QueryRunner } from 'typeorm';
export class WikiIdentity1792800007000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `ALTER TABLE contents ADD COLUMN wiki_kind varchar(16), ADD COLUMN wiki_topic varchar(16), ADD COLUMN wiki_character_id uuid, ADD COLUMN wiki_team_id uuid`,
    );
    // Never guess a team identity, discard revisions or silently choose among duplicate pages.
    const ambiguous =
      await r.query(`SELECT c.id FROM contents c JOIN content_revisions r ON r.content_id=c.id AND r.revision=c.current_revision
      WHERE r.category='team' OR (r.category='character' AND (SELECT count(*) FROM content_relations cr WHERE cr.content_id=c.id AND cr.revision=c.current_revision AND cr.character_id IS NOT NULL)<>1)`);
    if (ambiguous.length)
      throw new Error(
        'Wiki migration needs explicit mapping for ambiguous character/team guides; no data was changed',
      );
    await r.query(`UPDATE contents c SET wiki_kind=CASE WHEN r.category='character' THEN 'character' ELSE 'game' END,
      wiki_topic=CASE WHEN r.category IN ('beginner','combat','progression','boss') THEN r.category ELSE 'overview' END,
      wiki_character_id=CASE WHEN r.category='character' THEN (SELECT cr.character_id FROM content_relations cr WHERE cr.content_id=c.id AND cr.revision=c.current_revision AND cr.character_id IS NOT NULL LIMIT 1) ELSE NULL END
      FROM content_revisions r WHERE r.content_id=c.id AND r.revision=c.current_revision`);
    const duplicates = await r.query(
      `SELECT game_id FROM contents GROUP BY game_id,wiki_kind,wiki_topic,wiki_character_id,wiki_team_id HAVING count(*)>1`,
    );
    if (duplicates.length)
      throw new Error(
        'Existing guides map to duplicate wiki identities; reconcile them explicitly before migrating',
      );
    await r.query(`ALTER TABLE contents ALTER COLUMN wiki_kind SET NOT NULL, ALTER COLUMN wiki_topic SET NOT NULL,
      ADD CONSTRAINT ck_contents_wiki_topic CHECK(wiki_topic IN ('overview','build','strategy','beginner','combat','progression','boss')),
      ADD CONSTRAINT ck_contents_wiki_target CHECK((wiki_kind='game' AND wiki_character_id IS NULL AND wiki_team_id IS NULL) OR (wiki_kind='character' AND wiki_character_id IS NOT NULL AND wiki_team_id IS NULL) OR (wiki_kind='team' AND wiki_team_id IS NOT NULL AND wiki_character_id IS NULL))`);
    await r.query('CREATE UNIQUE INDEX uq_teams_wiki_reference ON teams(id,game_id)');
    await r.query(`ALTER TABLE contents ADD CONSTRAINT fk_contents_wiki_character FOREIGN KEY(wiki_character_id,game_id) REFERENCES characters(id,game_id) ON DELETE RESTRICT,
      ADD CONSTRAINT fk_contents_wiki_team FOREIGN KEY(wiki_team_id,game_id) REFERENCES teams(id,game_id) ON DELETE RESTRICT`);
    await r.query(
      "CREATE UNIQUE INDEX uq_contents_wiki_character ON contents(game_id,wiki_character_id,wiki_topic) WHERE wiki_kind='character'",
    );
    await r.query(
      "CREATE UNIQUE INDEX uq_contents_wiki_team ON contents(game_id,wiki_team_id,wiki_topic) WHERE wiki_kind='team'",
    );
    await r.query(
      "CREATE UNIQUE INDEX uq_contents_wiki_game ON contents(game_id,wiki_topic) WHERE wiki_kind='game'",
    );
    await r.query('CREATE INDEX ix_contents_wiki_character ON contents(wiki_character_id)');
    await r.query('CREATE INDEX ix_contents_wiki_team ON contents(wiki_team_id)');
    await r.query(`CREATE FUNCTION protect_wiki_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF ROW(NEW.game_id,NEW.wiki_kind,NEW.wiki_topic,NEW.wiki_character_id,NEW.wiki_team_id) IS DISTINCT FROM ROW(OLD.game_id,OLD.wiki_kind,OLD.wiki_topic,OLD.wiki_character_id,OLD.wiki_team_id) THEN
        RAISE EXCEPTION 'Wiki identity is immutable' USING ERRCODE='23514', CONSTRAINT='ck_contents_wiki_immutable';
      END IF; RETURN NEW; END $$`);
    await r.query(
      'CREATE TRIGGER tr_contents_wiki_immutable BEFORE UPDATE ON contents FOR EACH ROW EXECUTE FUNCTION protect_wiki_identity()',
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TRIGGER tr_contents_wiki_immutable ON contents');
    await r.query('DROP FUNCTION protect_wiki_identity()');
    await r.query(
      'ALTER TABLE contents DROP CONSTRAINT fk_contents_wiki_character, DROP CONSTRAINT fk_contents_wiki_team',
    );
    await r.query('DROP INDEX uq_teams_wiki_reference');
    await r.query(
      'ALTER TABLE contents DROP COLUMN wiki_kind, DROP COLUMN wiki_topic, DROP COLUMN wiki_character_id, DROP COLUMN wiki_team_id',
    );
  }
}
