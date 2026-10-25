import 'reflect-metadata';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/common/http/configure-http';
import { configureSwagger } from '../../src/common/swagger/swagger.config';
import { parseEnvironment } from '../../src/config/env';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import {
  pageExamples,
  sampleCharacter,
  sampleGame,
  sampleProfile,
} from '../../src/modules/catalog/swagger/catalog.examples';

describe('generated OpenAPI contract', () => {
  let app: INestApplication;
  let spec: OpenAPIObject;
  const query = jest.fn().mockResolvedValue([{ value: 1 }]);
  const catalog = {
    games: jest.fn().mockResolvedValue(pageExamples(sampleGame).populated.value),
    versions: jest.fn().mockResolvedValue(pageExamples({}).empty.value),
    characters: jest.fn().mockResolvedValue(pageExamples(sampleCharacter).populated.value),
    character: jest.fn().mockResolvedValue({ data: sampleProfile }),
  };
  async function application(environment: string) {
    const module = await Test.createTestingModule({
      imports: [AppModule.register({ query } as unknown as DataSource)],
    })
      .overrideProvider(CatalogService)
      .useValue(catalog)
      .compile();
    const instance = module.createNestApplication({ bodyParser: false });
    configureHttp(
      instance,
      parseEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/test',
        SESSION_SECRET: 'a'.repeat(40),
        CORS_ORIGINS: 'http://localhost:3001',
        STORAGE_ENDPOINT: 'http://localhost:9000',
        STORAGE_BUCKET: 'test',
        STORAGE_REGION: 'auto',
        STORAGE_ACCESS_KEY: 'test',
        STORAGE_SECRET_KEY: 'test',
        LOG_LEVEL: 'silent',
      }),
    );
    configureSwagger(instance, environment);
    await instance.init();
    return instance;
  }
  beforeAll(async () => {
    app = await application('development');
    spec = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  });
  afterAll(async () => {
    await app.close();
  });

  it('documents all six implemented operations with typed responses, errors and tracing', () => {
    const expected = {
      '/health/live': 'HealthResponseDto',
      '/health/ready': 'HealthResponseDto',
      '/api/v1/games': 'GamesPageDto',
      '/api/v1/games/{gameSlug}/versions': 'VersionsPageDto',
      '/api/v1/games/{gameSlug}/characters': 'CharactersPageDto',
      '/api/v1/games/{gameSlug}/characters/{slug}': 'CharacterResponseDto',
    };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(Object.keys(expected)));
    const ids = new Set<string>();
    for (const [path, type] of Object.entries(expected)) {
      const operation = spec.paths[path].get!;
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toBeTruthy();
      expect(operation.security ?? []).toEqual([]);
      expect(operation.requestBody).toBeUndefined();
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ in: 'header', name: 'X-Request-Id', required: false }),
        ]),
      );
      expect(operation.responses['200']).toMatchObject({
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${type}` } } },
      });
      for (const status of ['200', '400', '413', '500']) {
        expect(operation.responses[status]).toMatchObject({
          headers: { 'X-Request-Id': { schema: { type: 'string' } } },
        });
      }
      expect(operation.responses['400']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponseDto' },
            example: { error: { code: 'VALIDATION_ERROR' } },
          },
        },
      });
      expect(operation.responses['401']).toBeUndefined();
      expect(operation.responses['403']).toBeUndefined();
      expect(ids.has(operation.operationId!)).toBe(false);
      ids.add(operation.operationId!);
    }
    expect(spec.paths['/health/ready'].get!.responses['503']).toBeDefined();
    expect(spec.paths['/health/live'].get!.responses['503']).toBeUndefined();
    expect(
      spec.paths['/api/v1/games/{gameSlug}/characters/{slug}'].get!.responses['404'],
    ).toBeDefined();
  });
  it('documents protected admin routes and public login challenge separately', () => {
    expect(spec.components!.securitySchemes!.atlasSession).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'atlas_session',
    });
    expect(spec.paths['/api/v1/admin/auth/login'].post!.security ?? []).toEqual([]);
    expect(spec.paths['/api/v1/admin/auth/login'].post!.responses['429']).toBeDefined();
    expect(spec.paths['/api/v1/admin/auth/session'].get!.security).toEqual([{ atlasSession: [] }]);
    const operation = spec.paths['/api/v1/admin/games/{gameId}/characters/{id}'].put!;
    expect(operation.security).toEqual([{ atlasSession: [] }]);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-CSRF-Token', required: true }),
        expect.objectContaining({ name: 'Origin', required: true }),
      ]),
    );
    expect(operation.responses['401']).toBeDefined();
    expect(operation.responses['403']).toBeDefined();
    const ids = Object.values(spec.paths).flatMap((p) =>
      Object.entries(p)
        .filter(([method]) => ['get', 'post', 'put', 'delete', 'patch'].includes(method))
        .map(([, op]) => op.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('describes nullable nested fields and required arrays accurately', () => {
    const schemas = spec.components!.schemas!;
    expect(schemas.CharacterDetailDto).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'slug',
        'role',
        'portraitUrl',
        'imageUrl',
        'voice',
        'mechanics',
        'stats',
        'skills',
        'talents',
        'potentials',
        'sources',
        'aliases',
      ]),
      properties: {
        role: { type: 'string', nullable: true },
        portraitUrl: { type: 'string', nullable: true },
        voice: { type: 'string', nullable: true },
        stats: { type: 'array', items: { $ref: '#/components/schemas/CharacterStatDto' } },
        skills: { type: 'array', items: { $ref: '#/components/schemas/SkillDto' } },
        talents: { type: 'array', items: { $ref: '#/components/schemas/TalentDto' } },
        potentials: { type: 'array', items: { $ref: '#/components/schemas/PotentialDto' } },
        sources: { type: 'array', items: { $ref: '#/components/schemas/SourceDto' } },
      },
    });
    expect(schemas.SourceDto).toMatchObject({
      properties: { verifiedAt: { type: 'string', format: 'date-time', nullable: true } },
    });
    expect(schemas.GameVersionDto).toMatchObject({
      properties: { releaseDate: { type: 'string', format: 'date', nullable: true } },
    });
    expect(schemas.MechanicsV1Dto).toMatchObject({
      properties: { attackType: { enum: ['Melee', 'Ranged'] } },
    });
    expect(schemas.PageMetaDto).toMatchObject({ properties: { totalPages: { minimum: 0 } } });
    expect(schemas.ErrorResponseDto).toMatchObject({ required: ['error'] });
  });
  it('documents CMS commands, concurrency, private previews and public guide snapshots', () => {
    const commands = [
      'draft',
      'submit-review',
      'approve',
      'return-to-draft',
      'publish',
      'unpublish',
      'archive',
      'restore',
    ];
    for (const action of commands) {
      const item = spec.paths[`/api/v1/admin/contents/{id}/${action}`];
      const operation = action === 'draft' ? item.patch! : item.post!;
      expect(operation.security).toEqual([{ atlasSession: [] }]);
      expect(operation.requestBody).toBeDefined();
      for (const status of ['200', '400', '401', '403', '404', '409', '413', '500'])
        expect(operation.responses[status]).toBeDefined();
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'X-CSRF-Token', required: true }),
          expect.objectContaining({ name: 'Origin', required: true }),
        ]),
      );
    }
    const preview = spec.paths['/api/v1/admin/contents/{id}/preview'].get!;
    expect(preview.security).toEqual([{ atlasSession: [] }]);
    expect(preview.responses['200']).toMatchObject({
      headers: {
        'Cache-Control': { schema: { enum: ['no-store'] } },
        'X-Robots-Tag': { schema: { enum: ['noindex, nofollow'] } },
      },
    });
    expect(spec.paths['/api/v1/admin/contents'].post!.responses['201']).toBeDefined();
    expect(spec.paths['/api/v1/games/{gameSlug}/guides/{slug}'].get!.security ?? []).toEqual([]);
    expect(spec.components!.schemas!.ExpectedRevisionDto).toMatchObject({
      required: ['expectedRevision'],
    });
    expect(spec.components!.schemas!.CreateContentDto).toMatchObject({
      required: expect.arrayContaining(['wiki']),
      properties: {
        wiki: { oneOf: expect.any(Array) },
        category: {
          enum: ['character', 'team', 'boss', 'general', 'beginner', 'combat', 'progression'],
        },
      },
    });
    expect(spec.components!.schemas!.GuideDetailDto).toMatchObject({
      properties: { html: { type: 'string' }, revision: { type: 'integer' } },
    });
  });
  it('documents image upload, protected previews, public files and revision covers', () => {
    const upload = spec.paths['/api/v1/admin/games/{gameId}/media'].post!;
    expect(upload.security).toEqual([{ atlasSession: [] }]);
    expect(upload.requestBody).toMatchObject({
      content: { 'multipart/form-data': { schema: { required: ['file'] } } },
    });
    expect(upload.responses['201']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/MediaUploadResponseDto' } },
      },
    });
    for (const status of ['400', '401', '403', '413', '503'])
      expect(upload.responses[status]).toBeDefined();
    expect(spec.paths['/api/v1/admin/media/{id}/file'].get!.responses['200']).toMatchObject({
      content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
    });
    expect(spec.paths['/api/v1/media/{id}/file'].get!.security ?? []).toEqual([]);
    expect(spec.components!.schemas!.GuideDetailDto).toMatchObject({
      properties: { coverImageId: { nullable: true }, cover: { nullable: true } },
    });
  });
  it('documents Team CRUD with typed responses, concurrency and session security', () => {
    const base = '/api/v1/admin/games/{gameId}/teams';
    expect(spec.paths[base].post!.responses['201']).toBeDefined();
    for (const method of ['put', 'delete'] as const) {
      const operation = spec.paths[`${base}/{id}`][method]!;
      expect(operation.security).toEqual([{ atlasSession: [] }]);
      for (const status of ['200', '400', '401', '403', '404', '409', '413', '500'])
        expect(operation.responses[status]).toBeDefined();
      expect(operation.requestBody).toBeDefined();
      expect(operation.parameters).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'X-CSRF-Token', required: true })]),
      );
    }
    expect(spec.paths['/api/v1/games/{gameSlug}/teams'].get!.security ?? []).toEqual([]);
    expect(spec.components!.schemas!.ReplaceTeamDto).toMatchObject({
      required: expect.arrayContaining([
        'expectedVersion',
        'mainCharacterId',
        'supportCharacterIds',
      ]),
    });
  });
  it('matches query validation constraints and actual success payloads', async () => {
    const route = spec.paths['/api/v1/games/{gameSlug}/characters'].get!;
    expect(route.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
          schema: expect.objectContaining({
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
          }),
        }),
        expect.objectContaining({
          name: 'page',
          schema: expect.objectContaining({ type: 'integer', maximum: 1000000 }),
        }),
        expect.objectContaining({
          name: 'rarity',
          schema: expect.objectContaining({ type: 'integer', enum: [4, 5] }),
        }),
      ]),
    );
    await request(app.getHttpServer())
      .get('/api/v1/games/stella-sora/characters?limit=101')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/games/stella-sora/characters?status=draft')
      .expect(400);
    const profile = await request(app.getHttpServer())
      .get('/api/v1/games/stella-sora/characters/allie')
      .expect(200);
    expect(profile.body).toEqual({ data: sampleProfile });
    const health = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(health.body).toEqual({ status: 'ok' });
  });
  it('matches documented readiness errors and request IDs to runtime', async () => {
    query.mockRejectedValueOnce(new Error('private database details'));
    const failed = await request(app.getHttpServer())
      .get('/health/ready')
      .set('X-Request-Id', 'swagger-check')
      .expect(503);
    expect(failed.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database unavailable',
        requestId: 'swagger-check',
        details: [],
      },
    });
    expect(failed.headers['x-request-id']).toBe(failed.body.error.requestId);
    const response = spec.paths['/health/ready'].get!.responses['503'];
    expect(response).toMatchObject({
      content: {
        'application/json': {
          example: {
            error: {
              code: failed.body.error.code,
              message: failed.body.error.message,
              details: [],
            },
          },
        },
      },
    });
  });
  it('matches catalog error envelopes without leaking internal database errors', async () => {
    catalog.character.mockRejectedValueOnce(new NotFoundException('Character not found'));
    const missing = await request(app.getHttpServer())
      .get('/api/v1/games/stella-sora/characters/missing')
      .expect(404);
    expect(missing.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Character not found',
      details: [],
    });
    catalog.games.mockRejectedValueOnce(new Error('private SQL connection details'));
    const failed = await request(app.getHttpServer()).get('/api/v1/games').expect(500);
    expect(failed.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: [],
      requestId: failed.headers['x-request-id'],
    });
  });
  it('serves UI/JSON/YAML outside production and exposes no docs routes in production', async () => {
    await request(app.getHttpServer()).get('/docs/').expect(200);
    await request(app.getHttpServer()).get('/docs-yaml').expect(200);
    const production = await application('production');
    try {
      for (const route of ['/docs', '/docs-json', '/docs-yaml'])
        await request(production.getHttpServer()).get(route).expect(404);
    } finally {
      await production.close();
    }
  });
});
