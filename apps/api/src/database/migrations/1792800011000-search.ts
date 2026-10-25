import { MigrationInterface, QueryRunner } from 'typeorm';
export class Search1792800011000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE INDEX ix_characters_search ON characters USING gin(to_tsvector('simple',name||' '||slug||' '||coalesce(role,'')))`,
    );
    await r.query(
      `CREATE INDEX ix_aliases_search ON character_aliases USING gin(to_tsvector('simple',alias))`,
    );
    await r.query(
      `CREATE INDEX ix_guides_search ON content_revisions USING gin(to_tsvector('simple',title||' '||description||' '||jsonb_path_query_array(body,'$.** ? (@.type == "text").text')::text))`,
    );
    await r.query(
      `CREATE INDEX ix_equipment_search ON equipment USING gin(to_tsvector('simple',name||' '||description))`,
    );
    await r.query(
      `CREATE INDEX ix_strategy_search ON strategy_revisions USING gin(to_tsvector('simple',payload::text))`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    for (const name of [
      'ix_strategy_search',
      'ix_equipment_search',
      'ix_guides_search',
      'ix_aliases_search',
      'ix_characters_search',
    ])
      await r.query(`DROP INDEX ${name}`);
  }
}
