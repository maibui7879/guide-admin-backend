import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { parseInput } from '../../../common/validation/parse-input';
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../../common/swagger/api-responses';
import { Public, RequireAnyPermission } from '../../auth/decorators/auth.decorators';
import type { AuthRequest } from '../../auth/services/auth.service';
import { csrfHeader } from '../../auth/swagger/auth-api.decorators';
import { StrategyKind } from '../domain/strategy-input';
import { StrategyAdminQuery, StrategyQuery } from '../dto/strategy-query.dto';
import {
  buildSchema,
  envelope,
  expectedSchema,
  headSchema,
  tierSchema,
  uuid,
} from '../dto/strategy.schemas';
import { StrategyService } from '../services/strategy.service';

// Two explicit resource contracts share snapshot persistence and authorization rules.
export function strategyControllers(kind: StrategyKind, path: 'builds' | 'tier-lists') {
  const payload = kind === 'build' ? buildSchema : tierSchema;
  const detail = {
    ...headSchema,
    properties: { ...headSchema.properties, revision: { type: 'integer' as const }, payload },
  };
  const publicDetail = {
    type: 'object' as const,
    required: ['id', 'gameId', 'kind', 'slug', 'characterId', 'revision', 'payload'],
    properties: {
      id: uuid,
      gameId: uuid,
      kind: headSchema.properties!.kind,
      slug: headSchema.properties!.slug,
      characterId: { ...uuid, nullable: true },
      revision: { type: 'integer' as const },
      payload,
    },
  };
  @Controller(`api/v1/games/:gameSlug/${path}`)
  @ApiTags(path)
  @ApiHttpBoundary()
  @ApiError(
    404,
    'NOT_FOUND',
    'Strategy page not found',
    'Only published revisions with available game, patch, character and equipment references are returned.',
  )
  class PublicStrategyController {
    constructor(private readonly service: StrategyService) {}
    @Get()
    @Public()
    @ApiOperation({
      operationId: `${kind}List`,
      summary: `Browse published ${path}`,
      description:
        'Uses the publication pointer. Later drafts never replace the published payload. Ordered by updatedAt descending then UUID ascending.',
    })
    @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(publicDetail, true) })
    list(@Param('gameSlug') game: string, @Query() q: StrategyQuery) {
      return this.service.list(kind, game, q);
    }
    @Get(':slug')
    @Public()
    @ApiOperation({ operationId: `${kind}Get`, summary: `Read a published ${kind}` })
    @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(publicDetail) })
    get(@Param('gameSlug') game: string, @Param('slug') slug: string) {
      return this.service.get(kind, game, slug);
    }
  }
  @Controller(`api/v1/admin/games/:gameId/${path}`)
  @ApiTags(`admin ${path}`)
  @ApiCookieAuth('atlasSession')
  @ApiHttpBoundary()
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'A staff session is required.')
  @ApiError(
    403,
    'FORBIDDEN',
    'Insufficient permissions',
    'Requires game access and content write/read or publish permission. Mutation requires CSRF.',
  )
  @ApiError(
    404,
    'NOT_FOUND',
    'Strategy page not found',
    'Game, page or historical revision unavailable.',
  )
  @ApiError(
    409,
    'CONFLICT',
    'Strategy changed or archived',
    'Stale expectedVersion, duplicate slug, missing publication or terminal archived state.',
  )
  class AdminStrategyController {
    constructor(private readonly service: StrategyService) {}
    @Get()
    @RequireAnyPermission('content:write', 'content:review', 'content:publish')
    @ApiOperation({ operationId: `${kind}AdminList`, summary: `List working ${path}` })
    @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(detail, true) })
    list(
      @Param('gameId', new ParseUUIDPipe()) game: string,
      @Query() q: StrategyAdminQuery,
      @Req() req: AuthRequest,
    ) {
      return this.service.list(kind, game, q, req.auth!.user);
    }
    @Get(':id')
    @RequireAnyPermission('content:write', 'content:review', 'content:publish')
    @ApiOperation({ operationId: `${kind}AdminGet`, summary: `Read latest ${kind} draft` })
    @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(detail) })
    get(
      @Param('gameId', new ParseUUIDPipe()) game: string,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Req() req: AuthRequest,
    ) {
      return this.service.get(kind, game, id, req.auth!.user);
    }
    @Post()
    @RequireAnyPermission('content:write')
    @csrfHeader()
    @ApiOperation({
      operationId: `${kind}Create`,
      summary: `Create a ${kind} draft`,
      description:
        'Immutable slug/subject. Ordered recommendations or tier categories/entries are validated and snapshotted. Cross-game references are rejected by API and composite foreign keys.',
    })
    @ApiBody({
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'payload', ...(kind === 'build' ? ['characterId'] : [])],
        properties: {
          slug: { type: 'string', maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          payload,
          ...(kind === 'build' ? { characterId: uuid } : {}),
        },
      },
    })
    @ApiResponse({ status: 201, headers: requestIdHeaders, schema: envelope(headSchema) })
    create(
      @Param('gameId', new ParseUUIDPipe()) game: string,
      @Body() input: unknown,
      @Req() req: AuthRequest,
    ) {
      return this.service.create(req.auth!.user, game, kind, input);
    }
    @Patch(':id/draft')
    @RequireAnyPermission('content:write')
    @csrfHeader()
    @ApiOperation({
      operationId: `${kind}Edit`,
      summary: `Replace ${kind} draft`,
      description:
        'Creates a new immutable editorial revision. expectedVersion is the head concurrency token, separate from revision and gameVersionId. Retains the previous publication until explicitly published.',
    })
    @ApiBody({
      schema: {
        ...expectedSchema,
        required: ['expectedVersion', 'payload'],
        properties: { ...expectedSchema.properties, payload },
      },
    })
    @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(headSchema) })
    edit(
      @Param('gameId', new ParseUUIDPipe()) game: string,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Body() input: unknown,
      @Req() req: AuthRequest,
    ) {
      return this.service.edit(req.auth!.user, game, kind, id, input);
    }
    @Get(':id/revisions')
    @RequireAnyPermission('content:write', 'content:review', 'content:publish')
    @ApiOperation({ operationId: `${kind}History`, summary: `Read immutable ${kind} revisions` })
    @ApiResponse({
      status: 200,
      headers: requestIdHeaders,
      schema: envelope(
        {
          type: 'object',
          properties: {
            revision: { type: 'integer' },
            authorId: uuid,
            gameVersionId: { ...uuid, nullable: true },
            payload,
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        true,
      ),
    })
    history(
      @Param('gameId', new ParseUUIDPipe()) game: string,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Query() q: PaginationQuery,
      @Req() req: AuthRequest,
    ) {
      return this.service.history(req.auth!.user, game, kind, id, q);
    }
    @Post(':id/:action')
    @HttpCode(200)
    @RequireAnyPermission('content:write', 'content:publish')
    @csrfHeader()
    @ApiParam({ name: 'action', enum: ['publish', 'unpublish', 'archive', 'restore'] })
    @ApiOperation({
      operationId: `${kind}Command`,
      summary: `Publish, unpublish, archive or restore a ${kind}`,
      description:
        'Publish/unpublish/archive require content:publish (ADMIN). Restore requires content:write and sourceRevision, creates a new draft and retains an existing publication. Publishing checks every referenced record is published in the same game. Archive is terminal. Structured strategy data follows the catalogue publisher workflow; guide approval rules remain unchanged.',
    })
    @ApiBody({
      schema: {
        oneOf: [
          expectedSchema,
          {
            ...expectedSchema,
            required: ['expectedVersion', 'sourceRevision'],
            properties: {
              ...expectedSchema.properties,
              sourceRevision: { type: 'integer', minimum: 1, maximum: 2147483647 },
            },
          },
        ],
      },
    })
    @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(headSchema) })
    command(
      @Param('gameId', new ParseUUIDPipe()) game: string,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Param('action') action: string,
      @Body() input: unknown,
      @Req() req: AuthRequest,
    ) {
      return this.service.command(
        req.auth!.user,
        game,
        kind,
        id,
        parseInput(z.enum(['publish', 'unpublish', 'archive', 'restore']), action),
        input,
      );
    }
  }
  Object.defineProperty(PublicStrategyController, 'name', { value: `${kind}PublicController` });
  Object.defineProperty(AdminStrategyController, 'name', { value: `${kind}AdminController` });
  return [PublicStrategyController, AdminStrategyController];
}
