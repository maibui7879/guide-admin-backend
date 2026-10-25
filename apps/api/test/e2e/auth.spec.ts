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
import { authEntities } from '../../src/modules/auth/entities/auth.entities';
import { catalogEntities } from '../../src/modules/catalog/entities/catalog.entities';
import { UsersService } from '../../src/modules/auth/services/users.service';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';

jest.setTimeout(90000);
const origin = 'http://localhost:3001';
const password = 'Synthetic test-only password 123!';
const authBase = '/api/v1/admin/auth';
interface Credentials {
  cookie: string;
  csrf: string;
  userId: string;
}
function setCookies(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];
  return Array.isArray(header)
    ? header.filter((v): v is string => typeof v === 'string')
    : typeof header === 'string'
      ? [header]
      : [];
}
function cookies(response: { headers: Record<string, unknown> }): string {
  return setCookies(response)
    .filter((v) => !v.includes('Expires=Thu, 01 Jan 1970'))
    .map((v) => v.split(';')[0])
    .join('; ');
}
describe('real PostgreSQL staff authentication and authorization', () => {
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let users: UsersService;
  let gameId: string;
  let secondGame: string;
  let draftId: string;
  let publishedId: string;
  let adminId: string;
  let editorId: string;
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const character = {
    slug: 'test-character',
    name: 'Synthetic Character',
    element: 'Aqua',
    rarity: 5,
    status: 'draft',
  };
  async function challenge() {
    const response = await request(app.getHttpServer())
      .get(authBase + '/csrf')
      .set('Origin', origin)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return { cookie: cookies(response), csrf: response.body.data.csrfToken };
  }
  async function login(email: string): Promise<Credentials> {
    const csrf = await challenge();
    const response = await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Cookie', csrf.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.csrf)
      .send({ email, password })
      .expect(200);
    const session = setCookies(response).find((v) => v.startsWith('atlas_session='))!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Strict');
    expect(session).toContain('Path=/api/v1/admin');
    expect(JSON.stringify(response.body)).not.toContain('password_hash');
    return {
      cookie: session.split(';')[0],
      csrf: response.body.data.csrfToken,
      userId: response.body.data.user.id,
    };
  }
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('TEST_DATABASE_URL must target a disposable PostgreSQL database');
    const env = parseEnvironment({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOGIN_MAX_ATTEMPTS: '100',
    });
    const options = connectionOptions(env);
    admin = new DataSource({ type: 'postgres', ...options });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      ...options,
      schema,
      entities: [...catalogEntities, ...authEntities],
      migrations: [
        Foundation1792800000000,
        Catalog1792800001000,
        Identity1792800002000,
        CharacterProgression1792800006000,
      ],
      extra: { options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 },
    });
    await db.initialize();
    expect((await db.query('SELECT current_schema() AS schema'))[0].schema).toBe(schema);
    await db.runMigrations();
    users = new UsersService(db);
    adminId = (await users.create({ email: 'admin@example.com', password, roles: ['ADMIN'] }, true))
      .id;
    editorId = (await users.create({ email: 'editor@example.com', password, roles: ['EDITOR'] }))
      .id;
    await users.create({ email: 'reviewer@example.com', password, roles: ['REVIEWER'] });
    const writer = new CatalogWriterService(db);
    gameId = (await writer.createGame({ slug: 'first', name: 'First' })).id;
    secondGame = (await writer.createGame({ slug: 'second', name: 'Second' })).id;
    await users.games(editorId, [gameId]);
    draftId = (await writer.writeCharacter(gameId, character)).id;
    publishedId = (
      await writer.writeCharacter(gameId, {
        ...character,
        slug: 'published',
        status: 'published',
        sourceUrl: 'https://example.com/test',
        verifiedAt: '2026-10-24T00:00:00.000Z',
      })
    ).id;
    const module = await Test.createTestingModule({
      imports: [AppModule.register(db, env)],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttp(app, { ...env, LOG_LEVEL: 'silent' });
    await app.init();
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('keeps public GET anonymous and denies untrusted mutations and login CSRF', async () => {
    await request(app.getHttpServer()).get('/api/v1/games').expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/games/${gameId}/characters`)
      .send(character)
      .expect(401);
    await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Origin', origin)
      .send({ email: 'admin@example.com', password })
      .expect(403);
    const csrf = await challenge();
    await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Cookie', csrf.cookie)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrf.csrf)
      .send({ email: 'admin@example.com', password })
      .expect(403);
    const unknown = await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Cookie', csrf.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.csrf)
      .send({ email: 'unknown@example.com', password })
      .expect(401);
    const bad = await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Cookie', csrf.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.csrf)
      .send({ email: 'admin@example.com', password: 'incorrect' })
      .expect(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });
  it('stores only token digests and validates sessions, CSRF and rotation', async () => {
    const identity = await login('admin@example.com');
    const raw = identity.cookie.split('=')[1];
    const stored = await db.query('SELECT token_hash FROM sessions WHERE user_id=$1', [
      identity.userId,
    ]);
    expect(
      stored.every(
        (s: { token_hash: string }) => s.token_hash !== raw && s.token_hash.length === 64,
      ),
    ).toBe(true);
    const session = await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', identity.cookie)
      .expect(200);
    expect(session.body.data.user.permissions).toContain('users:manage');
    await request(app.getHttpServer())
      .post(authBase + '/rotate')
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .expect(403);
    await request(app.getHttpServer())
      .post(authBase + '/rotate')
      .set('Cookie', identity.cookie)
      .set('X-CSRF-Token', identity.csrf)
      .expect(403);
    const rotated = await request(app.getHttpServer())
      .post(authBase + '/rotate')
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .expect(200);
    expect(rotated.body.data.csrfToken).not.toBe(identity.csrf);
    expect(rotated.body.data.absoluteExpiresAt).toBe(session.body.data.absoluteExpiresAt);
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', identity.cookie)
      .expect(401);
    const newCookie = cookies(rotated);
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', newCookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(authBase + '/logout')
      .set('Cookie', newCookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', rotated.body.data.csrfToken)
      .expect(204);
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', newCookie)
      .expect(401);
  });
  it('rejects idle/absolute expiry, disabled users and forged cookies', async () => {
    const identity = await login('editor@example.com');
    await db.query(
      "UPDATE sessions SET idle_expires_at=now()-interval '1 second' WHERE user_id=$1",
      [editorId],
    );
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', identity.cookie)
      .expect(401);
    const absolute = await login('editor@example.com');
    await db.query(
      "UPDATE sessions SET idle_expires_at=now()-interval '2 seconds',absolute_expires_at=now()-interval '1 second' WHERE user_id=$1",
      [editorId],
    );
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', absolute.cookie)
      .expect(401);
    const disabled = await login('editor@example.com');
    await db.query('UPDATE users SET is_active=false WHERE id=$1', [editorId]);
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', disabled.cookie)
      .expect(401);
    await db.query('UPDATE users SET is_active=true WHERE id=$1', [editorId]);
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', 'atlas_session=forged')
      .expect(401);
  });
  it('enforces roles, game grants and draft-only writes without trusting submitted privileges', async () => {
    const editor = await login('editor@example.com');
    const reviewer = await login('reviewer@example.com');
    const target = `/api/v1/admin/games/${gameId}/characters`;
    const created = await request(app.getHttpServer())
      .post(target)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send({ ...character, slug: 'new-editor-draft' })
      .expect(201);
    expect(created.body.data.id).toBeTruthy();
    await request(app.getHttpServer())
      .get('/api/v1/games/first/characters/new-editor-draft')
      .expect(404);
    await request(app.getHttpServer())
      .post(target)
      .set('Cookie', reviewer.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', reviewer.csrf)
      .send(character)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/games/${secondGame}/characters`)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send(character)
      .expect(403);
    await request(app.getHttpServer())
      .post(target)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send({
        ...character,
        status: 'published',
        sourceUrl: 'https://example.com/test',
        verifiedAt: '2026-10-24T00:00:00.000Z',
      })
      .expect(403);
    await request(app.getHttpServer())
      .put(target + '/' + publishedId)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send(character)
      .expect(403);
    await request(app.getHttpServer())
      .put(target + '/' + draftId)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send({ ...character, name: 'Updated draft' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/users/${editorId}/roles`)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send({ roles: ['ADMIN'] })
      .expect(403);
    await request(app.getHttpServer())
      .post(target)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send({ ...character, roles: ['ADMIN'] })
      .expect(400);
    await users.games(editorId, []);
    await request(app.getHttpServer())
      .put(target + '/' + draftId)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', editor.csrf)
      .send(character)
      .expect(403);
  });
  it('protects user management, prevents last-admin removal and revokes role-changed sessions', async () => {
    const identity = await login('admin@example.com');
    const editor = await login('editor@example.com');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/users/${adminId}/roles`)
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .send({ roles: ['EDITOR'] })
      .expect(409);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/users/${editorId}/roles`)
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .send({ roles: ['REVIEWER'] })
      .expect(204);
    await request(app.getHttpServer())
      .get(authBase + '/session')
      .set('Cookie', editor.cookie)
      .expect(401);
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .send({ email: 'new@example.com', password, roles: ['EDITOR'] })
      .expect(201);
    expect(Object.keys(created.body.data).sort()).toEqual(['email', 'id', 'roles']);
    await expect(
      users.create({ email: 'another-admin@example.com', password, roles: ['ADMIN'] }, true),
    ).rejects.toMatchObject({ status: 409 });
    await request(app.getHttpServer())
      .post('/api/v1/admin/games')
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .send({ slug: 'admin-game', name: 'Admin Game' })
      .expect(201);
    const mismatch = await request(app.getHttpServer())
      .put(`/api/v1/admin/games/${secondGame}/characters/${draftId}`)
      .set('Cookie', identity.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', identity.csrf)
      .send(character)
      .expect(404);
    expect(mismatch.body.error.code).toBe('NOT_FOUND');
  });
  it('persists login throttling and leaves RLS enabled with no ORM schema drift', async () => {
    const csrf = await challenge();
    const reply = await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Cookie', csrf.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.csrf)
      .send({ email: 'rate-limited@example.com', password })
      .expect(401);
    expect(reply.body.error.message).toBe('Invalid email or password');
    await db.query('UPDATE login_buckets SET attempts=1001');
    const limited = await request(app.getHttpServer())
      .post(authBase + '/login')
      .set('Cookie', csrf.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.csrf)
      .send({ email: 'rate-limited@example.com', password })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many login attempts',
    });
    const changes = await db.driver.createSchemaBuilder().log();
    expect(changes.upQueries.map((q) => q.query)).toEqual([]);
    const tables = [
      'users',
      'roles',
      'permissions',
      'user_roles',
      'role_permissions',
      'sessions',
      'login_buckets',
      'user_game_access',
    ];
    const rows = await db.query(
      'SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND relname=ANY($2)',
      [schema, tables],
    );
    expect(rows).toHaveLength(tables.length);
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
          (await runner.query(`SELECT count(*)::int AS count FROM "${schema}".users`))[0].count,
        ).toBe(0);
        expect(
          (await runner.query(`SELECT count(*)::int AS count FROM "${schema}".sessions`))[0].count,
        ).toBe(0);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    }
    await revertThrough(db, 'Identity1792800002000');
    await db.runMigrations();
    expect((await db.query('SELECT count(*)::int AS count FROM users'))[0].count).toBe(0);
  });
});
