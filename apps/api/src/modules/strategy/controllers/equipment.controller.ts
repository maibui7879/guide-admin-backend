import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  HttpCode,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, RequireAnyPermission } from '../../auth/decorators/auth.decorators';
import type { AuthRequest } from '../../auth/services/auth.service';
import { EquipmentService } from '../services/equipment.service';
import { EquipmentAdminQuery, EquipmentQuery } from '../dto/strategy-query.dto';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../../common/swagger/api-responses';
import { csrfHeader } from '../../auth/swagger/auth-api.decorators';
import {
  envelope,
  equipmentRecordSchema,
  equipmentSchema,
  expectedSchema,
} from '../dto/strategy.schemas';

@Controller('api/v1/games/:gameSlug/equipment')
@ApiTags('equipment')
@ApiHttpBoundary()
@ApiError(
  404,
  'NOT_FOUND',
  'Equipment not found',
  'Active game or published equipment is unavailable.',
)
export class EquipmentController {
  constructor(private readonly service: EquipmentService) {}
  @Get()
  @Public()
  @ApiOperation({ operationId: 'listPublishedEquipment', summary: 'Browse published equipment' })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope(equipmentRecordSchema, true),
  })
  list(@Param('gameSlug') game: string, @Query() q: EquipmentQuery) {
    return this.service.list(game, q);
  }
  @Get(':slug')
  @Public()
  @ApiOperation({ operationId: 'getPublishedEquipment', summary: 'Read published equipment' })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(equipmentRecordSchema) })
  get(@Param('gameSlug') game: string, @Param('slug') slug: string) {
    return this.service.get(game, slug);
  }
}
@Controller('api/v1/admin/games/:gameId/equipment')
@ApiTags('admin equipment')
@ApiCookieAuth('atlasSession')
@ApiHttpBoundary()
@ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'A staff session is required.')
@ApiError(
  403,
  'FORBIDDEN',
  'Insufficient permissions',
  'Requires game access, permission and CSRF for mutations.',
)
@ApiError(404, 'NOT_FOUND', 'Equipment not found', 'Equipment or game unavailable.')
@ApiError(
  409,
  'CONFLICT',
  'Equipment changed or archived',
  'Stale version, duplicate slug or terminal archived state.',
)
export class AdminEquipmentController {
  constructor(private readonly service: EquipmentService) {}
  @Get()
  @RequireAnyPermission('catalog:write', 'catalog:draft:write', 'content:review')
  @ApiOperation({
    operationId: 'listAdminEquipment',
    summary: 'List game equipment, including drafts',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope(equipmentRecordSchema, true),
  })
  list(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Query() q: EquipmentAdminQuery,
    @Req() req: AuthRequest,
  ) {
    return this.service.list(game, q, req.auth!.user);
  }
  @Get(':id')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write', 'content:review')
  @ApiOperation({ operationId: 'getAdminEquipment', summary: 'Read equipment for editing' })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(equipmentRecordSchema) })
  get(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.get(game, id, req.auth!.user);
  }
  @Post()
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @csrfHeader()
  @ApiOperation({ operationId: 'createEquipment', summary: 'Create draft equipment' })
  @ApiBody({
    schema: {
      ...equipmentSchema,
      required: [...equipmentSchema.required!, 'slug'],
      properties: {
        ...equipmentSchema.properties,
        slug: { type: 'string', maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      },
    },
  })
  @ApiResponse({ status: 201, headers: requestIdHeaders, schema: envelope(equipmentRecordSchema) })
  create(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(req.auth!.user, game, input);
  }
  @Patch(':id')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @csrfHeader()
  @ApiOperation({
    operationId: 'replaceEquipment',
    summary: 'Replace equipment fields and return to draft',
    description:
      'Full replacement with expectedVersion. Editing removes public availability until republished; dependent builds become unavailable while equipment is draft.',
  })
  @ApiBody({
    schema: {
      ...equipmentSchema,
      required: [...equipmentSchema.required!, 'expectedVersion'],
      properties: { ...equipmentSchema.properties, ...expectedSchema.properties },
    },
  })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(equipmentRecordSchema) })
  edit(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.mutate(req.auth!.user, game, id, 'edit', input);
  }
  @Post(':id/publish')
  @HttpCode(200)
  @RequireAnyPermission('content:publish')
  @csrfHeader()
  @ApiOperation({ operationId: 'publishEquipment', summary: 'Publish equipment' })
  @ApiBody({ schema: expectedSchema })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(equipmentRecordSchema) })
  publish(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.mutate(req.auth!.user, game, id, 'publish', input);
  }
  @Post(':id/archive')
  @HttpCode(200)
  @RequireAnyPermission('content:publish')
  @csrfHeader()
  @ApiOperation({
    operationId: 'archiveEquipment',
    summary: 'Archive equipment',
    description:
      'Terminal state. Historical references retained; dependent public builds become unavailable.',
  })
  @ApiBody({ schema: expectedSchema })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(equipmentRecordSchema) })
  archive(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.mutate(req.auth!.user, game, id, 'archive', input);
  }
}
