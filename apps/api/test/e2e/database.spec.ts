import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Foundation1792800000000 } from '../../src/database/migrations/1792800000000-foundation';
import { HealthController } from '../../src/modules/health/health.controller';
import { parseEnvironment } from '../../src/config/env';
import { connectionOptions } from '../../src/database/connection-options';

describe('real PostgreSQL migration lifecycle', () => {
  let admin: DataSource;
  let db: DataSource;
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('TEST_DATABASE_URL must point to a disposable PostgreSQL database');
    const opts = connectionOptions(parseEnvironment({ ...process.env, DATABASE_URL: url }));
    admin = new DataSource({ type: 'postgres', ...opts });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      ...opts,
      schema,
      synchronize: false,
      migrations: [Foundation1792800000000],
      extra: { options: `-c search_path=${schema}` },
    });
    await db.initialize();
  }, 60000);
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('runs, persists constraints, reverts and reapplies', async () => {
    expect(await db.showMigrations()).toBe(true);
    await db.runMigrations();
    expect(await db.showMigrations()).toBe(false);
    await db.query(`INSERT INTO platform_metadata(key,value) VALUES ('fixture','{}')`);
    await expect(
      db.query(`INSERT INTO platform_metadata(key,value) VALUES ('fixture','{}')`),
    ).rejects.toThrow();
    await db.undoLastMigration();
    expect(await db.showMigrations()).toBe(true);
    await db.runMigrations();
    expect(await db.query('SELECT * FROM platform_metadata')).toEqual([]);
    const health = new HealthController(db);
    await expect(health.ready()).resolves.toEqual({ status: 'ok' });
    await db.destroy();
    await expect(health.ready()).rejects.toThrow('Database unavailable');
    expect(health.live()).toEqual({ status: 'ok' });
  });
});
