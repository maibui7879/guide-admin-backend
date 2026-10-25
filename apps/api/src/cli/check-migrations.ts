import db from '../database/data-source';
async function run(): Promise<void> {
  await db.initialize();
  try {
    if (await db.showMigrations()) throw new Error('Pending migrations');
    const changes = await db.driver.createSchemaBuilder().log();
    if (changes.upQueries.length) throw new Error('Entity/schema drift detected');
    console.log('Migrations applied; no entity schema drift');
  } finally {
    await db.destroy();
  }
}
void run().catch(() => {
  console.error('Migration check failed');
  process.exitCode = 1;
});
