import { revertThrough } from '../helpers/migrations';
import { CharacterProgression1792800006000 } from '../../src/database/migrations/1792800006000-character-progression';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/common/http/configure-http';
import { parseEnvironment } from '../../src/config/env';
import { connectionOptions } from '../../src/database/connection-options';
import { Foundation1792800000000 } from '../../src/database/migrations/1792800000000-foundation';
import { Catalog1792800001000 } from '../../src/database/migrations/1792800001000-catalog';
import { Identity1792800002000 } from '../../src/database/migrations/1792800002000-identity';
import { Teams1792800005000 } from '../../src/database/migrations/1792800005000-teams';
import { catalogEntities } from '../../src/modules/catalog/entities/catalog.entities';
import { authEntities } from '../../src/modules/auth/entities/auth.entities';
import { TeamEntity } from '../../src/modules/teams/entities/team.entity';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';
import { UsersService } from '../../src/modules/auth/services/users.service';

jest.setTimeout(120000);
const origin = 'http://localhost:3001';
const password = 'Synthetic team test password 123!';
interface Credentials {
  cookie: string;
  csrf: string;
  userId: string;
}
interface Fields {
  slug: string;
  name: string;
  description: string;
  mainCharacterId: string;
  supportCharacterIds: string[];
  status: string;
}
interface Head extends Fields {
  id: string;
  gameId: string;
  version: number;
}
function cookies(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? header : typeof header === 'string' ? [header] : [])
    .map((value: string) => value.split(';')[0])
    .join('; ');
}
describe('real PostgreSQL Team CRUD', () => {
  let control: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let users: UsersService;
  let admin: Credentials;
  let editor: Credentials;
  let reviewer: Credentials;
  let gameId: string;
  let otherGame: string;
  let foreignCharacter: string;
  let draftCharacter: string;
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const characters: string[] = [];
  const lineups: { mainCharacterId: string; supportCharacterIds: string[] }[] = [];
  let cursor = 0;
  const base = () => `/api/v1/admin/games/${gameId}/teams`;
  const publicBase = '/api/v1/games/stella-sora/teams';
  function fields(): Fields {
    return {
      slug: `team-${randomUUID()}`,
      name: `Team ${cursor}`,
      description: 'Synthetic test team',
      status: 'draft',
      ...lineups[cursor++],
    };
  }
  function write(
    method: 'post' | 'put' | 'delete',
    path: string,
    actor: Credentials,
    body: object,
  ) {
    const server = request(app.getHttpServer());
    const operation =
      method === 'post'
        ? server.post(path)
        : method === 'put'
          ? server.put(path)
          : server.delete(path);
    return operation
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .send(body);
  }
  async function login(email: string): Promise<Credentials> {
    const challenge = await request(app.getHttpServer())
      .get('/api/v1/admin/auth/csrf')
      .set('Origin', origin)
      .expect(200);
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .set('Origin', origin)
      .set('Cookie', cookies(challenge))
      .set('X-CSRF-Token', challenge.body.data.csrfToken)
      .send({ email, password })
      .expect(200);
    return {
      cookie: cookies(response),
      csrf: response.body.data.csrfToken,
      userId: response.body.data.user.id,
    };
  }
  async function create(actor = admin, status = 'draft') {
    const value = { ...fields(), status };
    const response = await write('post', base(), actor, value).expect(201);
    return { fields: value, head: response.body.data as Head };
  }
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
    const env = parseEnvironment({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOGIN_MAX_ATTEMPTS: '100',
    });
    const opts = connectionOptions(env);
    control = new DataSource({ type: 'postgres', ...opts });
    await control.initialize();
    await control.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      ...opts,
      schema,
      entities: [...catalogEntities, ...authEntities, TeamEntity],
      migrations: [
        Foundation1792800000000,
        Catalog1792800001000,
        Identity1792800002000,
        Teams1792800005000,
        CharacterProgression1792800006000,
      ],
      extra: { options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 },
    });
    await db.initialize();
    expect((await db.query('SELECT current_schema() AS schema'))[0].schema).toBe(schema);
    await db.runMigrations();
    users = new UsersService(db);
    await users.create({ email: 'team-admin@example.com', password, roles: ['ADMIN'] }, true);
    const editorUser = await users.create({
      email: 'team-editor@example.com',
      password,
      roles: ['EDITOR'],
    });
    const reviewerUser = await users.create({
      email: 'team-reviewer@example.com',
      password,
      roles: ['REVIEWER'],
    });
    const writer = new CatalogWriterService(db);
    gameId = (await writer.createGame({ slug: 'stella-sora', name: 'Stella Sora' })).id;
    otherGame = (await writer.createGame({ slug: 'other', name: 'Other' })).id;
    await users.games(editorUser.id, [gameId]);
    await users.games(reviewerUser.id, [gameId]);
    const character = {
      name: 'Test',
      rarity: 5,
      element: 'Aqua',
      status: 'published',
      sourceUrl: 'https://example.com/test',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    };
    for (let i = 0; i < 4; i++)
      characters.push(
        (await writer.writeCharacter(gameId, { ...character, slug: `member-${i}` })).id,
      );
    foreignCharacter = (await writer.writeCharacter(otherGame, { ...character, slug: 'foreign' }))
      .id;
    draftCharacter = (
      await writer.writeCharacter(gameId, { ...character, slug: 'draft', status: 'draft' })
    ).id;
    for (const main of characters) {
      const others = characters.filter((id) => id !== main);
      for (let i = 0; i < others.length; i++)
        for (let j = i + 1; j < others.length; j++)
          lineups.push({ mainCharacterId: main, supportCharacterIds: [others[i], others[j]] });
    }
    const module = await Test.createTestingModule({
      imports: [AppModule.register(db, env)],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttp(app, { ...env, LOG_LEVEL: 'silent' });
    await app.init();
    admin = await login('team-admin@example.com');
    editor = await login('team-editor@example.com');
    reviewer = await login('team-reviewer@example.com');
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (control?.isInitialized) {
      await control.query(`DROP SCHEMA "${schema}" CASCADE`);
      await control.destroy();
    }
  });

  it('creates, reads, replaces, publishes, archives and restores a stable UUID', async () => {
    const record = await create(editor);
    let head = record.head;
    expect(head).toMatchObject({ gameId, status: 'draft', version: 1 });
    expect(head.supportCharacterIds).toEqual([...record.fields.supportCharacterIds].sort());
    await request(app.getHttpServer()).get(`${publicBase}/${head.slug}`).expect(404);
    const detail = await request(app.getHttpServer())
      .get(`${base()}/${head.id}`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.headers['x-robots-tag']).toBe('noindex, nofollow');
    const updated = await write('put', `${base()}/${head.id}`, admin, {
      ...record.fields,
      status: 'published',
      expectedVersion: head.version,
    }).expect(200);
    head = updated.body.data;
    const published = await request(app.getHttpServer())
      .get(`${publicBase}/${head.slug}`)
      .expect(200);
    expect(published.body.data.members.map((member: { role: string }) => member.role)).toEqual([
      'main',
      'support',
      'support',
    ]);
    expect(published.body.data.version).toBeUndefined();
    expect(published.body.data.id).toBe(head.id);
    const deleted = await write('delete', `${base()}/${head.id}`, admin, {
      expectedVersion: head.version,
    }).expect(200);
    head = deleted.body.data;
    expect(head.status).toBe('archived');
    await request(app.getHttpServer()).get(`${publicBase}/${head.slug}`).expect(404);
    const restored = await write('put', `${base()}/${head.id}`, admin, {
      ...record.fields,
      expectedVersion: head.version,
    }).expect(200);
    expect(restored.body.data).toMatchObject({ id: head.id, status: 'draft', version: 4 });
  });

  it('denies anonymous, CSRF-invalid, unscoped and reviewer mutations', async () => {
    const record = await create(editor);
    await request(app.getHttpServer()).post(base()).send(record.fields).expect(401);
    await request(app.getHttpServer())
      .put(`${base()}/${record.head.id}`)
      .set('Cookie', editor.cookie)
      .send({ ...record.fields, expectedVersion: 1 })
      .expect(403);
    await write('post', base(), reviewer, record.fields).expect(403);
    await write('put', `${base()}/${record.head.id}`, editor, {
      ...record.fields,
      status: 'published',
      expectedVersion: 1,
    }).expect(403);
    await request(app.getHttpServer())
      .get(`${base()}/${record.head.id}`)
      .set('Cookie', reviewer.cookie)
      .expect(200);
    await users.games(editor.userId, []);
    await write('put', `${base()}/${record.head.id}`, editor, {
      ...record.fields,
      expectedVersion: 1,
    }).expect(403);
    await request(app.getHttpServer()).get(base()).set('Cookie', editor.cookie).expect(403);
    await users.games(editor.userId, [gameId]);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/games/${otherGame}/teams/${record.head.id}`)
      .set('Cookie', admin.cookie)
      .expect(404);
    const archived = await write('delete', `${base()}/${record.head.id}`, editor, {
      expectedVersion: 1,
    }).expect(200);
    expect(archived.body.data.status).toBe('archived');
  });

  it('rejects duplicate slugs, duplicate canonical lineups, invalid membership and mass assignment', async () => {
    const record = await create();
    await expect(
      db.query('UPDATE teams SET main_character_id=$1 WHERE id=$2', [
        foreignCharacter,
        record.head.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23503', constraint: 'fk_teams_main' } });
    await expect(
      db.query('UPDATE characters SET game_id=$1 WHERE id=$2', [
        otherGame,
        record.fields.mainCharacterId,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await write('post', base(), admin, {
      ...record.fields,
      slug: `duplicate-${randomUUID()}`,
      supportCharacterIds: [...record.fields.supportCharacterIds].reverse(),
    }).expect(409);
    await write('post', base(), admin, { ...fields(), slug: record.head.slug }).expect(409);
    for (const supportCharacterIds of [
      [record.fields.mainCharacterId, characters[1]],
      [foreignCharacter, characters[2]],
      [characters[2], randomUUID()],
    ])
      await write('post', base(), admin, {
        ...record.fields,
        slug: `bad-${randomUUID()}`,
        supportCharacterIds,
      }).expect(400);
    await write('post', base(), admin, {
      ...record.fields,
      gameId: otherGame,
      id: randomUUID(),
    }).expect(400);
    await expect(
      db.query(
        'INSERT INTO teams(id,game_id,slug,name,main_character_id,support_one_id,support_two_id) VALUES($1,$2,$3,$4,$5,$5,$6)',
        [randomUUID(), gameId, 'invalid-db', 'Invalid', characters[0], characters[1]],
      ),
    ).rejects.toThrow();
  });

  it('publishes only visible members and hides teams if a member or game is unpublished', async () => {
    const value = { ...fields(), mainCharacterId: draftCharacter };
    const draft = await write('post', base(), admin, value).expect(201);
    await write('put', `${base()}/${draft.body.data.id}`, admin, {
      ...value,
      status: 'published',
      expectedVersion: 1,
    }).expect(400);
    const record = await create(admin, 'published');
    await write('delete', `${base()}/${record.head.id}`, editor, { expectedVersion: 1 }).expect(
      403,
    );
    await db.query("UPDATE characters SET status='draft' WHERE id=$1", [
      record.fields.mainCharacterId,
    ]);
    await request(app.getHttpServer()).get(`${publicBase}/${record.head.slug}`).expect(404);
    await db.query("UPDATE characters SET status='published' WHERE id=$1", [
      record.fields.mainCharacterId,
    ]);
    await db.query("UPDATE games SET status='archived' WHERE id=$1", [gameId]);
    try {
      await request(app.getHttpServer()).get(publicBase).expect(404);
      await request(app.getHttpServer()).get(`${publicBase}/${record.head.slug}`).expect(404);
    } finally {
      await db.query("UPDATE games SET status='active' WHERE id=$1", [gameId]);
    }
  });

  it('serializes concurrent writes and rejects stale deletes', async () => {
    const record = await create();
    const results = await Promise.all(
      ['A', 'B'].map((name) =>
        write('put', `${base()}/${record.head.id}`, admin, {
          ...record.fields,
          name,
          expectedVersion: 1,
        }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    await write('delete', `${base()}/${record.head.id}`, admin, { expectedVersion: 1 }).expect(409);
  });

  it('filters and paginates public teams without leaking drafts', async () => {
    await create(admin, 'published');
    const response = await request(app.getHttpServer())
      .get(`${publicBase}?limit=1&characterId=${characters[0]}`)
      .expect(200);
    expect(response.body.meta.limit).toBe(1);
    expect(
      response.body.data.every((team: { members: { characterId: string }[] }) =>
        team.members.some((member) => member.characterId === characters[0]),
      ),
    ).toBe(true);
    const empty = await request(app.getHttpServer()).get(`${publicBase}?page=1000000`).expect(200);
    expect(empty.body.data).toEqual([]);
    await request(app.getHttpServer()).get(`${publicBase}?status=draft`).expect(400);
    await request(app.getHttpServer()).get(`${publicBase}?characterId=invalid`).expect(400);
    await request(app.getHttpServer()).get(`${publicBase}?limit=101`).expect(400);
    const queue = await request(app.getHttpServer())
      .get(`${base()}?status=archived`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(queue.body.data.every((team: { status: string }) => team.status === 'archived')).toBe(
      true,
    );
  });

  it('has no schema drift, enables RLS and rolls back/reapplies without deleting characters', async () => {
    expect(
      (await db.driver.createSchemaBuilder().log()).upQueries.map((query) => query.query),
    ).toEqual([]);
    expect(
      (
        await db.query(
          'SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2',
          [schema, 'teams'],
        )
      )[0].relrowsecurity,
    ).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).length) continue;
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
        await runner.query(`GRANT SELECT ON "${schema}".teams TO "${role}"`);
        await runner.query(`SET LOCAL ROLE "${role}"`);
        expect(
          (await runner.query(`SELECT count(*)::int AS count FROM "${schema}".teams`))[0].count,
        ).toBe(0);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    }
    await revertThrough(db, 'Teams1792800005000');
    expect((await db.query('SELECT count(*)::int AS count FROM characters'))[0].count).toBe(6);
    await db.runMigrations();
    expect((await db.query('SELECT count(*)::int AS count FROM teams'))[0].count).toBe(0);
  });
});
