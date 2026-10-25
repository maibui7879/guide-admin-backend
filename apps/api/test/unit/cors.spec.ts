import 'reflect-metadata';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Get } from '@nestjs/common';
import { configureHttp } from '../../src/common/http/configure-http';
import { parseEnvironment } from '../../src/config/env';
const fixture = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'a'.repeat(40),
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'test',
  STORAGE_REGION: 'auto',
  STORAGE_ACCESS_KEY: 'test',
  STORAGE_SECRET_KEY: 'test',
  LOG_LEVEL: 'silent',
};

@Controller('probe')
class CorsProbe {
  @Get() get() {
    return { status: 'ok' };
  }
}
@Module({ controllers: [CorsProbe] })
class CorsModule {}

describe('CORS wildcard compatibility with cookies', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });
  async function create(origins: string) {
    app = await NestFactory.create(CorsModule, { logger: false });
    configureHttp(app, parseEnvironment({ ...fixture, CORS_ORIGINS: origins }));
    await app.init();
    return app.getHttpServer();
  }
  it('reflects arbitrary browser origins and includes credentials and preflight headers', async () => {
    const server = await create('*');
    for (const origin of ['http://localhost:5173', 'https://editor.example.com']) {
      const res = await request(server)
        .options('/probe')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers.vary).toContain('Origin');
      expect(res.headers['access-control-allow-headers']).toContain('x-csrf-token');
    }
  });
  it('retains the explicit allowlist when wildcard is removed', async () => {
    const server = await create('https://editor.example.com');
    const denied = await request(server)
      .get('/probe')
      .set('Origin', 'https://unlisted.example.com')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await request(server)
      .get('/probe')
      .set('Origin', 'https://editor.example.com')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://editor.example.com');
  });
});
