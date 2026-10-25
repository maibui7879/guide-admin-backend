import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { publicJoin } from '../guides/services/content-reader.service';
import { availableStrategy } from '../strategy/services/strategy.service';
import { SearchQuery } from './search-query.dto';
const characterVector = `to_tsvector('simple',ch.name||' '||ch.slug||' '||coalesce(ch.role,''))`;
const guideVector = `to_tsvector('simple',r.title||' '||r.description||' '||jsonb_path_query_array(r.body,'$.** ? (@.type == "text").text')::text)`;
const equipmentVector = `to_tsvector('simple',e.name||' '||e.description)`;
const strategyVector = `to_tsvector('simple',r.payload::text)`;
const query = `websearch_to_tsquery('simple',$2)`;
const matches = `
 SELECT ch.id,ch.slug,'character'::text AS kind,ch.name AS title,coalesce(ch.role,'') AS description,
   GREATEST(ts_rank_cd(${characterVector},${query}),coalesce((SELECT max(ts_rank_cd(to_tsvector('simple',a.alias),${query})) FROM character_aliases a WHERE a.character_id=ch.id),0)) AS rank
 FROM characters ch JOIN games g ON g.id=ch.game_id WHERE g.slug=$1 AND g.status='active' AND ch.status='published'
 AND (${characterVector}@@${query} OR EXISTS(SELECT 1 FROM character_aliases a WHERE a.character_id=ch.id AND to_tsvector('simple',a.alias)@@${query}))
 UNION ALL
 SELECT c.id,c.slug,'guide'::text,r.title,r.description,ts_rank_cd(${guideVector},${query}) ${publicJoin} AND ${guideVector}@@${query}
 UNION ALL
 SELECT e.id,e.slug,'equipment'::text,e.name,e.description,ts_rank_cd(${equipmentVector},${query})
 FROM equipment e JOIN games g ON g.id=e.game_id WHERE g.slug=$1 AND g.status='active' AND e.status='published' AND ${equipmentVector}@@${query}
 UNION ALL
 SELECT s.id,s.slug,s.kind,r.payload->>'title',r.payload->>'description',ts_rank_cd(${strategyVector},${query})
 FROM strategy_pages s JOIN games g ON g.id=s.game_id JOIN strategy_revisions r ON r.page_id=s.id AND r.revision=s.published_revision
 WHERE g.slug=$1 AND ${availableStrategy} AND ${strategyVector}@@${query}`;
@Injectable()
export class SearchService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async search(game: string, q: SearchQuery) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      if (!(await m.query("SELECT id FROM games WHERE slug=$1 AND status='active'", [game])).length)
        throw new NotFoundException('Game not found');
      const cte = `WITH results AS (${matches}),filtered AS (SELECT * FROM results WHERE ($3='all' OR kind=$3))`;
      const params = [game, q.q, q.kind];
      const [{ total }] = await m.query(
        `${cte} SELECT count(*)::int AS total FROM filtered`,
        params,
      );
      const rows = await m.query(
        `${cte} SELECT * FROM filtered ORDER BY rank DESC,kind ASC,slug ASC,id ASC LIMIT $4 OFFSET $5`,
        [...params, q.limit, (q.page - 1) * q.limit],
      );
      const resources: Record<string, string> = {
        character: 'characters',
        guide: 'guides',
        equipment: 'equipment',
        build: 'builds',
        tier_list: 'tier-lists',
      };
      return {
        data: rows.map((row: { kind: string; slug: string }) => ({
          ...row,
          apiPath: `/api/v1/games/${encodeURIComponent(game)}/${resources[row.kind]}/${encodeURIComponent(row.slug)}`,
        })),
        meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      };
    });
  }
}
