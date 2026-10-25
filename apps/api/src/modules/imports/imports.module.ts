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
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../common/swagger/api-responses';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
import { parseInput } from '../../common/validation/parse-input';
import type { AuthRequest } from '../auth/services/auth.service';
import { RequireAnyPermission } from '../auth/decorators/auth.decorators';
import { csrfHeader } from '../auth/swagger/auth-api.decorators';
import { ContentAccessService } from '../guides/services/content-access.service';
import { CatalogWriterService } from '../catalog/services/catalog-writer.service';
import { CharacterWriteDto } from '../catalog/dto/write.dto';
import { envelope, expectedSchema, uuid } from '../strategy/dto/strategy.schemas';
import { ImportsService } from './imports.service';
const batch = {
  type: 'object' as const,
  properties: {
    id: uuid,
    gameId: uuid,
    gameVersionId: { ...uuid, nullable: true },
    sourceUrl: { type: 'string' as const, format: 'uri' },
    state: { type: 'string' as const, enum: ['staged', 'applied', 'cancelled'] },
    version: { type: 'integer' as const },
    checksum: { type: 'string' as const },
    createdAt: { type: 'string' as const, format: 'date-time' },
    appliedAt: { type: 'string' as const, format: 'date-time', nullable: true },
    result: { type: 'array' as const, nullable: true, items: uuid },
  },
};
@Controller('api/v1/admin/games/:gameId')
@ApiTags('catalog imports and patch diffs')
@ApiCookieAuth('atlasSession')
@ApiHttpBoundary()
@ApiExtraModels(CharacterWriteDto)
@ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'Staff session required.')
@ApiError(
  403,
  'FORBIDDEN',
  'Insufficient permissions',
  'Imports require catalog:write (ADMIN under current roles), game access and CSRF for mutations.',
)
@ApiError(404, 'NOT_FOUND', 'Import batch not found', 'Batch or active game unavailable.')
@ApiError(
  409,
  'CONFLICT',
  'Import changed or is no longer staged',
  'Stale version/baseline, slug conflict or reused idempotency key with different input. No partial catalogue changes are committed.',
)
class ImportsController {
  constructor(private readonly service: ImportsService) {}
  @Get('imports')
  @RequireAnyPermission('catalog:write')
  @ApiOperation({
    operationId: 'listImportBatches',
    summary: 'List staged/applied/cancelled character imports',
  })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(batch, true) })
  list(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Query() q: PaginationQuery,
    @Req() req: AuthRequest,
  ) {
    return this.service.list(req.auth!.user, game, q);
  }
  @Get('imports/:id')
  @RequireAnyPermission('catalog:write')
  @ApiOperation({
    operationId: 'getImportBatch',
    summary: 'Inspect immutable staged inputs and baseline snapshots',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      ...batch,
      properties: {
        ...batch.properties,
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: uuid,
              input: { $ref: getSchemaPath(CharacterWriteDto) },
              baseline: { type: 'object', nullable: true, additionalProperties: true },
            },
          },
        },
      },
    }),
  })
  get(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.get(req.auth!.user, game, id);
  }
  @Post('imports')
  @RequireAnyPermission('catalog:write')
  @csrfHeader()
  @ApiOperation({
    operationId: 'stageCharacterImport',
    summary: 'Validate and stage 1–10 character replacements',
    description:
      'No remote URL fetching. Supply verified data and source URL. Existing characters require explicit UUIDs. Stores a baseline including skills/stats/progression and creates no catalogue mutations. Idempotency key is unique per game; same normalized request returns the same batch.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey', 'sourceUrl', 'records'],
      properties: {
        idempotencyKey: uuid,
        gameVersionId: { ...uuid, nullable: true },
        sourceUrl: { type: 'string', format: 'uri', maxLength: 2048 },
        records: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['input'],
            properties: { id: uuid, input: { $ref: getSchemaPath(CharacterWriteDto) } },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 201, headers: requestIdHeaders, schema: envelope(batch) })
  stage(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.stage(req.auth!.user, game, input);
  }
  @Post('imports/:id/:action')
  @HttpCode(200)
  @RequireAnyPermission('catalog:write')
  @csrfHeader()
  @ApiParam({ name: 'action', enum: ['apply', 'cancel'] })
  @ApiOperation({
    operationId: 'applyOrCancelImport',
    summary: 'Apply all staged changes atomically or cancel the batch',
    description:
      'Requires expectedVersion. Acquires target locks in UUID order and rejects changed baselines. Catalogue updates, patch diffs, batch status and outbox events commit together. Retrying the successful apply with the original token returns its stored result without reapplying.',
  })
  @ApiBody({ schema: expectedSchema })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      type: 'object',
      properties: {
        id: uuid,
        state: { type: 'string', enum: ['applied', 'cancelled'] },
        version: { type: 'integer' },
        result: { type: 'array', items: uuid },
      },
    }),
  })
  apply(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action') action: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.apply(
      req.auth!.user,
      game,
      id,
      input,
      parseInput(z.enum(['apply', 'cancel']), action) === 'cancel',
    );
  }
  @Get('patch-diffs')
  @RequireAnyPermission('catalog:write', 'content:review')
  @ApiOperation({
    operationId: 'listCharacterPatchDiffs',
    summary: 'Inspect before/after catalogue snapshots from applied imports',
    description:
      'Editorial revisions are separate from gameVersionId. No fabricated changes or automatic editorial judgments. Snapshot null before means a newly imported character.',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope(
      {
        type: 'object',
        properties: {
          id: uuid,
          batchId: uuid,
          gameVersionId: { ...uuid, nullable: true },
          characterId: uuid,
          before: { type: 'object', nullable: true, additionalProperties: true },
          after: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      true,
    ),
  })
  diffs(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Query() q: PaginationQuery,
    @Req() req: AuthRequest,
  ) {
    return this.service.diffs(req.auth!.user, game, q);
  }
}
@Module({})
export class ImportsModule {
  static register(db: DataSource) {
    return {
      module: ImportsModule,
      controllers: [ImportsController],
      providers: [
        { provide: DataSource, useValue: db },
        ContentAccessService,
        CatalogWriterService,
        ImportsService,
      ],
    };
  }
}
