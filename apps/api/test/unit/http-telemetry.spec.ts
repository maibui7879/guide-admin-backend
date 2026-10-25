import 'reflect-metadata';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { Public } from '../../src/modules/auth/decorators/auth.decorators';
import { parseEnvironment } from '../../src/config/env';
import { configureHttp } from '../../src/common/http/configure-http';
import { HttpTelemetry, PublicReadLimiter } from '../../src/common/http/http-telemetry';
@Controller('api/v1/rate-probe')
@Public()
class RateProbe {
  @Get() read() {
    return { data: 'ok' };
  }
}
describe('Operational HTTP protections', () => {
  it('bounds IP buckets and expires the fixed window without trusting forwarded headers', () => {
    const limiter = new PublicReadLimiter(2, 1);
    expect(limiter.check('ip-a', 0)).toBeNull();
    expect(limiter.check('ip-a', 1)).toBeNull();
    expect(limiter.check('ip-a', 2)).toBe(60);
    expect(limiter.check('ip-b', 3)).toBe(60);
    expect(limiter.check('ip-b', 60001)).toBeNull();
  });
  it('keeps cumulative latency buckets and response classes without user/query labels', () => {
    const t = new HttpTelemetry();
    t.record(200, 20);
    t.record(500, 800);
    t.recordSearch(0);
    t.recordSearch(3);
    expect(t.snapshot()).toMatchObject({
      requestCount: 2,
      totalDurationMs: 820,
      statuses: { '2xx': 1, '5xx': 1 },
      search: { requests: 2, zeroResultRequests: 1 },
    });
    expect(t.snapshot().durationBuckets.find((b) => b.upperMs === 1000)?.count).toBe(2);
  });
  it('returns traced 429 responses with CORS/Retry-After while liveness remains available', async () => {
    let app: INestApplication | undefined;
    try {
      const module = await Test.createTestingModule({
        imports: [
          AppModule.register({ query: async () => [{ value: 1 }] } as unknown as DataSource),
        ],
        controllers: [RateProbe],
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
          PUBLIC_RATE_LIMIT_PER_MINUTE: '2',
        }),
      );
      await app.init();
      await request(app.getHttpServer()).get('/api/v1/rate-probe').expect(200);
      await request(app.getHttpServer()).get('/api/v1/rate-probe').expect(200);
      const limited = await request(app.getHttpServer())
        .get('/api/v1/rate-probe')
        .set('X-Request-Id', 'rate-fixture')
        .set('Origin', 'http://localhost:3001')
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(429);
      expect(limited.body.error).toMatchObject({
        code: 'RATE_LIMITED',
        requestId: 'rate-fixture',
        details: [],
      });
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.headers['access-control-allow-origin']).toBe('http://localhost:3001');
      await request(app.getHttpServer()).get('/health/live').expect(200);
      await request(app.getHttpServer()).get('/api/v1/admin/operations/metrics').expect(401);
    } finally {
      if (app) await app.close();
    }
  });
});
