import { CharacterProgression1792800006000 } from '../../src/database/migrations/1792800006000-character-progression';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { parseEnvironment } from '../../src/config/env';
import { connectionOptions } from '../../src/database/connection-options';
import { Foundation1792800000000 } from '../../src/database/migrations/1792800000000-foundation';
import { Catalog1792800001000 } from '../../src/database/migrations/1792800001000-catalog';
import {
  catalogEntities,
  CharacterEntity,
  GameEntity,
} from '../../src/modules/catalog/entities/catalog.entities';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/common/http/configure-http';

describe('PostgreSQL-backed catalog API', () => {
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let writer: CatalogWriterService;
  let gameId: string;
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const published = {
    slug: 'allie',
    name: 'Allie',
    element: 'Aqua',
    rarity: 5,
    role: 'Vanguard',
    status: 'published',
    sourceUrl: 'https://example.com/allie',
    verifiedAt: '2026-10-24T00:00:00.000Z',
  };
  beforeAll(async () => {
    let stage = 'configuration';
    try {
      if (!process.env.TEST_DATABASE_URL)
        throw new Error('TEST_DATABASE_URL must point to a disposable PostgreSQL database');
      const env = parseEnvironment({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL });
      const opts = connectionOptions(env);
      stage = 'admin connection';
      admin = new DataSource({ type: 'postgres', ...opts });
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      db = new DataSource({
        type: 'postgres',
        ...opts,
        schema,
        entities: catalogEntities,
        synchronize: false,
        migrations: [
          Foundation1792800000000,
          Catalog1792800001000,
          CharacterProgression1792800006000,
        ],
        extra: { options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 },
      });
      stage = 'isolated schema connection';
      await db.initialize();
      expect((await db.query('SELECT current_schema() AS schema'))[0].schema).toBe(schema);
      stage = 'migrations';
      await db.runMigrations();
      writer = new CatalogWriterService(db);
      stage = 'catalog fixtures';
      gameId = (await writer.createGame({ slug: 'stella-sora', name: 'Stella Sora' })).id;
      await writer.writeCharacter(gameId, {
        ...published,
        aliases: ['Blue Maid'],
        stats: [{ code: 'ATK', value: 100, level: 1 }],
        skills: [{ name: 'Example', kind: 'normal', description: 'Synthetic test data only.' }],
        talents: [
          {
            name: 'Talent fixture',
            boosts: [{ description: 'Boost fixture', params: [10, '5%/10%'] }],
          },
        ],
        potentials: [
          {
            sourceId: 100,
            category: 'mainCore',
            name: 'Potential fixture',
            description: 'Synthetic potential',
            params: ['10%/20%'],
            hiddenParams: [3],
          },
        ],
      });
      await writer.writeCharacter(gameId, {
        ...published,
        slug: 'amber',
        name: 'Amber',
        element: 'Ignis',
        rarity: 4,
      });
      await writer.writeCharacter(gameId, {
        ...published,
        slug: 'draft',
        name: 'Draft',
        status: 'draft',
      });
      await writer.createVersion(gameId, {
        version: 'test-public',
        status: 'published',
        releaseDate: '2026-10-24',
      });
      await writer.createVersion(gameId, { version: 'test-draft' });
      stage = 'HTTP application';
      const module = await Test.createTestingModule({
        imports: [AppModule.register(db)],
      }).compile();
      app = module.createNestApplication({ bodyParser: false });
      configureHttp(app, { ...env, LOG_LEVEL: 'silent' });
      await app.init();
    } catch (error) {
      throw new Error(
        `Catalog setup failed at ${stage}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  const base = '/api/v1/games/stella-sora';
  it('lists published data with deterministic pagination and combined filters', async () => {
    const first = await request(app.getHttpServer()).get(`${base}/characters?limit=1`).expect(200);
    const second = await request(app.getHttpServer())
      .get(`${base}/characters?limit=1&page=2`)
      .expect(200);
    expect(first.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(first.body.data[0].slug).toBe('allie');
    expect(second.body.data[0].slug).toBe('amber');
    const filtered = await request(app.getHttpServer())
      .get(`${base}/characters?element=Aqua&rarity=5&role=Vanguard&q=Blue`)
      .expect(200);
    expect(filtered.body.data.map((c: { slug: string }) => c.slug)).toEqual(['allie']);
    const empty = await request(app.getHttpServer()).get(`${base}/characters?q=%25`).expect(200);
    expect(empty.body.meta.total).toBe(0);
  });
  it('loads ordered detail and never exposes draft or other-game entries', async () => {
    const detail = await request(app.getHttpServer()).get(`${base}/characters/allie`).expect(200);
    expect(detail.body.data.aliases).toEqual(['Blue Maid']);
    expect(detail.body.data.stats[0].code).toBe('ATK');
    expect(detail.body.data.skills[0].position).toBe(0);
    expect(detail.body.data.talents).toEqual([
      {
        name: 'Talent fixture',
        position: 0,
        boosts: [
          { name: null, description: 'Boost fixture', params: [10, '5%/10%'], hiddenParams: [] },
        ],
      },
    ]);
    expect(detail.body.data.potentials[0]).toMatchObject({
      sourceId: 100,
      category: 'mainCore',
      position: 0,
      params: ['10%/20%'],
      hiddenParams: [3],
    });
    const empty = await request(app.getHttpServer()).get(`${base}/characters/amber`).expect(200);
    expect(empty.body.data.talents).toEqual([]);
    expect(empty.body.data.potentials).toEqual([]);
    expect(detail.body.data.sources[0].verifiedAt).toBe('2026-10-24T00:00:00.000Z');
    await request(app.getHttpServer()).get(`${base}/characters/draft`).expect(404);
    await request(app.getHttpServer()).get('/api/v1/games/missing/characters/allie').expect(404);
  });
  it('validates query boundaries and offers no mutation routes', async () => {
    for (const query of [
      'page=0',
      'limit=101',
      'rarity=6',
      'element=invalid',
      'status=draft',
      'page=1.5',
      'q[x]=a',
    ]) {
      await request(app.getHttpServer()).get(`${base}/characters?${query}`).expect(400);
    }
    await request(app.getHttpServer()).post(`${base}/characters`).send(published).expect(404);
    await request(app.getHttpServer())
      .patch(`${base}/characters/allie`)
      .send({ status: 'published' })
      .expect(404);
  });
  it('lists only active games and published versions', async () => {
    await writer.createGame({ slug: 'hidden', name: 'Hidden', status: 'archived' });
    const games = await request(app.getHttpServer()).get('/api/v1/games').expect(200);
    expect(games.body.data).toHaveLength(1);
    const versions = await request(app.getHttpServer()).get(`${base}/versions`).expect(200);
    expect(versions.body.data.map((v: { version: string }) => v.version)).toEqual(['test-public']);
    await db.getRepository(GameEntity).update({ id: gameId }, { status: 'archived' });
    await request(app.getHttpServer()).get(`${base}/characters`).expect(404);
    await db.getRepository(GameEntity).update({ id: gameId }, { status: 'active' });
  });
  it('enforces duplicate slugs, FK validity, mechanics version and atomic child replacement', async () => {
    await expect(writer.writeCharacter(gameId, published)).rejects.toMatchObject({ status: 409 });
    await expect(
      writer.writeCharacter(randomUUID(), { ...published, slug: 'orphan' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      writer.writeCharacter(gameId, { ...published, slug: 'bad', mechanicsSchemaVersion: 2 }),
    ).rejects.toMatchObject({ status: 400 });
    const other = await writer.createGame({ slug: 'second', name: 'Second' });
    await writer.writeCharacter(other.id, published); // Slugs are scoped to a game.
    const existing = await db
      .getRepository(CharacterEntity)
      .findOneByOrFail({ gameId, slug: 'allie' });
    await expect(
      writer.writeCharacter(
        gameId,
        {
          ...published,
          name: 'Lost update',
          stats: [
            { code: 'ATK', value: 1, level: 1 },
            { code: 'ATK', value: 2, level: 1 },
          ],
        },
        existing.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.getRepository(CharacterEntity).findOneByOrFail({ id: existing.id })).name,
    ).toBe('Allie');
    await writer.writeCharacter(
      gameId,
      { ...published, name: 'Allie Updated', aliases: ['New Alias'] },
      existing.id,
    );
    const detail = await request(app.getHttpServer()).get(`${base}/characters/allie`).expect(200);
    expect(detail.body.data.aliases).toEqual(['New Alias']);
    expect(detail.body.data.skills).toEqual([]);
    expect(detail.body.data.talents).toHaveLength(1);
    expect(detail.body.data.potentials).toHaveLength(1);
    await writer.writeCharacter(gameId, { ...published, talents: [], potentials: [] }, existing.id);
    const cleared = await request(app.getHttpServer()).get(`${base}/characters/allie`).expect(200);
    expect(cleared.body.data.talents).toEqual([]);
    expect(cleared.body.data.potentials).toEqual([]);
  }, 30000);
  it('has matching ORM/migration schema and enables RLS for every catalog table', async () => {
    const changes = await db.driver.createSchemaBuilder().log();
    expect(changes.upQueries.map((q) => q.query)).toEqual([]);
    const rows = await db.query(
      'SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname=$1 AND relname = ANY($2)',
      [
        schema,
        [
          'games',
          'game_versions',
          'characters',
          'character_aliases',
          'character_stats',
          'skills',
          'character_talents',
          'character_potentials',
        ],
      ],
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((r: { relrowsecurity: boolean }) => r.relrowsecurity)).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).length) continue;
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
        await runner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
        await runner.query(`SET LOCAL ROLE "${role}"`);
        expect(
          (await runner.query(`SELECT count(*)::int AS count FROM "${schema}".characters`))[0]
            .count,
        ).toBe(0);
        for (const table of ['character_talents', 'character_potentials']) {
          expect(
            (await runner.query(`SELECT count(*)::int AS count FROM "${schema}".${table}`))[0]
              .count,
          ).toBe(0);
        }
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    }
    const gameCount = await db.getRepository(GameEntity).count();
    await db.undoLastMigration();
    await db.runMigrations();
    expect(await db.getRepository(GameEntity).count()).toBe(gameCount);
  }, 60000);
});
