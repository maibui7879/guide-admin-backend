import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OutboxService } from '../../src/modules/jobs/outbox.service';
import { MediaStorage } from '../../src/modules/media/media-storage';
import { createDataSource } from '../../src/database/data-source';
import { AppModule } from '../../src/app.module';
import { parseEnvironment } from '../../src/config/env';
import { configureHttp } from '../../src/common/http/configure-http';
import { UsersService } from '../../src/modules/auth/services/users.service';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';
import { revertThrough } from '../helpers/migrations';

jest.setTimeout(120000);
const schema = `test_${randomUUID().replaceAll('-', '')}`,
  origin = 'http://localhost:3001';
const password = 'Synthetic strategy-test password 123!';
type Actor = { cookie: string; csrf: string };
const cookie = (res: { headers: Record<string, unknown> }) =>
  (res.headers['set-cookie'] as string[]).map((v) => v.split(';')[0]).join('; ');
describe('Equipment, build and tier-list persistence', () => {
  let root: DataSource;
  let db: DataSource,
    app: INestApplication,
    admin: Actor,
    editor: Actor,
    outsider: Actor,
    game: string,
    otherGame: string,
    char: string,
    otherChar: string;
  const api = (g = game) => `/api/v1/admin/games/${g}`;
  const pub = '/api/v1/games/stella-sora';
  const write = (method: 'post' | 'patch', path: string, body: object, actor = admin) => {
    const server = request(app.getHttpServer());
    return server[method](path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .send(body);
  };
  async function login(email: string) {
    const challenge = await request(app.getHttpServer())
      .get('/api/v1/admin/auth/csrf')
      .set('Origin', origin)
      .expect(200);
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .set('Origin', origin)
      .set('Cookie', cookie(challenge))
      .set('X-CSRF-Token', challenge.body.data.csrfToken)
      .send({ email, password })
      .expect(200);
    return { cookie: cookie(response), csrf: response.body.data.csrfToken };
  }
  const equipment = (slug = 'test-disc') => ({
    slug,
    name: 'Synthetic disc',
    category: 'disc',
    rarity: 5,
    description: 'Integration fixture, not game advice.',
  });
  const payload = (id: string, title = 'Synthetic build') => ({
    title,
    description: 'Integration fixture.',
    gameVersionId: null,
    recommendations: [
      { equipmentId: id, slot: 'main', rank: 1, notes: 'Synthetic recommendation' },
    ],
  });
  async function publishedEquipment(slug: string) {
    let data = (await write('post', api() + '/equipment', equipment(slug)).expect(201)).body.data;
    data = (
      await write('post', api() + `/equipment/${data.id}/publish`, {
        expectedVersion: data.version,
      }).expect(200)
    ).body.data;
    return data;
  }
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw Error('TEST_DATABASE_URL is required');
    const env = parseEnvironment({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOGIN_MAX_ATTEMPTS: '100',
    });
    root = createDataSource(env);
    await root.initialize();
    await root.query(`CREATE SCHEMA "${schema}"`);
    const rootOptions = root.options;
    if (rootOptions.type !== 'postgres') throw Error('PostgreSQL is required');
    db = new DataSource({
      ...rootOptions,
      schema,
      extra: {
        options: `-c search_path=${schema}`,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      },
    });
    await db.initialize();
    await db.runMigrations();
    const users = new UsersService(db);
    await users.create({ email: 'strategy-admin@example.com', password, roles: ['ADMIN'] }, true);
    const e = await users.create({
      email: 'strategy-editor@example.com',
      password,
      roles: ['EDITOR'],
    });
    await users.create({ email: 'strategy-outsider@example.com', password, roles: ['EDITOR'] });
    const catalog = new CatalogWriterService(db);
    game = (await catalog.createGame({ slug: 'stella-sora', name: 'Test game' })).id;
    otherGame = (await catalog.createGame({ slug: 'other-strategy', name: 'Other' })).id;
    await users.games(e.id, [game]);
    const character = {
      slug: 'test',
      name: 'Test',
      rarity: 5,
      element: 'Aqua',
      status: 'published',
      sourceUrl: 'https://example.com',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    };
    char = (await catalog.writeCharacter(game, character)).id;
    otherChar = (await catalog.writeCharacter(otherGame, character)).id;
    const module = await Test.createTestingModule({
      imports: [AppModule.register(db, env)],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttp(app, { ...env, LOG_LEVEL: 'silent' });
    await app.init();
    admin = await login('strategy-admin@example.com');
    editor = await login('strategy-editor@example.com');
    outsider = await login('strategy-outsider@example.com');
  });
  afterAll(async () => {
    if (app && db?.isInitialized) {
      const keys = await db.query<{ storage_key: string }[]>(
        'SELECT storage_key FROM media_assets',
      );
      await Promise.allSettled(keys.map((k) => app.get(MediaStorage).remove(k.storage_key)));
    }
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (root?.isInitialized) {
      await root.query(`DROP SCHEMA "${schema}" CASCADE`);
      await root.destroy();
    }
  });
  it('protects equipment mutations, drafts and optimistic versions', async () => {
    await request(app.getHttpServer())
      .post(api() + '/equipment')
      .send(equipment())
      .expect(401);
    await write('post', api() + '/equipment', equipment(), outsider).expect(403);
    let e = (await write('post', api() + '/equipment', equipment(), editor).expect(201)).body.data;
    await request(app.getHttpServer())
      .get(pub + '/equipment/test-disc')
      .expect(404);
    await write('post', api() + '/equipment', equipment()).expect(409);
    await write(
      'post',
      api() + `/equipment/${e.id}/publish`,
      { expectedVersion: 1 },
      editor,
    ).expect(403);
    e = (
      await write('post', api() + `/equipment/${e.id}/publish`, { expectedVersion: 1 }).expect(200)
    ).body.data;
    await request(app.getHttpServer())
      .get(pub + '/equipment/test-disc')
      .expect(200);
    await write('patch', api() + `/equipment/${e.id}`, {
      ...equipment(),
      expectedVersion: 1,
    }).expect(400);
    const replacement = {
      name: 'Synthetic disc',
      category: 'disc',
      rarity: 5,
      description: 'Replacement fixture',
    };
    await write('patch', api() + `/equipment/${e.id}`, {
      ...replacement,
      expectedVersion: 1,
    }).expect(409);
    e = (
      await write(
        'patch',
        api() + `/equipment/${e.id}`,
        { ...replacement, expectedVersion: e.version },
        editor,
      ).expect(200)
    ).body.data;
    await request(app.getHttpServer())
      .get(pub + '/equipment/test-disc')
      .expect(404);
    await write('post', api() + `/equipment/${e.id}/archive`, {
      expectedVersion: e.version,
    }).expect(200);
    await write('post', api() + `/equipment/${e.id}/publish`, {
      expectedVersion: e.version + 1,
    }).expect(409);
    await request(app.getHttpServer())
      .get(pub + '/equipment?status=draft')
      .expect(400);
  });
  it('publishes equipment-backed builds and preserves the old publication during editing/restore', async () => {
    const e = await publishedEquipment('build-disc');
    await write('post', api() + '/builds', {
      slug: 'cross-game',
      characterId: otherChar,
      payload: payload(e.id),
    }).expect(400);
    await write('post', api(otherGame) + '/builds', {
      slug: 'cross-equipment',
      characterId: otherChar,
      payload: payload(e.id),
    }).expect(400);
    await write('post', api() + '/builds', {
      slug: 'duplicate-rank',
      characterId: char,
      payload: {
        ...payload(e.id),
        recommendations: [...payload(e.id).recommendations, ...payload(e.id).recommendations],
      },
    }).expect(400);
    let b = (
      await write(
        'post',
        api() + '/builds',
        { slug: 'character-build', characterId: char, payload: payload(e.id) },
        editor,
      ).expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .get(pub + '/builds/character-build')
      .expect(404);
    b = (
      await write('post', api() + `/builds/${b.id}/publish`, { expectedVersion: b.version }).expect(
        200,
      )
    ).body.data;
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/builds/character-build')
          .expect(200)
      ).body.data.payload.title,
    ).toBe('Synthetic build');
    const stale = b.version;
    b = (
      await write(
        'patch',
        api() + `/builds/${b.id}/draft`,
        { expectedVersion: b.version, payload: payload(e.id, 'Changed draft') },
        editor,
      ).expect(200)
    ).body.data;
    await write('post', api() + `/builds/${b.id}/publish`, { expectedVersion: stale }).expect(409);
    const publicData = (
      await request(app.getHttpServer())
        .get(pub + '/builds/character-build')
        .expect(200)
    ).body.data;
    expect(publicData.payload.title).toBe('Synthetic build');
    expect(publicData).not.toHaveProperty('currentRevision');
    b = (
      await write(
        'post',
        api() + `/builds/${b.id}/restore`,
        { expectedVersion: b.version, sourceRevision: 1 },
        editor,
      ).expect(200)
    ).body.data;
    expect(b.currentRevision).toBe(3);
    const revisions = await request(app.getHttpServer())
      .get(api() + `/builds/${b.id}/revisions?limit=1`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(revisions.body.meta.total).toBe(3);
    await expect(db.query('UPDATE strategy_revisions SET payload=payload')).rejects.toThrow(
      'append-only',
    );
    b = (
      await write('post', api() + `/builds/${b.id}/unpublish`, {
        expectedVersion: b.version,
      }).expect(200)
    ).body.data;
    await request(app.getHttpServer())
      .get(pub + '/builds/character-build')
      .expect(404);
    b = (
      await write('post', api() + `/builds/${b.id}/publish`, { expectedVersion: b.version }).expect(
        200,
      )
    ).body.data;
    await write('post', api() + `/equipment/${e.id}/archive`, {
      expectedVersion: e.version,
    }).expect(200);
    await request(app.getHttpServer())
      .get(pub + '/builds/character-build')
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/builds')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
  });
  it('validates ordered tier categories and hides publications with unavailable characters', async () => {
    const p = {
      title: 'Synthetic tiers',
      description: 'Fixture',
      scope: 'Synthetic scope',
      categories: [
        {
          key: 's',
          title: 'S',
          entries: [{ characterId: char, explanation: 'Synthetic explanation' }],
        },
      ],
    };
    await write('post', api() + '/tier-lists', {
      slug: 'bad-tiers',
      payload: { ...p, categories: [...p.categories, ...p.categories] },
    }).expect(400);
    await write('post', api() + '/tier-lists', {
      slug: 'cross-tiers',
      payload: {
        ...p,
        categories: [
          { key: 's', title: 'S', entries: [{ characterId: otherChar, explanation: 'Test' }] },
        ],
      },
    }).expect(400);
    let t = (
      await write('post', api() + '/tier-lists', { slug: 'test-tiers', payload: p }, editor).expect(
        201,
      )
    ).body.data;
    t = (
      await write('post', api() + `/tier-lists/${t.id}/publish`, {
        expectedVersion: t.version,
      }).expect(200)
    ).body.data;
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/tier-lists/test-tiers')
          .expect(200)
      ).body.data.payload.categories,
    ).toEqual(p.categories);
    await db.query("UPDATE characters SET status='draft' WHERE id=$1", [char]);
    await request(app.getHttpServer())
      .get(pub + '/tier-lists/test-tiers')
      .expect(404);
    await db.query("UPDATE characters SET status='published' WHERE id=$1", [char]);
    await write('post', api() + `/tier-lists/${t.id}/archive`, {
      expectedVersion: t.version,
    }).expect(200);
    await request(app.getHttpServer())
      .get(pub + '/tier-lists/test-tiers')
      .expect(404);
  });
  it('searches aliases and published snapshots without leaking later drafts or unpublished content', async () => {
    await db.query(
      'INSERT INTO character_aliases(id,character_id,alias,position) VALUES($1,$2,$3,0)',
      [randomUUID(), char, 'Harbor Sentinel'],
    );
    const e = await publishedEquipment('harbor-disc');
    let g = (
      await write(
        'post',
        '/api/v1/admin/contents',
        {
          gameId: game,
          slug: 'harbor-guide',
          wiki: { kind: 'character', characterId: char },
          title: 'Harbor guide',
          description: 'Published search fixture',
          category: 'character',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Moonharbor public explanation.' }],
              },
            ],
          },
        },
        editor,
      ).expect(201)
    ).body.data;
    for (const [action, actor] of [
      ['submit-review', editor],
      ['approve', admin],
      ['publish', admin],
    ] as const)
      g = (
        await write(
          'post',
          `/api/v1/admin/contents/${g.id}/${action}`,
          { expectedRevision: g.version },
          actor,
        ).expect(200)
      ).body.data;
    g = (
      await write(
        'patch',
        `/api/v1/admin/contents/${g.id}/draft`,
        {
          expectedRevision: g.version,
          title: 'Secretnova draft',
          description: 'Private draft',
          category: 'character',
          body: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Secretnova private text' }] },
            ],
          },
        },
        editor,
      ).expect(200)
    ).body.data;
    const result = await request(app.getHttpServer())
      .get(pub + '/search?q=harbor')
      .expect(200);
    expect(
      result.body.data.some(
        (r: { id: string; kind: string }) => r.id === char && r.kind === 'character',
      ),
    ).toBe(true);
    expect(result.body.data.some((r: { id: string }) => r.id === g.id)).toBe(true);
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/search?q=Secretnova')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/search?q=Moonharbor&kind=guide')
          .expect(200)
      ).body.meta.total,
    ).toBe(1);
    await write('post', `/api/v1/admin/contents/${g.id}/unpublish`, {
      expectedRevision: g.version,
    }).expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/search?q=Moonharbor')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    const b = (
      await write('post', api() + '/builds', {
        slug: 'harbor-build',
        characterId: char,
        payload: payload(e.id, 'Harbor build'),
      }).expect(201)
    ).body.data;
    await write('post', api() + `/builds/${b.id}/publish`, { expectedVersion: b.version }).expect(
      200,
    );
    const builds = await request(app.getHttpServer())
      .get(pub + '/search?q=harbor&kind=build')
      .expect(200);
    expect(builds.body.meta.total).toBe(1);
    expect(builds.headers['cache-control']).toBe('no-store');
    await write('post', api() + `/builds/${b.id}/archive`, {
      expectedVersion: b.version + 1,
    }).expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(pub + '/search?q=harbor&kind=build')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    await request(app.getHttpServer())
      .get(pub + '/search?q=a')
      .expect(400);
    await request(app.getHttpServer())
      .get(pub + '/search?q=harbor&status=draft')
      .expect(400);
    await request(app.getHttpServer()).get('/api/v1/games/missing/search?q=harbor').expect(404);
  });
  it('stages imports idempotently, applies atomically and captures real before/after snapshots', async () => {
    const input = {
      slug: 'import-fixture',
      name: 'Imported fixture',
      rarity: 5,
      element: 'Aqua',
      status: 'published',
      sourceUrl: 'https://example.com/import',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    };
    const staged = {
      idempotencyKey: randomUUID(),
      sourceUrl: 'https://example.com/import',
      records: [{ input }],
    };
    await write('post', api() + '/imports', staged, editor).expect(403);
    const batch = (await write('post', api() + '/imports', staged).expect(201)).body.data;
    expect((await write('post', api() + '/imports', staged).expect(201)).body.data.id).toBe(
      batch.id,
    );
    await write('post', api() + '/imports', {
      ...staged,
      sourceUrl: 'https://example.com/different',
    }).expect(409);
    await request(app.getHttpServer())
      .get(pub + '/characters/import-fixture')
      .expect(404);
    const applied = (
      await write('post', api() + `/imports/${batch.id}/apply`, { expectedVersion: 1 }).expect(200)
    ).body.data;
    expect(applied.result).toHaveLength(1);
    expect(
      (
        await write('post', api() + `/imports/${batch.id}/apply`, { expectedVersion: 1 }).expect(
          200,
        )
      ).body.data.result,
    ).toEqual(applied.result);
    await request(app.getHttpServer())
      .get(pub + '/characters/import-fixture')
      .expect(200);
    const diffs = await request(app.getHttpServer())
      .get(api() + '/patch-diffs')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(diffs.body.data[0]).toMatchObject({
      before: null,
      after: { profile: { slug: 'import-fixture' } },
    });
    const conflict = (
      await write('post', api() + '/imports', {
        idempotencyKey: randomUUID(),
        sourceUrl: 'https://example.com/import',
        records: [
          { input: { ...input, slug: 'must-roll-back' } },
          { id: char, input: { ...input, slug: 'test', name: 'Staged replacement' } },
        ],
      }).expect(201)
    ).body.data;
    await db.query("UPDATE characters SET name='Intervening edit',updated_at=now() WHERE id=$1", [
      char,
    ]);
    await write('post', api() + `/imports/${conflict.id}/apply`, { expectedVersion: 1 }).expect(
      409,
    );
    expect(
      await db.query("SELECT id FROM characters WHERE game_id=$1 AND slug='must-roll-back'", [
        game,
      ]),
    ).toHaveLength(0);
    await write('post', api() + `/imports/${conflict.id}/cancel`, { expectedVersion: 1 }).expect(
      200,
    );
    await write('post', api() + `/imports/${conflict.id}/apply`, { expectedVersion: 2 }).expect(
      409,
    );
    await expect(db.query('UPDATE patch_diffs SET after_snapshot=after_snapshot')).rejects.toThrow(
      'append-only',
    );
  });
  it('commits outbox events with source mutations and processes review effects exactly once', async () => {
    const [{ total: before }] = await db.query('SELECT count(*)::int AS total FROM outbox_events');
    await expect(
      db.transaction(async (m) => {
        await m.query("UPDATE characters SET name='Rolled back' WHERE id=$1", [char]);
        throw Error('Synthetic rollback');
      }),
    ).rejects.toThrow('Synthetic rollback');
    expect((await db.query('SELECT count(*)::int AS total FROM outbox_events'))[0].total).toBe(
      before,
    );
    await db.transaction(async (m) => {
      await m.query("UPDATE characters SET name='Changed metadata' WHERE id=$1", [char]);
      await m.query(
        "INSERT INTO character_aliases(id,character_id,alias,position) VALUES($1,$2,'Fresh alias',1)",
        [randomUUID(), char],
      );
    });
    const [event] = await db.query(
      'SELECT id FROM outbox_events WHERE aggregate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [char],
    );
    const processor = new OutboxService(db);
    await processor.process(event.id);
    const count = (
      await db.query(
        'SELECT count(*)::int AS total FROM editorial_review_flags WHERE event_id=$1',
        [event.id],
      )
    )[0].total;
    expect(count).toBeGreaterThan(0);
    const version = (
      await db.query('SELECT version FROM game_content_versions WHERE game_id=$1', [game])
    )[0].version;
    await Promise.all([processor.process(event.id), processor.process(event.id)]);
    expect(
      (await db.query('SELECT version FROM game_content_versions WHERE game_id=$1', [game]))[0]
        .version,
    ).toBe(version);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS total FROM editorial_review_flags WHERE event_id=$1',
          [event.id],
        )
      )[0].total,
    ).toBe(count);
    const flags = await request(app.getHttpServer())
      .get(api() + '/review-flags')
      .set('Cookie', editor.cookie)
      .expect(200);
    const flag = flags.body.data.find(
      (f: { id: string; reason: string }) => f.reason === 'character_updated',
    );
    expect(flag).toBeDefined();
    await write(
      'post',
      api() + `/review-flags/${flag.id}/resolve`,
      { note: 'Reviewed against the new source.' },
      editor,
    ).expect(403);
    await write('post', api() + `/review-flags/${flag.id}/resolve`, {
      note: 'Reviewed against the new source.',
    }).expect(200);
    await write('post', api() + `/review-flags/${flag.id}/resolve`, {
      note: 'Repeated resolution',
    }).expect(409);
    const catalog = new CatalogWriterService(db);
    const patch = await catalog.createVersion(game, {
      version: 'synthetic-new-patch',
      status: 'published',
    });
    const [patchEvent] = await db.query(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='game.patch.released'",
      [patch.id],
    );
    await processor.process(patchEvent.id);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS total FROM editorial_review_flags WHERE event_id=$1 AND reason='patch_released'",
          [patchEvent.id],
        )
      )[0].total,
    ).toBeGreaterThan(0);
  });
  it('recovers queue outages, expired leases and failed-event replay without duplicate claims', async () => {
    const processor = new OutboxService(db);
    await processor.dispatch(
      {
        enqueue: async () => {
          throw Error('Synthetic Redis outage');
        },
      },
      1,
    );
    const [failedDispatch] = await db.query(
      "SELECT * FROM outbox_events WHERE error_code='QUEUE_UNAVAILABLE' ORDER BY created_at LIMIT 1",
    );
    expect(failedDispatch.state).toBe('pending');
    expect(failedDispatch.dispatch_attempts).toBe(1);
    await db.query(
      "UPDATE outbox_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
      [failedDispatch.id],
    );
    const claimed: string[] = [];
    const queue = {
      enqueue: async (id: string) => {
        claimed.push(id);
        await processor.process(id);
      },
    };
    await Promise.all([processor.dispatch(queue, 1), processor.dispatch(queue, 1)]);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(
      (await db.query('SELECT state FROM outbox_events WHERE id=$1', [claimed[0]]))[0].state,
    ).toBe('completed');
    const id = randomUUID();
    await db.query(
      "INSERT INTO outbox_events(id,game_id,event_type,aggregate_id,state,dispatch_attempts,lease_until) VALUES($1,$2,'content.published',$3,'dispatching',20,now()-interval '1 minute')",
      [id, game, randomUUID()],
    );
    await processor.dispatch(queue, 1);
    expect((await db.query('SELECT state FROM outbox_events WHERE id=$1', [id]))[0].state).toBe(
      'failed',
    );
    await request(app.getHttpServer())
      .get(api() + '/jobs')
      .set('Cookie', editor.cookie)
      .expect(403);
    await write('post', api() + `/jobs/${id}/replay`, {}).expect(200);
    expect(
      (await db.query('SELECT state,dispatch_attempts FROM outbox_events WHERE id=$1', [id]))[0],
    ).toMatchObject({ state: 'pending', dispatch_attempts: 0 });
    await write('post', api() + `/jobs/${id}/replay`, {}).expect(409);
  });
  it('serves uploaded character art only for published characters and protects assigned images', async () => {
    const { default: sharp } = await import('sharp');
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#445588' },
    })
      .png()
      .toBuffer();
    const upload = await request(app.getHttpServer())
      .post(api() + '/media')
      .set('Cookie', admin.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', admin.csrf)
      .attach('file', bytes, 'character.png')
      .expect(201);
    const id = upload.body.data.id,
      path = api() + `/characters/${char}/media`;
    await write(
      'patch',
      path,
      { expectedVersion: 0, portraitMediaId: id, portraitAlt: 'Synthetic portrait' },
      editor,
    ).expect(403);
    await write('patch', path, {
      expectedVersion: 0,
      portraitMediaId: id,
      portraitAlt: 'Synthetic portrait',
    }).expect(200);
    await write('patch', path, { expectedVersion: 0 }).expect(409);
    const art = await request(app.getHttpServer())
      .get(pub + '/characters/test/media')
      .expect(200);
    expect(art.body.data.portrait.mediaId).toBe(id);
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(200);
    const usages = await request(app.getHttpServer())
      .get(`/api/v1/admin/media/${id}/usages`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(usages.body).toMatchObject({
      data: [
        { contentId: null, characterId: char, revision: null, isCurrent: true, isPublished: true },
      ],
      meta: { total: 1 },
    });
    const remove = () =>
      request(app.getHttpServer())
        .delete('/api/v1/admin/media/' + id)
        .set('Cookie', admin.cookie)
        .set('Origin', origin)
        .set('X-CSRF-Token', admin.csrf);
    await remove().expect(409);
    await expect(
      db.query('UPDATE media_assets SET deleted_at=now() WHERE id=$1', [id]),
    ).rejects.toThrow('Referenced media');
    await db.query("UPDATE characters SET status='draft' WHERE id=$1", [char]);
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(404);
    await request(app.getHttpServer())
      .get(pub + '/characters/test/media')
      .expect(404);
    await write(
      'patch',
      path,
      { expectedVersion: 1, imageMediaId: id, imageAlt: 'Draft illustration' },
      editor,
    ).expect(200);
    await db.query("UPDATE characters SET status='published' WHERE id=$1", [char]);
    await write('patch', path, { expectedVersion: 2 }).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(404);
    await remove().expect(204);
  });
  it('exposes metrics only to administrators and counts fresh worker heartbeats', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations/metrics')
      .set('Cookie', editor.cookie)
      .expect(403);
    const id = randomUUID();
    await db.query('INSERT INTO worker_heartbeats(id) VALUES($1)', [id]);
    const metrics = await request(app.getHttpServer())
      .get('/api/v1/admin/operations/metrics')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(metrics.body.data.activeWorkers).toBe(1);
    expect(metrics.body.data.http.requestCount).toBeGreaterThan(0);
    expect(Array.isArray(metrics.body.data.outboxStates)).toBe(true);
    await db.query('UPDATE worker_heartbeats SET stopped_at=now() WHERE id=$1', [id]);
  });
  (process.env.TEST_REDIS_URL ? it : it.skip)(
    'runs BullMQ retries against a real isolated Redis queue',
    async () => {
      const { Queue, Worker } = await import('bullmq');
      const url = new URL(process.env.TEST_REDIS_URL!);
      const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        db: Number(url.pathname.slice(1) || 0),
        ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      };
      const name = 'atlas-test-' + randomUUID(),
        queue = new Queue(name, { connection: { ...connection, maxRetriesPerRequest: 1 } }),
        processor = new OutboxService(db);
      const id = randomUUID();
      await db.query(
        "INSERT INTO outbox_events(id,game_id,event_type,aggregate_id) VALUES($1,$2,'content.published',$3)",
        [id, game, randomUUID()],
      );
      let attempts = 0;
      const worker = new Worker(
        name,
        async (job) => {
          attempts++;
          if (attempts < 3) throw Error('Synthetic retry');
          await processor.process(job.data.eventId);
        },
        { connection: { ...connection, maxRetriesPerRequest: null } },
      );
      worker.on('error', () => {});
      try {
        await worker.waitUntilReady();
        await queue.add(
          'domain-event',
          { eventId: id },
          {
            jobId: id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 50 },
            removeOnComplete: true,
          },
        );
        for (let n = 0; n < 100; n++) {
          if (
            (await db.query('SELECT state FROM outbox_events WHERE id=$1', [id]))[0].state ===
            'completed'
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        expect((await db.query('SELECT state FROM outbox_events WHERE id=$1', [id]))[0].state).toBe(
          'completed',
        );
        expect(attempts).toBe(3);
        expect(
          (
            await db.query(
              'SELECT count(*)::int AS total FROM processed_events WHERE event_id=$1',
              [id],
            )
          )[0].total,
        ).toBe(1);
      } finally {
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    },
  );
  it('enforces same-game foreign keys, RLS and migration rollback/reapply', async () => {
    const rows = await db.query(
      'SELECT relname,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND relname=ANY($2)',
      [
        schema,
        [
          'equipment',
          'strategy_pages',
          'strategy_revisions',
          'strategy_references',
          'strategy_audit',
        ],
      ],
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r: { relrowsecurity: boolean }) => r.relrowsecurity)).toBe(true);
    expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
    await revertThrough(db, 'Strategy1792800010000');
    await db.runMigrations();
    expect((await db.query('SELECT count(*)::int AS total FROM strategy_pages'))[0].total).toBe(0);
  });
});
