import db from '../database/data-source';
async function run(): Promise<void> {
  await db.initialize();
  try {
    const applied = await db.runMigrations();
    console.log(`Applied ${applied.length} migration(s)`);
  } finally {
    await db.destroy();
  }
}
void run().catch(() => {
  console.error('Migration failed; review the schema with an authorized operator before retrying');
  process.exitCode = 1;
});
