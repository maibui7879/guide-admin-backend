import { Controller, Get, Inject, Module, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequireAnyPermission } from '../auth/decorators/auth.decorators';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../common/swagger/api-responses';
import { envelope } from '../strategy/dto/strategy.schemas';
import type { HttpTelemetry } from '../../common/http/http-telemetry';
@Controller('api/v1/admin/operations')
@ApiTags('operations')
@ApiCookieAuth('atlasSession')
@ApiHttpBoundary()
@ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'Staff session required.')
@ApiError(
  403,
  'FORBIDDEN',
  'Insufficient permissions',
  'Global operational metrics require users:manage (ADMIN).',
)
class OperationsController {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  @Get('metrics')
  @RequireAnyPermission('users:manage')
  @ApiOperation({
    operationId: 'getOperationalMetrics',
    summary: 'Read process HTTP telemetry and durable editorial/worker backlog',
    description:
      'Global ADMIN view. HTTP counters are per-process since boot, without query strings, IP labels or analytics identifiers. Queue state is read from PostgreSQL. Healthy worker means heartbeat within 30 seconds; no Redis credentials or raw job errors returned.',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      type: 'object',
      properties: {
        uptimeSeconds: { type: 'number' },
        http: {
          type: 'object',
          properties: {
            requestCount: { type: 'integer' },
            totalDurationMs: { type: 'number' },
            search: {
              type: 'object',
              properties: {
                requests: { type: 'integer' },
                zeroResultRequests: { type: 'integer' },
              },
            },
            statuses: { type: 'object', additionalProperties: { type: 'integer' } },
            durationBuckets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  upperMs: { type: 'number', nullable: true },
                  count: { type: 'integer' },
                },
              },
            },
          },
        },
        contentStates: {
          type: 'array',
          items: {
            type: 'object',
            properties: { state: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        outboxStates: {
          type: 'array',
          items: {
            type: 'object',
            properties: { state: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        openReviewFlags: { type: 'integer' },
        activeWorkers: { type: 'integer' },
        oldestPendingSeconds: { type: 'number' },
      },
    }),
  })
  async metrics(@Req() req: Request) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const contentStates = await m.query(
        'SELECT state,count(*)::int AS count FROM contents GROUP BY state ORDER BY state',
      );
      const outboxStates = await m.query(
        'SELECT state,count(*)::int AS count FROM outbox_events GROUP BY state ORDER BY state',
      );
      const [counts] = await m.query(`SELECT
        (SELECT count(*)::int FROM editorial_review_flags WHERE status='open') AS "openReviewFlags",
        (SELECT count(*)::int FROM worker_heartbeats WHERE stopped_at IS NULL AND last_seen_at>now()-interval '30 seconds') AS "activeWorkers",
        (SELECT COALESCE(EXTRACT(epoch FROM now()-min(created_at)),0)::float8 FROM outbox_events WHERE state IN ('pending','dispatching','dispatched')) AS "oldestPendingSeconds"`);
      const telemetry = req.app.locals.atlasTelemetry as HttpTelemetry | undefined;
      return {
        data: {
          uptimeSeconds: Math.floor(process.uptime()),
          http: telemetry?.snapshot() ?? null,
          contentStates,
          outboxStates,
          ...counts,
        },
      };
    });
  }
}
@Module({})
export class OperationsModule {
  static register(db: DataSource) {
    return {
      module: OperationsModule,
      controllers: [OperationsController],
      providers: [{ provide: DataSource, useValue: db }],
    };
  }
}
