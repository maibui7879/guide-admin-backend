import { HttpErrorFilter } from './http-error.filter';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { json, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import pino from 'pino';
import { Environment } from '../../config/env';
import type { AuthRequest } from '../../modules/auth/services/auth.service';
import { HttpTelemetry, PublicReadLimiter } from './http-telemetry';

type TracedRequest = Request & { requestId: string };
export function configureHttp(app: INestApplication, env: Environment): void {
  const logger = pino({ level: env.LOG_LEVEL });
  const telemetry = new HttpTelemetry();
  const limiter = new PublicReadLimiter(env.PUBLIC_RATE_LIMIT_PER_MINUTE);
  app.getHttpAdapter().getInstance().locals.atlasTelemetry = telemetry;
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', env.TRUST_PROXY_HOPS || false);
  app.use((req: TracedRequest, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.requestId =
      typeof incoming === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    if (req.path.startsWith('/api/v1/admin')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    const started = performance.now();
    res.on('finish', () => {
      telemetry.record(res.statusCode, performance.now() - started);
      const entry = {
        requestId: req.requestId,
        method: req.method,
        path: req.route?.path ?? 'unmatched',
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        actorId: (req as AuthRequest).auth?.user.id ?? null,
      };
      if (res.statusCode >= 500) logger.error(entry, 'request');
      else logger.info(entry, 'request');
    });
    next();
  });
  app.use(helmet());
  app.enableCors({
    // Reflect each caller in wildcard mode so credentialed browser requests remain valid.
    origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });
  app.use((req: TracedRequest, res: Response, next: NextFunction) => {
    if (
      req.method === 'GET' &&
      req.path.startsWith('/api/v1/') &&
      !req.path.startsWith('/api/v1/admin/')
    ) {
      const retry = limiter.check(req.ip ?? req.socket.remoteAddress ?? 'unknown');
      if (retry !== null) {
        res.setHeader('Retry-After', String(retry));
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many public read requests',
            requestId: req.requestId,
            details: [],
          },
        });
        return;
      }
    }
    next();
  });
  app.use(json({ limit: '256kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
}
