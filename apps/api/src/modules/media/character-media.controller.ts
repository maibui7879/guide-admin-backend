import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../common/swagger/api-responses';
import { Public, RequireAnyPermission } from '../auth/decorators/auth.decorators';
import type { AuthRequest } from '../auth/services/auth.service';
import { csrfHeader } from '../auth/swagger/auth-api.decorators';
import { envelope, uuid } from '../strategy/dto/strategy.schemas';
import { CharacterMediaService } from './character-media.service';
const descriptor = {
  type: 'object' as const,
  nullable: true,
  properties: {
    mediaId: { ...uuid, nullable: true },
    url: { type: 'string' as const },
    alt: { type: 'string' as const },
  },
};
const response = {
  type: 'object' as const,
  properties: { characterId: uuid, gameId: uuid, portrait: descriptor, image: descriptor },
};
@Controller('api/v1')
@ApiTags('character media')
@ApiHttpBoundary()
@ApiError(404, 'NOT_FOUND', 'Character not found', 'Character or active game unavailable.')
export class CharacterMediaController {
  constructor(private readonly service: CharacterMediaService) {}
  @Get('games/:gameSlug/characters/:slug/media')
  @Public()
  @ApiOperation({
    operationId: 'getPublishedCharacterMedia',
    summary: 'Read uploaded character art or existing catalogue URL fallback',
    description:
      'Separate media subresource. Existing character catalogue routes remain compatible. Uploaded files are public only while referenced by a published character in an active game.',
  })
  @ApiResponse({ status: 200, headers: requestIdHeaders, schema: envelope(response) })
  publicGet(@Param('gameSlug') game: string, @Param('slug') slug: string) {
    return this.service.get(game, slug);
  }
  @Get('admin/games/:gameId/characters/:id/media')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write', 'content:review')
  @ApiCookieAuth('atlasSession')
  @ApiOperation({
    operationId: 'getAdminCharacterMedia',
    summary: 'Read character media and concurrency token (0 before first assignment)',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      ...response,
      properties: { ...response.properties, version: { type: 'integer', minimum: 0 } },
    }),
  })
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'Staff session required.')
  @ApiError(403, 'FORBIDDEN', 'Insufficient permissions', 'Game-scoped catalogue access required.')
  get(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.get(game, id, req.auth!.user);
  }
  @Patch('admin/games/:gameId/characters/:id/media')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @ApiCookieAuth('atlasSession')
  @csrfHeader()
  @ApiOperation({
    operationId: 'replaceCharacterMedia',
    summary: 'Replace character art assignments',
    description:
      'Full replacement. Omitted IDs clear the uploaded assignment and restore catalogue fallback. Initial expectedVersion=0. EDITOR may only modify draft characters; published/archived characters require catalog:write. Same-game available images and alt text required. References prevent image deletion.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 0, maximum: 2147483646 },
        portraitMediaId: { ...uuid, nullable: true },
        imageMediaId: { ...uuid, nullable: true },
        portraitAlt: { type: 'string', maxLength: 300 },
        imageAlt: { type: 'string', maxLength: 300 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope({
      type: 'object',
      properties: { characterId: uuid, version: { type: 'integer' } },
    }),
  })
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'Staff session required.')
  @ApiError(
    403,
    'FORBIDDEN',
    'Insufficient permissions',
    'Game permission, draft scope and CSRF enforced.',
  )
  @ApiError(409, 'CONFLICT', 'Character media changed', 'Refetch the current token before editing.')
  replace(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.replace(req.auth!.user, game, id, input);
  }
}
