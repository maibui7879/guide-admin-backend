import db from '../database/data-source';
import { seedCatalog } from '../database/seeds/seed-catalog';
export { seedCatalog } from '../database/seeds/seed-catalog';
async function seed(): Promise<void> {
  await db.initialize();
  try {
    await db.query(
      `INSERT INTO platform_metadata(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
      ['platform', JSON.stringify({ name: 'Stella Atlas', schemaVersion: 1 })],
    );
    console.log('Character seed complete:', await seedCatalog(db));
  } finally {
    await db.destroy();
  }
}
if (require.main === module)
  void seed().catch(() => {
    console.error('Seed failed');
    process.exitCode = 1;
  });
