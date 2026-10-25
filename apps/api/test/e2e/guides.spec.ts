import { GuideMedia1792800008000 } from '../../src/database/migrations/1792800008000-guide-media';
import { MediaLibrary1792800009000 } from '../../src/database/migrations/1792800009000-media-library';
import { CharacterMedia1792800015000 } from '../../src/database/migrations/1792800015000-character-media';
import { mediaEntities } from '../../src/modules/media/media.entities';
import { MediaStorage } from '../../src/modules/media/media-storage';
import sharp from 'sharp';
import { WikiIdentity1792800007000 } from '../../src/database/migrations/1792800007000-wiki-identity';
import { Teams1792800005000 } from '../../src/database/migrations/1792800005000-teams';
import { TeamEntity } from '../../src/modules/teams/entities/team.entity';
import { revertThrough } from '../helpers/migrations';
import { CharacterProgression1792800006000 } from '../../src/database/migrations/1792800006000-character-progression';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
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
import { GuideCategories1792800004000 } from '../../src/database/migrations/1792800004000-guide-categories';
import { Publishing1792800003000 } from '../../src/database/migrations/1792800003000-publishing';
import { authEntities } from '../../src/modules/auth/entities/auth.entities';
import { catalogEntities } from '../../src/modules/catalog/entities/catalog.entities';
import { contentEntities } from '../../src/modules/guides/entities/content.entities';
import { AuditEntryEntity } from '../../src/modules/audit/entities/audit-entry.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { UsersService } from '../../src/modules/auth/services/users.service';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';
import { ContentMutationDto } from '../../src/modules/guides/dto/content-response.dto';

jest.setTimeout(120000);
const origin = 'http://localhost:3001';
const password = 'Synthetic guide-test password 123!';
const base = '/api/v1/admin/contents';
const publicBase = '/api/v1/games/stella-sora/guides';
interface Credentials {
  cookie: string;
  csrf: string;
  userId: string;
}
function cookies(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
  return values.map((value: string) => value.split(';')[0]).join('; ');
}
function fields(text = 'Synthetic guide text, not game advice.') {
  return {
    title: text,
    description: 'Synthetic integration fixture.',
    category: 'beginner',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    sources: [{ url: 'https://example.com/test-source', label: 'Test source', verifiedAt: null }],
  };
}

describe('PostgreSQL guide revisions, review and publication', () => {
  let adminDb: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let users: UsersService;
  let admin: Credentials;
  let editor: Credentials;
  let reviewer: Credentials;
  let outsider: Credentials;
  let gameId: string;
  let otherGameId: string;
  let characterId: string;
  let patchId: string;
  let otherCharacterId: string;
  let otherPatchId: string;
  let draftCharacterId: string;
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const files = new Map<string, Buffer>();

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
  function mutation(method: 'post' | 'patch', path: string, actor: Credentials, body: object) {
    const server = request(app.getHttpServer());
    const operation = method === 'post' ? server.post(path) : server.patch(path);
    if (method === 'post' && path === base && !('wiki' in body))
      body = { ...body, wiki: { kind: 'game', topic: 'overview' } };
    return operation
      .set('Origin', origin)
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrf)
      .send(body);
  }
  async function create(
    actor = editor,
    extra: Record<string, unknown> = {},
  ): Promise<ContentMutationDto> {
    const primary = extra.wiki
      ? null
      : await new CatalogWriterService(db).writeCharacter(String(extra.gameId ?? gameId), {
          slug: 'wiki-' + randomUUID(),
          name: 'Wiki fixture',
          rarity: 5,
          element: 'Aqua',
          status: 'published',
          sourceUrl: 'https://example.com/wiki',
          verifiedAt: '2026-10-24T00:00:00.000Z',
        });
    const response = await mutation('post', base, actor, {
      wiki: { kind: 'character', characterId: primary?.id },
      gameId,
      slug: `guide-${randomUUID()}`,
      ...fields(),
      ...extra,
    }).expect(201);
    return response.body.data;
  }
  async function command(
    content: ContentMutationDto,
    action: string,
    actor: Credentials,
    extra: Record<string, unknown> = {},
  ): Promise<ContentMutationDto> {
    const response = await mutation('post', `${base}/${content.id}/${action}`, actor, {
      expectedRevision: content.version,
      ...extra,
    }).expect(200);
    return response.body.data;
  }
  async function published(extra: Record<string, unknown> = {}) {
    let content = await create(editor, extra);
    content = await command(content, 'submit-review', editor);
    content = await command(content, 'approve', reviewer);
    return command(content, 'publish', admin);
  }

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('TEST_DATABASE_URL must target disposable PostgreSQL');
    const env = parseEnvironment({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOGIN_MAX_ATTEMPTS: '100',
    });
    const opts = connectionOptions(env);
    adminDb = new DataSource({ type: 'postgres', ...opts });
    await adminDb.initialize();
    await adminDb.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      ...opts,
      schema,
      entities: [
        ...catalogEntities,
        ...authEntities,
        ...contentEntities,
        ...mediaEntities,
        AuditEntryEntity,
        TeamEntity,
      ],
      migrations: [
        Foundation1792800000000,
        Catalog1792800001000,
        Identity1792800002000,
        Publishing1792800003000,
        GuideCategories1792800004000,
        CharacterProgression1792800006000,
        Teams1792800005000,
        WikiIdentity1792800007000,
        GuideMedia1792800008000,
        MediaLibrary1792800009000,
        CharacterMedia1792800015000,
      ],
      extra: {
        options: `-c search_path=${schema}`,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      },
    });
    await db.initialize();
    expect((await db.query('SELECT current_schema() AS schema'))[0].schema).toBe(schema);
    await db.runMigrations();
    users = new UsersService(db);
    await users.create({ email: 'guide-admin@example.com', password, roles: ['ADMIN'] }, true);
    const editorUser = await users.create({
      email: 'guide-editor@example.com',
      password,
      roles: ['EDITOR'],
    });
    const reviewerUser = await users.create({
      email: 'guide-reviewer@example.com',
      password,
      roles: ['REVIEWER'],
    });
    await users.create({
      email: 'guide-outsider@example.com',
      password,
      roles: ['EDITOR', 'REVIEWER'],
    });
    const catalog = new CatalogWriterService(db);
    gameId = (await catalog.createGame({ slug: 'stella-sora', name: 'Stella Sora' })).id;
    otherGameId = (await catalog.createGame({ slug: 'other', name: 'Other' })).id;
    await users.games(editorUser.id, [gameId]);
    await users.games(reviewerUser.id, [gameId]);
    const character = {
      slug: 'test',
      name: 'Test',
      rarity: 5,
      element: 'Aqua',
      status: 'published',
      sourceUrl: 'https://example.com',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    };
    characterId = (await catalog.writeCharacter(gameId, character)).id;
    draftCharacterId = (
      await catalog.writeCharacter(gameId, { ...character, slug: 'draft', status: 'draft' })
    ).id;
    otherCharacterId = (await catalog.writeCharacter(otherGameId, character)).id;
    patchId = (
      await catalog.createVersion(gameId, { version: 'synthetic-patch', status: 'published' })
    ).id;
    otherPatchId = (
      await catalog.createVersion(otherGameId, { version: 'other-patch', status: 'published' })
    ).id;
    const module = await Test.createTestingModule({
      imports: [AppModule.register(db, env)],
    })
      .overrideProvider(MediaStorage)
      .useValue({
        put: async (key: string, bytes: Buffer) => {
          files.set(key, bytes);
        },
        get: async (key: string) => {
          const bytes = files.get(key);
          if (!bytes) throw new Error('missing');
          return bytes;
        },
        remove: async (key: string) => {
          files.delete(key);
        },
      })
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttp(app, { ...env, LOG_LEVEL: 'silent' });
    await app.init();
    admin = await login('guide-admin@example.com');
    editor = await login('guide-editor@example.com');
    reviewer = await login('guide-reviewer@example.com');
    outsider = await login('guide-outsider@example.com');
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (adminDb?.isInitialized) {
      await adminDb.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminDb.destroy();
    }
  });

  it('keeps drafts and previews private and enforces CSRF, roles and live game grants', async () => {
    const content = await create();
    await request(app.getHttpServer())
      .get(`${publicBase}/${content.slug}?status=draft&revision=1`)
      .expect(404);
    await request(app.getHttpServer()).get(`${base}/${content.id}/preview`).expect(401);
    await request(app.getHttpServer())
      .post(base)
      .send({ gameId, slug: 'anonymous', ...fields() })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${base}/${content.id}/draft`)
      .set('Cookie', editor.cookie)
      .set('Origin', origin)
      .send({ expectedRevision: 1, ...fields() })
      .expect(403);
    await mutation('post', base, reviewer, { gameId, slug: 'reviewer-write', ...fields() }).expect(
      403,
    );
    await mutation('post', base, outsider, { gameId, slug: 'outsider', ...fields() }).expect(403);
    await request(app.getHttpServer())
      .get(`${base}/${content.id}/preview`)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await mutation('post', `${base}/${content.id}/publish`, editor, { expectedRevision: 1 }).expect(
      403,
    );
    await mutation('post', `${base}/${content.id}/approve`, editor, { expectedRevision: 1 }).expect(
      403,
    );
    await users.games(editor.userId, []);
    await mutation('patch', `${base}/${content.id}/draft`, editor, {
      expectedRevision: 1,
      ...fields(),
    }).expect(403);
    await users.games(editor.userId, [gameId]);
    await request(app.getHttpServer()).get(`${publicBase}?status=draft`).expect(400);
    await request(app.getHttpServer()).get(`${publicBase}?revision=1`).expect(400);
    await request(app.getHttpServer())
      .get(`${base}?gameId=${gameId}`)
      .set('Cookie', outsider.cookie)
      .expect(403);
  });

  it('publishes only a separately reviewed revision with safe output and snapshot references', async () => {
    let content = await create(editor, {
      ...fields('<script>alert("x")</script>'),
      characterIds: [characterId],
      gameVersionId: patchId,
    });
    const preview = await request(app.getHttpServer())
      .get(`${base}/${content.id}/preview`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(preview.body.data.html).toContain('&lt;script&gt;');
    content = await command(content, 'submit-review', editor);
    await mutation('patch', `${base}/${content.id}/draft`, editor, {
      expectedRevision: content.version,
      ...fields('Cannot edit in review'),
    }).expect(409);
    content = await command(content, 'approve', reviewer);
    content = await command(content, 'publish', admin);
    expect(content).toMatchObject({
      state: 'published',
      version: 4,
      currentRevision: 1,
      publication: { revision: 1 },
    });
    const response = await request(app.getHttpServer())
      .get(`${publicBase}/${content.slug}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      revision: 1,
      html: '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>',
      gameVersion: { id: patchId, version: 'synthetic-patch' },
      characters: [{ id: characterId }],
      sources: [{ label: 'Test source' }],
    });
    for (const key of ['state', 'version', 'authorId', 'currentRevision', 'publication'])
      expect(response.body.data[key]).toBeUndefined();
    const audit = await request(app.getHttpServer())
      .get(`${base}/${content.id}/audit?limit=2`)
      .set('Cookie', reviewer.cookie)
      .expect(200);
    expect(audit.body.meta).toMatchObject({ total: 4, totalPages: 2 });
    expect(audit.body.data[0]).toMatchObject({
      action: 'content.published',
      actorId: admin.userId,
    });
    const own = await create(admin);
    const submitted = await command(own, 'submit-review', admin);
    await mutation('post', `${base}/${own.id}/approve`, admin, {
      expectedRevision: submitted.version,
    }).expect(403);
  });

  it('preserves the published body, metadata and relations while a newer draft is edited', async () => {
    let content = await published({ characterIds: [characterId] });
    const oldTitle = fields().title;
    const edited = await mutation('patch', `${base}/${content.id}/draft`, editor, {
      expectedRevision: content.version,
      ...fields('New private title'),
      category: 'combat',
    }).expect(200);
    content = edited.body.data;
    expect(content).toMatchObject({
      state: 'draft',
      version: 5,
      currentRevision: 2,
      publication: { revision: 1 },
    });
    const old = await request(app.getHttpServer())
      .get(`${publicBase}/${content.slug}?revision=2&preview=true`)
      .expect(200);
    expect(old.body.data).toMatchObject({
      revision: 1,
      title: oldTitle,
      category: 'beginner',
      characters: [{ id: characterId }],
    });
    const list = await request(app.getHttpServer())
      .get(`${publicBase}?category=combat`)
      .expect(200);
    expect(list.body.data.some((row: { id: string }) => row.id === content.id)).toBe(false);
    content = await command(content, 'submit-review', editor);
    content = await command(content, 'approve', reviewer);
    content = await command(content, 'publish', admin);
    const current = await request(app.getHttpServer())
      .get(`${publicBase}/${content.slug}`)
      .expect(200);
    expect(current.body.data).toMatchObject({
      revision: 2,
      title: 'New private title',
      category: 'combat',
      characters: [],
      gameVersion: null,
    });
    const history = await request(app.getHttpServer())
      .get(`${base}/${content.id}/revisions`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(history.body.data.map((row: { revision: number }) => row.revision)).toEqual([2, 1]);
    expect(history.body.data[0].body).toBeUndefined();
    const original = await request(app.getHttpServer())
      .get(`${base}/${content.id}/revisions/1`)
      .set('Cookie', reviewer.cookie)
      .expect(200);
    expect(original.body.data.revision.title).toBe(oldTitle);
  });

  it('allows only one concurrent edit and rejects stale workflow and publication commands', async () => {
    const content = await create();
    const results = await Promise.all(
      ['First write', 'Second write'].map((title) =>
        mutation('patch', `${base}/${content.id}/draft`, editor, {
          expectedRevision: 1,
          ...fields(title),
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const changed: ContentMutationDto = results.find((result) => result.status === 200)!.body.data;
    expect(changed).toMatchObject({ version: 2, currentRevision: 2 });
    const conflict = results.find((result) => result.status === 409)!;
    expect(conflict.body.error).toMatchObject({ code: 'CONFLICT', message: 'Content has changed' });
    const submitted = await command(changed, 'submit-review', editor);
    await mutation('post', `${base}/${content.id}/approve`, reviewer, {
      expectedRevision: changed.version,
    }).expect(409);
    await command(submitted, 'approve', reviewer);
    await mutation('post', `${base}/${content.id}/publish`, admin, {
      expectedRevision: changed.version,
    }).expect(409);
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM content_revisions WHERE content_id=$1', [
          content.id,
        ])
      )[0].count,
    ).toBe(2);
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM audit_entries WHERE content_id=$1', [
          content.id,
        ])
      )[0].count,
    ).toBe(4);
  });

  it('returns reviews with required feedback and invalidates old approvals', async () => {
    let content = await create();
    content = await command(content, 'submit-review', editor);
    await mutation('post', `${base}/${content.id}/return-to-draft`, reviewer, {
      expectedRevision: content.version,
    }).expect(400);
    const submittedVersion = content.version;
    content = await command(content, 'return-to-draft', reviewer, {
      reason: 'Please verify the source.',
    });
    await mutation('post', `${base}/${content.id}/approve`, reviewer, {
      expectedRevision: submittedVersion,
    }).expect(409);
    await mutation('post', `${base}/${content.id}/publish`, admin, {
      expectedRevision: content.version,
    }).expect(409);
    content = await command(content, 'submit-review', editor);
    content = await command(content, 'approve', reviewer);
    await mutation('patch', `${base}/${content.id}/draft`, editor, {
      expectedRevision: content.version,
      ...fields(),
    }).expect(409);
    content = await command(content, 'return-to-draft', reviewer, {
      reason: 'Further correction.',
    });
    const entries = await request(app.getHttpServer())
      .get(`${base}/${content.id}/audit`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(entries.body.data[0].details).toMatchObject({
      reason: 'Further correction.',
      fromState: 'approved',
      toState: 'draft',
    });
  });

  it('restores into a new draft without losing history or bypassing review', async () => {
    let content = await published({ characterIds: [characterId], gameVersionId: patchId });
    const edited = await mutation('patch', `${base}/${content.id}/draft`, editor, {
      expectedRevision: content.version,
      ...fields('Second snapshot'),
    }).expect(200);
    content = edited.body.data;
    content = await command(content, 'restore', editor, { sourceRevision: 1 });
    expect(content).toMatchObject({
      currentRevision: 3,
      state: 'draft',
      publication: { revision: 1 },
    });
    const preview = await request(app.getHttpServer())
      .get(`${base}/${content.id}/preview`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(preview.body.data.revision).toMatchObject({
      revision: 3,
      derivedFrom: 1,
      title: fields().title,
    });
    expect(preview.body.data.relations).toEqual({
      characterIds: [characterId],
      gameVersionId: patchId,
    });
    await mutation('post', `${base}/${content.id}/publish`, admin, {
      expectedRevision: content.version,
    }).expect(409);
    content = await command(content, 'submit-review', editor);
    content = await command(content, 'approve', reviewer);
    content = await command(content, 'publish', admin);
    expect(content.publication!.revision).toBe(3);
    const revisions = await request(app.getHttpServer())
      .get(`${base}/${content.id}/revisions`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(revisions.body.meta.total).toBe(3);
  });

  it('unpublishes without deleting newer drafts and archives without exposing history', async () => {
    let content = await published();
    const edited = await mutation('patch', `${base}/${content.id}/draft`, editor, {
      expectedRevision: content.version,
      ...fields('Still private'),
    }).expect(200);
    content = await command(edited.body.data, 'unpublish', admin);
    expect(content).toMatchObject({ state: 'draft', currentRevision: 2, publication: null });
    await request(app.getHttpServer()).get(`${publicBase}/${content.slug}`).expect(404);
    content = await command(content, 'archive', admin);
    await mutation('post', `${base}/${content.id}/restore`, editor, {
      expectedRevision: content.version,
      sourceRevision: 1,
    }).expect(409);
    await request(app.getHttpServer())
      .get(`${publicBase}/${content.slug}?status=archived`)
      .expect(404);
    const preview = await request(app.getHttpServer())
      .get(`${base}/${content.id}/preview`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(preview.body.data.revision.title).toBe('Still private');
  });

  it('validates relation ownership, publication visibility, duplicate slugs and mass assignment', async () => {
    await mutation('post', base, editor, {
      gameId,
      slug: 'cross-character',
      ...fields(),
      characterIds: [otherCharacterId],
    }).expect(400);
    await mutation('post', base, editor, {
      gameId,
      slug: 'cross-patch',
      ...fields(),
      gameVersionId: otherPatchId,
    }).expect(400);
    await mutation('post', base, editor, {
      gameId,
      slug: 'duplicate-ids',
      ...fields(),
      characterIds: [characterId, characterId],
    }).expect(400);
    await mutation('post', base, editor, {
      gameId,
      slug: 'mass-assign',
      ...fields(),
      state: 'published',
      authorId: admin.userId,
    }).expect(400);
    const content = await create();
    await mutation('post', base, editor, { gameId, slug: content.slug, ...fields() }).expect(409);
    for (const sourceRevision of [0, 2147483648]) {
      await mutation('post', `${base}/${content.id}/restore`, editor, {
        expectedRevision: content.version,
        sourceRevision,
      }).expect(400);
      await request(app.getHttpServer())
        .get(`${base}/${content.id}/revisions/${sourceRevision}`)
        .set('Cookie', editor.cookie)
        .expect(400);
    }
    await create(admin, { gameId: otherGameId, slug: content.slug });
    let invalid = await create(editor, { characterIds: [draftCharacterId] });
    invalid = await command(invalid, 'submit-review', editor);
    invalid = await command(invalid, 'approve', reviewer);
    await mutation('post', `${base}/${invalid.id}/publish`, admin, {
      expectedRevision: invalid.version,
    }).expect(400);
    await request(app.getHttpServer()).get(`${publicBase}/${invalid.slug}`).expect(404);
    const foreign = await create();
    await expect(
      db.query('INSERT INTO publications(content_id,revision,published_by) VALUES($1,999,$2)', [
        foreign.id,
        admin.userId,
      ]),
    ).rejects.toThrow();
    await mutation('post', base, editor, {
      gameId,
      slug: 'xss-link',
      ...fields(),
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    }).expect(400);
    await mutation('post', base, editor, {
      gameId,
      slug: 'unsafe-source',
      ...fields(),
      sources: [{ label: 'bad', url: 'javascript:alert(1)' }],
    }).expect(400);
  });

  it('enforces fixed categories on HTTP writes, public filters and direct database inserts', async () => {
    const content = await create(editor, { category: 'character' });
    for (const category of ['characters', 'character-guide', 'unknown', 'Character']) {
      await mutation('post', base, editor, {
        gameId,
        slug: `category-${randomUUID()}`,
        ...fields(),
        category,
      }).expect(400);
      await mutation('patch', `${base}/${content.id}/draft`, editor, {
        expectedRevision: content.version,
        ...fields(),
        category,
      }).expect(400);
      await request(app.getHttpServer()).get(`${publicBase}?category=${category}`).expect(400);
    }
    await expect(
      db.query(
        `INSERT INTO content_revisions(content_id,revision,author_id,title,description,category,body,reading_minutes)
      SELECT content_id,revision+100,author_id,title,description,$1,body,reading_minutes
      FROM content_revisions WHERE content_id=$2 AND revision=1`,
        ['characters', content.id],
      ),
    ).rejects.toMatchObject({ driverError: { constraint: 'ck_revisions_category' } });
  });

  it('rolls back publication and head changes if the audit insert fails', async () => {
    let content = await create();
    content = await command(content, 'submit-review', editor);
    content = await command(content, 'approve', reviewer);
    const audit = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('Synthetic private audit storage failure'));
    try {
      const response = await mutation('post', `${base}/${content.id}/publish`, admin, {
        expectedRevision: content.version,
      })
        .set('X-Request-Id', 'atomic-publication')
        .expect(500);
      expect(response.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: 'atomic-publication',
      });
      expect(JSON.stringify(response.body)).not.toContain('audit storage');
    } finally {
      audit.mockRestore();
    }
    const preview = await request(app.getHttpServer())
      .get(`${base}/${content.id}/preview`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(preview.body.data).toMatchObject({
      state: 'approved',
      version: content.version,
      publication: null,
    });
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM audit_entries WHERE content_id=$1', [
          content.id,
        ])
      )[0].count,
    ).toBe(3);
    await request(app.getHttpServer()).get(`${publicBase}/${content.slug}`).expect(404);
    content = await command(content, 'publish', admin);
    expect(content.publication!.revision).toBe(1);
  });

  it('paginates deterministically and excludes archived games and unpublished records', async () => {
    const first = await request(app.getHttpServer()).get(`${publicBase}?limit=2`).expect(200);
    const again = await request(app.getHttpServer()).get(`${publicBase}?limit=2`).expect(200);
    expect(first.body).toEqual(again.body);
    const next = await request(app.getHttpServer()).get(`${publicBase}?limit=2&page=2`).expect(200);
    expect(
      next.body.data.every(
        (row: { id: string }) =>
          !first.body.data.some((previous: { id: string }) => previous.id === row.id),
      ),
    ).toBe(true);
    const empty = await request(app.getHttpServer()).get(`${publicBase}?page=1000000`).expect(200);
    expect(empty.body.data).toEqual([]);
    await request(app.getHttpServer()).get(`${publicBase}?limit=101`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/games/missing/guides').expect(404);
    const guide = await published();
    await db.query("UPDATE games SET status='archived' WHERE id=$1", [gameId]);
    try {
      await request(app.getHttpServer()).get(publicBase).expect(404);
      await request(app.getHttpServer()).get(`${publicBase}/${guide.slug}`).expect(404);
      await mutation('post', base, admin, { gameId, slug: 'archived-game', ...fields() }).expect(
        404,
      );
    } finally {
      await db.query("UPDATE games SET status='active' WHERE id=$1", [gameId]);
    }
  });

  it('renders the published snapshot on the actual web server and removes it after unpublish', async () => {
    let content = await published({ ...fields('Published web guide'), slug: 'web-smoke-guide' });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const child = spawn(
      process.platform === 'win32' ? 'python' : 'python3',
      [
        '-u',
        '-c',
        'from server import Handler, ThreadingHTTPServer\nweb=ThreadingHTTPServer(("127.0.0.1",0),Handler)\nprint(web.server_address[1],flush=True)\nweb.serve_forever()',
      ],
      {
        cwd: resolve(__dirname, '../../../../apps/web'),
        env: { ...process.env, API_URL: `http://127.0.0.1:${address.port}` },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    try {
      const port = await new Promise<number>((resolvePort, reject) => {
        const timer = setTimeout(() => reject(new Error('Web smoke server did not start')), 15000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Web smoke server exited'));
        });
        child.stdout.once('data', (data: Buffer) => {
          clearTimeout(timer);
          const port = Number(data.toString().trim());
          if (port > 0) resolvePort(port);
          else reject(new Error('Invalid web port'));
        });
      });
      const url = `http://127.0.0.1:${port}`;
      const page = await fetch(`${url}/guides/${content.slug}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<h1>Published web guide</h1>');
      const listing = await fetch(`${url}/guides/`);
      expect(await listing.text()).toContain(`/guides/${content.slug}/`);
      const edit = await mutation('patch', `${base}/${content.id}/draft`, editor, {
        expectedRevision: content.version,
        ...fields('Private replacement for web'),
      }).expect(200);
      content = edit.body.data;
      const unchanged = await fetch(`${url}/guides/${content.slug}/`);
      const html = await unchanged.text();
      expect(html).toContain('<h1>Published web guide</h1>');
      expect(html).not.toContain('Private replacement for web');
      content = await command(content, 'unpublish', admin);
      expect((await fetch(`${url}/guides/${content.slug}/`)).status).toBe(404);
    } finally {
      const exited = once(child, 'exit');
      child.kill();
      if (child.exitCode === null && child.signalCode === null) await exited;
    }
  });

  it('reserves a wiki identity across authors, slugs, concurrent creation and archive', async () => {
    const wiki = { kind: 'character', characterId, topic: 'build' };
    const requests = await Promise.all(
      [editor, admin].map((actor) =>
        mutation('post', base, actor, {
          gameId,
          slug: `wiki-race-${randomUUID()}`,
          ...fields(),
          wiki,
        }),
      ),
    );
    expect(requests.map((response) => response.status).sort()).toEqual([201, 409]);
    let page = requests.find((response) => response.status === 201)!.body
      .data as ContentMutationDto;
    expect(page.wiki.key).toBe(`character:${characterId}:build`);
    await create(editor, { wiki: { ...wiki, topic: 'strategy' } });
    await mutation('post', base, editor, {
      gameId,
      slug: 'cross-game-wiki',
      ...fields(),
      wiki: { ...wiki, characterId: otherCharacterId },
    }).expect(400);
    page = await command(page, 'archive', admin);
    await mutation('post', base, editor, {
      gameId,
      slug: 'different-slug-same-wiki',
      ...fields(),
      category: 'combat',
      wiki,
    }).expect(409);
    await expect(
      db.query('UPDATE contents SET wiki_topic=$1 WHERE id=$2', ['overview', page.id]),
    ).rejects.toMatchObject({ driverError: { constraint: 'ck_contents_wiki_immutable' } });
    await expect(
      db.query(
        `INSERT INTO contents(id,game_id,slug,author_id,wiki_kind,wiki_topic,wiki_character_id) VALUES($1,$2,$3,$4,'character','build',$5)`,
        [randomUUID(), gameId, `sql-${randomUUID()}`, admin.userId, characterId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      db.query(
        `INSERT INTO contents(id,game_id,slug,author_id,wiki_kind,wiki_topic) VALUES($1,$2,$3,$4,'character','build')`,
        [randomUUID(), gameId, `null-${randomUUID()}`, admin.userId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    const gamePage = await create(editor, { wiki: { kind: 'game', topic: 'overview' } });
    await mutation('post', base, admin, {
      gameId,
      slug: `another-${randomUUID()}`,
      ...fields(),
      wiki: { kind: 'game' },
    }).expect(409);
    expect(gamePage.wiki.kind).toBe('game');
  });

  it('uses team UUIDs as wiki subjects, enforces same-game FKs and hides unpublished subjects', async () => {
    const catalog = new CatalogWriterService(db);
    const members = await Promise.all(
      [0, 1, 2].map((index) =>
        catalog.writeCharacter(gameId, {
          slug: `team-wiki-${index}`,
          name: 'Team wiki fixture',
          rarity: 5,
          element: 'Aqua',
          status: 'published',
          sourceUrl: 'https://example.com/team',
          verifiedAt: '2026-10-24T00:00:00.000Z',
        }),
      ),
    );
    const supports = [members[1].id, members[2].id].sort();
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams(id,game_id,slug,name,status,main_character_id,support_one_id,support_two_id) VALUES($1,$2,'wiki-team','Wiki team','published',$3,$4,$5)`,
      [teamId, gameId, members[0].id, ...supports],
    );
    let page = await create(editor, { wiki: { kind: 'team', teamId }, category: 'team' });
    await mutation('post', base, admin, {
      gameId,
      slug: 'duplicate-team-wiki',
      ...fields(),
      wiki: { kind: 'team', teamId },
    }).expect(409);
    await mutation('post', base, admin, {
      gameId: otherGameId,
      slug: 'wrong-team-game',
      ...fields(),
      wiki: { kind: 'team', teamId },
    }).expect(400);
    await expect(
      db.query(
        `INSERT INTO contents(id,game_id,slug,author_id,wiki_kind,wiki_topic,wiki_team_id) VALUES($1,$2,$3,$4,'team','overview',$5)`,
        [randomUUID(), otherGameId, `fk-${randomUUID()}`, admin.userId, teamId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    page = await command(page, 'submit-review', editor);
    page = await command(page, 'approve', reviewer);
    page = await command(page, 'publish', admin);
    const detail = await request(app.getHttpServer()).get(`${publicBase}/${page.slug}`).expect(200);
    expect(detail.body.data.wiki).toMatchObject({ kind: 'team', teamId, topic: 'overview' });
    await db.query("UPDATE teams SET status='archived' WHERE id=$1", [teamId]);
    await request(app.getHttpServer()).get(`${publicBase}/${page.slug}`).expect(404);
    const list = await request(app.getHttpServer()).get(`${publicBase}?limit=100`).expect(200);
    expect(list.body.data.some((row: { id: string }) => row.id === page.id)).toBe(false);
  });

  it('uploads real images, keeps drafts private, snapshots media references and revokes public reads on unpublish', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#5588cc' },
    })
      .png()
      .toBuffer();
    const upload = await request(app.getHttpServer())
      .post('/api/v1/admin/games/' + gameId + '/media')
      .set('Origin', origin)
      .set('Cookie', editor.cookie)
      .set('X-CSRF-Token', editor.csrf)
      .attach('file', bytes, 'example.png')
      .expect(201);
    const id = upload.body.data.id;
    expect(upload.body.data).toMatchObject({ width: 8, height: 8, mimeType: 'image/webp' });
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/admin/media/' + id + '/file')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/media/' + id + '/file')
      .set('Cookie', outsider.cookie)
      .expect(403);
    const privateImage = await request(app.getHttpServer())
      .get('/api/v1/admin/media/' + id + '/file')
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(privateImage.headers['content-type']).toContain('image/webp');
    await request(app.getHttpServer())
      .post('/api/v1/admin/games/' + gameId + '/media')
      .set('Origin', origin)
      .set('Cookie', editor.cookie)
      .set('X-CSRF-Token', editor.csrf)
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'fake.png')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/admin/games/' + gameId + '/media')
      .set('Origin', origin)
      .set('Cookie', editor.cookie)
      .attach('file', bytes, 'example.png')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/games/' + gameId + '/media')
      .set('Origin', origin)
      .set('Cookie', editor.cookie)
      .set('X-CSRF-Token', editor.csrf)
      .attach('file', Buffer.alloc(5242881), 'large.png')
      .expect(413);
    const body = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before image' }] },
        {
          type: 'image',
          attrs: { mediaId: id, alt: 'Example diagram', caption: '<script>caption</script>' },
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After image' }] },
      ],
    };
    let content = await create(editor, {
      body,
      coverImageId: id,
      coverAlt: 'Cover diagram',
      coverCaption: 'Cover caption',
    });
    const preview = await request(app.getHttpServer())
      .get(base + '/' + content.id + '/preview')
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(preview.body.data.html).toContain('/api/v1/admin/media/' + id + '/file');
    expect(preview.body.data.html).toContain('&lt;script&gt;caption&lt;/script&gt;');
    expect(preview.body.data.cover).toMatchObject({ mediaId: id, alt: 'Cover diagram' });
    await mutation('patch', base + '/' + content.id + '/draft', editor, {
      ...fields(),
      body: {
        type: 'doc',
        content: [{ type: 'image', attrs: { mediaId: randomUUID(), alt: 'Missing' } }],
      },
      expectedRevision: content.version,
    }).expect(400);
    await mutation('post', base, admin, {
      gameId: otherGameId,
      slug: 'cross-game-image',
      wiki: { kind: 'game' },
      ...fields(),
      body,
    }).expect(400);
    content = await command(content, 'submit-review', editor);
    content = await command(content, 'approve', reviewer);
    content = await command(content, 'publish', admin);
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(200);
    const published = await request(app.getHttpServer())
      .get(publicBase + '/' + content.slug)
      .expect(200);
    expect(published.body.data.html).toContain('/api/v1/media/' + id + '/file');
    expect(published.body.data.cover).toMatchObject({ mediaId: id, alt: 'Cover diagram' });
    content = (
      await mutation('patch', base + '/' + content.id + '/draft', editor, {
        ...fields(),
        expectedRevision: content.version,
      })
    ).body.data;
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(200);
    content = await command(content, 'unpublish', admin);
    await request(app.getHttpServer())
      .get('/api/v1/media/' + id + '/file')
      .expect(404);
    const restored = await mutation('post', base + '/' + content.id + '/restore', editor, {
      expectedRevision: content.version,
      sourceRevision: 1,
    }).expect(200);
    const oldPreview = await request(app.getHttpServer())
      .get(base + '/' + restored.body.data.id + '/preview')
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(oldPreview.body.data.revision.coverImageId).toBe(id);
    expect(oldPreview.body.data.html).toContain('/api/v1/admin/media/' + id + '/file');
    await expect(db.query('UPDATE content_revision_media SET revision=revision')).rejects.toThrow(
      'append-only',
    );
  });

  it('lists game media, protects historical references, and retries failed object deletion', async () => {
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#4477aa' },
    })
      .png()
      .toBuffer();
    const upload = async () =>
      (
        await request(app.getHttpServer())
          .post(`/api/v1/admin/games/${gameId}/media`)
          .set('Origin', origin)
          .set('Cookie', editor.cookie)
          .set('X-CSRF-Token', editor.csrf)
          .attach('file', bytes, 'library.png')
          .expect(201)
      ).body.data.id as string;
    const remove = (id: string, actor = admin) =>
      request(app.getHttpServer())
        .delete(`/api/v1/admin/media/${id}`)
        .set('Origin', origin)
        .set('Cookie', actor.cookie)
        .set('X-CSRF-Token', actor.csrf);
    const id = await upload();
    const path = `/api/v1/admin/games/${gameId}/media`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('Cookie', outsider.cookie).expect(403);
    await request(app.getHttpServer())
      .get(path + '?usage=invalid')
      .set('Cookie', editor.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get(path + '?unexpected=1')
      .set('Cookie', editor.cookie)
      .expect(400);
    const unused = await request(app.getHttpServer())
      .get(path + '?usage=unused&limit=100')
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(unused.body.data.find((row: { id: string }) => row.id === id)).toMatchObject({
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      referenceCount: 0,
      status: 'available',
    });
    expect(unused.body.data[0]).not.toHaveProperty('storageKey');
    await remove(id, editor).expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/media/${id}`)
      .set('Cookie', admin.cookie)
      .set('Origin', origin)
      .expect(403);
    let content = await create(editor, { coverImageId: id, coverAlt: 'Library cover' });
    content = (
      await mutation('patch', `${base}/${content.id}/draft`, editor, {
        ...fields(),
        expectedRevision: content.version,
      }).expect(200)
    ).body.data;
    await remove(id).expect(409);
    const usages = await request(app.getHttpServer())
      .get(`/api/v1/admin/media/${id}/usages`)
      .set('Cookie', reviewer.cookie)
      .expect(200);
    expect(usages.body).toMatchObject({
      data: [{ contentId: content.id, revision: 1, isCurrent: false, isPublished: false }],
      meta: { total: 1 },
    });
    await expect(
      db.query('UPDATE media_assets SET deleted_at=now() WHERE id=$1', [id]),
    ).rejects.toThrow('Referenced media');
    const disposable = await upload();
    const storage = app.get(MediaStorage);
    const failure = jest
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await remove(disposable).expect(503);
    const pending = await request(app.getHttpServer())
      .get(path + '?usage=deletion_pending')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(pending.body.data.map((row: { id: string }) => row.id)).toContain(disposable);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/media/${disposable}/file`)
      .set('Cookie', admin.cookie)
      .expect(404);
    await mutation('patch', `${base}/${content.id}/draft`, editor, {
      ...fields(),
      coverImageId: disposable,
      coverAlt: 'Unavailable',
      expectedRevision: content.version,
    }).expect(400);
    await expect(
      db.query(
        'INSERT INTO content_revision_media(content_id,revision,media_id,game_id) VALUES($1,$2,$3,$4)',
        [content.id, content.currentRevision, disposable, gameId],
      ),
    ).rejects.toThrow('Media is unavailable');
    await remove(disposable).expect(204);
    await remove(disposable).expect(404);
    failure.mockRestore();
    const racing = await upload();
    const [editResult, deleteResult] = await Promise.all([
      mutation('patch', `${base}/${content.id}/draft`, editor, {
        ...fields(),
        coverImageId: racing,
        coverAlt: 'Race',
        expectedRevision: content.version,
      }),
      remove(racing),
    ]);
    expect([
      [200, 409],
      [400, 204],
    ]).toContainEqual([editResult.status, deleteResult.status]);
    const first = await request(app.getHttpServer())
      .get(path + '?limit=1')
      .set('Cookie', admin.cookie)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get(path + '?limit=1&page=2')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
  });

  it('has no entity drift, protects CMS tables from Data API roles, and reverts/reapplies cleanly', async () => {
    const [snapshot] = await db.query('SELECT content_id,revision FROM content_revisions LIMIT 1');
    await expect(
      db.query('UPDATE content_revisions SET title=$1 WHERE content_id=$2 AND revision=$3', [
        'History rewrite',
        snapshot.content_id,
        snapshot.revision,
      ]),
    ).rejects.toThrow('append-only');
    await expect(
      db.query('DELETE FROM audit_entries WHERE content_id=$1', [snapshot.content_id]),
    ).rejects.toThrow('append-only');
    await expect(db.query('UPDATE content_relations SET revision=revision')).rejects.toThrow(
      'append-only',
    );
    const changes = await db.driver.createSchemaBuilder().log();
    expect(changes.upQueries.map((query) => query.query)).toEqual([]);
    const tables = [
      'contents',
      'content_revisions',
      'publications',
      'content_relations',
      'audit_entries',
    ];
    const rows = await db.query(
      'SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2)',
      [schema, tables],
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((row: { relrowsecurity: boolean }) => row.relrowsecurity)).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).length) continue;
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
        await runner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
        await runner.query(`SET LOCAL ROLE "${role}"`);
        for (const table of tables)
          expect(
            (await runner.query(`SELECT count(*)::int AS count FROM "${schema}"."${table}"`))[0]
              .count,
          ).toBe(0);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    }
    await revertThrough(db, 'Publishing1792800003000');
    expect((await db.query('SELECT count(*)::int AS count FROM users'))[0].count).toBe(4);
    await db.runMigrations();
    expect((await db.query('SELECT count(*)::int AS count FROM contents'))[0].count).toBe(0);
  });
  it('backfills an unambiguous legacy character page without rewriting its revision', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const migration = new WikiIdentity1792800007000();
      await migration.down(runner);
      const id = randomUUID();
      await runner.query('INSERT INTO contents(id,game_id,slug,author_id) VALUES($1,$2,$3,$4)', [
        id,
        gameId,
        'legacy-character',
        editor.userId,
      ]);
      await runner.query(
        `INSERT INTO content_revisions(content_id,revision,author_id,title,description,category,body,reading_minutes) VALUES($1,1,$2,'Legacy','Legacy','character',$3::jsonb,1)`,
        [id, editor.userId, JSON.stringify(fields().body)],
      );
      await runner.query(
        'INSERT INTO content_relations(id,content_id,revision,character_id) VALUES($1,$2,1,$3)',
        [randomUUID(), id, characterId],
      );
      const before = await runner.query('SELECT * FROM content_revisions WHERE content_id=$1', [
        id,
      ]);
      await migration.up(runner);
      expect(
        (
          await runner.query(
            'SELECT wiki_kind,wiki_character_id,wiki_topic FROM contents WHERE id=$1',
            [id],
          )
        )[0],
      ).toEqual({ wiki_kind: 'character', wiki_character_id: characterId, wiki_topic: 'overview' });
      expect(
        await runner.query('SELECT * FROM content_revisions WHERE content_id=$1', [id]),
      ).toEqual(before);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('refuses to guess between duplicate legacy pages and rolls the schema back safely', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const migration = new WikiIdentity1792800007000();
      await migration.down(runner);
      for (const slug of ['legacy-one', 'legacy-two']) {
        const id = randomUUID();
        await runner.query('INSERT INTO contents(id,game_id,slug,author_id) VALUES($1,$2,$3,$4)', [
          id,
          gameId,
          slug,
          editor.userId,
        ]);
        await runner.query(
          `INSERT INTO content_revisions(content_id,revision,author_id,title,description,category,body,reading_minutes) VALUES($1,1,$2,'Legacy','Legacy','general',$3::jsonb,1)`,
          [id, editor.userId, JSON.stringify(fields().body)],
        );
      }
      await expect(migration.up(runner)).rejects.toThrow('duplicate wiki identities');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
  });
});
