import db from '../database/data-source';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
async function run(): Promise<void> {
  await db.initialize();
  try {
    const [counts] = await db.query(
      'SELECT (SELECT count(*)::int FROM characters) AS characters,(SELECT count(*)::int FROM content_revisions) AS revisions',
    );
    const plan = await db.query(
      `EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT ch.id FROM characters ch JOIN games g ON g.id=ch.game_id
      WHERE g.slug=$1 AND g.status='active' AND ch.status='published' AND to_tsvector('simple',ch.name||' '||ch.slug||' '||coalesce(ch.role,''))@@websearch_to_tsquery('simple',$2)`,
      ['stella-sora', 'noya'],
    );
    const target = resolve(__dirname, '../../../../.cache/search-plan.json');
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(
      target,
      JSON.stringify({ measuredAt: new Date().toISOString(), counts, plan }, null, 2) + '\n',
    );
    console.log('Saved read-only search EXPLAIN to .cache/search-plan.json');
  } finally {
    await db.destroy();
  }
}
void run().catch(() => {
  console.error('Search EXPLAIN failed; verify migrations and database availability');
  process.exitCode = 1;
});
