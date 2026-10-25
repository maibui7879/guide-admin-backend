import { CharacterProgression1792800006000 } from '../../src/database/migrations/1792800006000-character-progression';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { parseEnvironment } from '../../src/config/env';
import { connectionOptions } from '../../src/database/connection-options';
import { Foundation1792800000000 } from '../../src/database/migrations/1792800000000-foundation';
import { Catalog1792800001000 } from '../../src/database/migrations/1792800001000-catalog';
import {
  catalogEntities,
  CharacterEntity,
  SkillEntity,
  GameEntity,
} from '../../src/modules/catalog/entities/catalog.entities';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';
import { seedCatalog } from '../../src/database/seeds/seed-catalog';
import {
  CharacterTalentEntity,
  CharacterPotentialEntity,
} from '../../src/modules/catalog/entities/progression.entities';

describe('Character roster seed in isolated PostgreSQL schema', () => {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let db: DataSource;
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
    const options = connectionOptions(
      parseEnvironment({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }),
    );
    admin = new DataSource({ type: 'postgres', ...options });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      ...options,
      schema,
      entities: catalogEntities,
      migrations: [
        Foundation1792800000000,
        Catalog1792800001000,
        CharacterProgression1792800006000,
      ],
      extra: { options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 },
    });
    await db.initialize();
    await db.runMigrations();
  }, 60000);
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('preserves manual edits, upgrades untouched legacy rows, and leaves IDs stable on rerun', async () => {
    const writer = new CatalogWriterService(db);
    const game = await writer.createGame({ slug: 'stella-sora', name: 'Stella Sora' });
    const old = await writer.writeCharacter(game.id, {
      slug: 'allie',
      name: 'Allie',
      rarity: 5,
      element: 'Aqua',
      role: 'Vanguard',
      mechanics: { attackType: 'Melee' },
      status: 'published',
      sourceUrl: 'https://www.kaiden.gg/stella-sora/characters/allie/',
      verifiedAt: '2026-10-24T00:00:00.000Z',
      portraitUrl: '/assets/allie-portrait.webp',
      imageUrl: '/assets/allie.webp',
    });
    const manual = await writer.writeCharacter(game.id, {
      slug: 'amber',
      name: 'Edited Amber',
      rarity: 4,
      element: 'Ignis',
      skills: [{ name: 'Editorial skill', kind: 'main', description: 'Preserve me' }],
    });
    expect(await seedCatalog(db)).toEqual({
      created: 39,
      upgraded: 1,
      preserved: 1,
      progressionBackfilled: 0,
      total: 41,
    });
    expect(
      (await db.getRepository(CharacterEntity).findOneByOrFail({ id: old.id })).sourceUrl,
    ).toContain('AutumnVN/ss-data');
    expect((await db.getRepository(CharacterEntity).findOneByOrFail({ id: manual.id })).name).toBe(
      'Edited Amber',
    );
    const before = await db.getRepository(SkillEntity).find({ order: { id: 'ASC' } });
    // Simulate a previous roster import before progression tables were added.
    await db.getRepository(CharacterTalentEntity).delete({ characterId: old.id });
    await db.getRepository(CharacterPotentialEntity).delete({ characterId: old.id });
    expect(await seedCatalog(db)).toEqual({
      created: 0,
      upgraded: 0,
      preserved: 41,
      progressionBackfilled: 1,
      total: 41,
    });
    expect(
      await db.getRepository(CharacterTalentEntity).count({ where: { characterId: old.id } }),
    ).toBe(5);
    expect(
      await db.getRepository(CharacterPotentialEntity).count({ where: { characterId: old.id } }),
    ).toBeGreaterThan(0);
    expect(
      await db.getRepository(CharacterTalentEntity).count({ where: { characterId: manual.id } }),
    ).toBe(0);
    const talents = await db.getRepository(CharacterTalentEntity).find({ order: { id: 'ASC' } });
    const potentials = await db
      .getRepository(CharacterPotentialEntity)
      .find({ order: { id: 'ASC' } });
    expect(await seedCatalog(db)).toMatchObject({
      created: 0,
      upgraded: 0,
      progressionBackfilled: 0,
    });
    expect(await db.getRepository(CharacterTalentEntity).find({ order: { id: 'ASC' } })).toEqual(
      talents,
    );
    expect(await db.getRepository(CharacterPotentialEntity).find({ order: { id: 'ASC' } })).toEqual(
      potentials,
    );
    expect(await db.getRepository(CharacterEntity).count()).toBe(41);
    expect(await db.getRepository(SkillEntity).find({ order: { id: 'ASC' } })).toEqual(before);
    expect(
      (
        await db.query('SELECT value FROM platform_metadata WHERE key = $1', ['stella-sora-roster'])
      )[0].value.characters,
    ).toHaveLength(41);
    expect(await db.getRepository(GameEntity).count()).toBe(1);
  }, 240000);
});
