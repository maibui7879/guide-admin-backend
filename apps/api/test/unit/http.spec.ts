import 'reflect-metadata';
import { Controller, Get, Post, Body, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/common/http/configure-http';
import { parseEnvironment } from '../../src/config/env';
import { Public } from '../../src/modules/auth/decorators/auth.decorators';

class Input {
  @IsString() name!: string;
}
@Controller('probe')
@Public()
class Probe {
  @Post() @Public() post(@Body() body: Input) {
    return { data: body };
  }
  @Get('error') error() {
    throw new Error('private SQL password');
  }
}
describe('HTTP boundary', () => {
  let app: INestApplication;
  const query = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.register({ query } as unknown as DataSource)],
      controllers: [Probe],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttp(
      app,
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
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('keeps liveness independent of database and reports readiness failure', async () => {
    query.mockRejectedValueOnce(new Error('private connection details'));
    await request(app.getHttpServer()).get('/health/live').expect(200);
    const failed = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
    query.mockResolvedValueOnce([{ value: 1 }]);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
  it('validates DTOs and rejects unknown properties', async () => {
    await request(app.getHttpServer()).post('/probe').send({ name: 'Atlas' }).expect(201);
    const res = await request(app.getHttpServer())
      .post('/probe')
      .send({ name: 7, admin: true })
      .expect(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
  it('traces errors without exposing internal messages', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/error')
      .set('X-Request-Id', 'test-request')
      .expect(500);
    expect(res.headers['x-request-id']).toBe('test-request');
    expect(res.body.error.requestId).toBe('test-request');
    expect(JSON.stringify(res.body)).not.toContain('private');
  });
  it('rejects oversized and malformed JSON', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .send({ name: 'a'.repeat(270000) })
      .expect(413);
    await request(app.getHttpServer())
      .post('/probe')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
  });
  it('returns stable not-found errors', async () => {
    const res = await request(app.getHttpServer()).get('/missing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
