import { DataSource } from 'typeorm';

// Each caller owns a disposable schema. Include newer migrations so a module's
// rollback test continues to target that module as the migration history grows.
export async function revertThrough(database: DataSource, targetName: string): Promise<void> {
  const applied = (await database.query('SELECT name FROM migrations ORDER BY id DESC')) as {
    name: string;
  }[];
  if (!applied.some((migration) => migration.name === targetName))
    throw new Error(`Migration ${targetName} is not applied`);
  for (const migration of applied) {
    await database.undoLastMigration();
    if (migration.name === targetName) return;
  }
}
