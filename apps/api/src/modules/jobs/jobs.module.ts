import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { AuthRequest } from '../auth/services/auth.service';
import { RequireAnyPermission } from '../auth/decorators/auth.decorators';
import { csrfHeader } from '../auth/swagger/auth-api.decorators';
import { ContentAccessService } from '../guides/services/content-access.service';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../common/swagger/api-responses';
import { envelope, uuid } from '../strategy/dto/strategy.schemas';
import { JobsQuery, ReviewFlagsQuery } from './jobs-query.dto';
import { JobsService } from './jobs.service';
import { OutboxService } from './outbox.service';
@Controller('api/v1/admin/games/:gameId')
@ApiTags('operations and patch review')
@ApiCookieAuth('atlasSession')
@ApiHttpBoundary()
@ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'Staff session required.')
@ApiError(
  403,
  'FORBIDDEN',
  'Insufficient permissions',
  'Requires game access and specific permission; mutations require CSRF.',
)
@ApiError(404, 'NOT_FOUND', 'Record not found', 'Game, event or flag unavailable.')
@ApiError(
  409,
  'CONFLICT',
  'Invalid operation state',
  'Event is not failed or flag was already resolved.',
)
class JobsController {
  constructor(private readonly service: JobsService) {}
  @Get('jobs')
  @RequireAnyPermission('users:manage')
  @ApiOperation({
    operationId: 'listOutboxEvents',
    summary: 'Inspect durable event dispatch and failures',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope(
      {
        type: 'object',
        properties: {
          id: uuid,
          eventType: { type: 'string' },
          aggregateId: uuid,
          state: { type: 'string' },
          dispatchAttempts: { type: 'integer' },
          nextAttemptAt: { type: 'string', format: 'date-time' },
          errorCode: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      true,
    ),
  })
  list(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Query() q: JobsQuery,
    @Req() req: AuthRequest,
  ) {
    return this.service.list(req.auth!.user, game, q);
  }
  @Post('jobs/:id/replay')
  @HttpCode(200)
  @RequireAnyPermission('users:manage')
  @csrfHeader()
  @ApiOperation({
    operationId: 'replayFailedEvent',
    summary: 'Replay a failed event',
    description:
      'Resets the durable dispatch state. Worker effects remain idempotent in PostgreSQL; completed events cannot be replayed.',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      type: 'object',
      properties: { id: uuid, state: { type: 'string', enum: ['pending'] } },
    }),
  })
  replay(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.replay(req.auth!.user, game, id);
  }
  @Get('review-flags')
  @RequireAnyPermission('content:write', 'content:review', 'content:publish')
  @ApiOperation({
    operationId: 'listEditorialReviewFlags',
    summary: 'List content needing review after a character change or patch',
    description:
      'Flags never rewrite published editorial judgments or publication pointers. An authorized reviewer resolves them explicitly.',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope(
      {
        type: 'object',
        properties: {
          id: uuid,
          contentId: { ...uuid, nullable: true },
          strategyId: { ...uuid, nullable: true },
          reason: { type: 'string', enum: ['character_updated', 'patch_released'] },
          gameVersionId: { ...uuid, nullable: true },
          status: { type: 'string', enum: ['open', 'resolved'] },
          resolvedBy: { ...uuid, nullable: true },
          resolvedAt: { type: 'string', format: 'date-time', nullable: true },
          resolutionNote: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      true,
    ),
  })
  flags(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Query() q: ReviewFlagsQuery,
    @Req() req: AuthRequest,
  ) {
    return this.service.flags(req.auth!.user, game, q);
  }
  @Post('review-flags/:id/resolve')
  @HttpCode(200)
  @RequireAnyPermission('content:review')
  @csrfHeader()
  @ApiOperation({
    operationId: 'resolveEditorialReviewFlag',
    summary: 'Resolve a patch-review flag with an editorial note',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['note'],
      properties: { note: { type: 'string', minLength: 1, maxLength: 1000 } },
    },
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      type: 'object',
      properties: { id: uuid, status: { type: 'string', enum: ['resolved'] } },
    }),
  })
  resolve(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.resolve(req.auth!.user, game, id, input);
  }
}
@Module({})
export class JobsModule {
  static register(db: DataSource) {
    return {
      module: JobsModule,
      controllers: [JobsController],
      providers: [
        { provide: DataSource, useValue: db },
        ContentAccessService,
        JobsService,
        OutboxService,
      ],
      exports: [OutboxService],
    };
  }
}
