import db from '../database/data-source';
async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await db.initialize();
  try {
    const candidates = await db.query(`SELECT
      (SELECT count(*)::int FROM sessions WHERE absolute_expires_at<now()-interval '30 days') AS sessions,
      (SELECT count(*)::int FROM login_buckets WHERE window_started_at<now()-interval '1 day') AS "loginBuckets",
      (SELECT count(*)::int FROM worker_heartbeats WHERE last_seen_at<now()-interval '7 days') AS "workerHeartbeats"`);
    if (apply)
      await db.transaction(async (m) => {
        await m.query(
          "DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE absolute_expires_at<now()-interval '30 days' ORDER BY absolute_expires_at LIMIT 1000)",
        );
        await m.query(
          "DELETE FROM login_buckets WHERE key IN (SELECT key FROM login_buckets WHERE window_started_at<now()-interval '1 day' ORDER BY window_started_at LIMIT 1000)",
        );
        await m.query(
          "DELETE FROM worker_heartbeats WHERE id IN (SELECT id FROM worker_heartbeats WHERE last_seen_at<now()-interval '7 days' ORDER BY last_seen_at LIMIT 1000)",
        );
      });
    console.log(
      JSON.stringify({
        mode: apply ? 'applied (at most 1000 per table)' : 'dry-run',
        candidates: candidates[0],
      }),
    );
  } finally {
    await db.destroy();
  }
}
void run().catch(() => {
  console.error('Operational pruning failed; verify migrations and database access');
  process.exitCode = 1;
});
