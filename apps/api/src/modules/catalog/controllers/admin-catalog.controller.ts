import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { EntityManager } from 'typeorm';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../../common/swagger/api-responses';
import { CatalogWriterService } from '../services/catalog-writer.service';
import { characterInput } from '../services/catalog-writer.service';
import { AuthRequest } from '../../auth/services/auth.service';
import { RequireAnyPermission } from '../../auth/decorators/auth.decorators';
import { authFailure, csrfHeader, forbidden } from '../../auth/swagger/auth-api.decorators';
import {
  CharacterWriteDto,
  CreateGameDto,
  CreateVersionDto,
  IdResponseDto,
} from '../dto/write.dto';
import { parseInput } from '../../../common/validation/parse-input';

@Controller('api/v1/admin/games')
@ApiTags('admin catalog')
@ApiHttpBoundary()
@ApiCookieAuth('atlasSession')
@authFailure()
@forbidden()
@csrfHeader()
@ApiError(
  409,
  'CONFLICT',
  'Catalog entry already exists',
  'Duplicate slug/version or ordered child record.',
)
export class AdminCatalogController {
  constructor(private readonly writer: CatalogWriterService) {}
  @Post()
  @RequireAnyPermission('catalog:write')
  @ApiBody({ type: CreateGameDto })
  @ApiOperation({ operationId: 'createCatalogGame', summary: 'Create a game (ADMIN)' })
  @ApiResponse({ status: 201, type: IdResponseDto, headers: requestIdHeaders })
  async game(@Body() body: unknown) {
    return { data: { id: (await this.writer.createGame(body)).id } };
  }

  @Post(':gameId/versions')
  @RequireAnyPermission('catalog:write')
  @ApiBody({ type: CreateVersionDto })
  @ApiParam({ name: 'gameId', format: 'uuid' })
  @ApiOperation({ operationId: 'createCatalogVersion', summary: 'Create a game patch (ADMIN)' })
  @ApiResponse({ status: 201, type: IdResponseDto, headers: requestIdHeaders })
  async version(@Param('gameId', new ParseUUIDPipe()) game: string, @Body() body: unknown) {
    return { data: { id: (await this.writer.createVersion(game, body)).id } };
  }

  @Post(':gameId/characters')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @ApiBody({ type: CharacterWriteDto })
  @ApiParam({ name: 'gameId', format: 'uuid' })
  @ApiOperation({
    operationId: 'createCatalogCharacter',
    summary: 'Create a character (ADMIN or scoped EDITOR)',
    description:
      'Editors can create drafts only in assigned active games. Admins can publish catalog records with verified provenance. This is catalog publication, not the future guide review workflow.',
  })
  @ApiResponse({ status: 201, type: IdResponseDto, headers: requestIdHeaders })
  async character(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const value = parseInput(characterInput, body);
    const record = await this.writer.writeCharacter(game, body, undefined, (manager) =>
      this.scope(manager, req, game, value.status),
    );
    return { data: { id: record.id } };
  }

  @Put(':gameId/characters/:id')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @ApiBody({ type: CharacterWriteDto })
  @ApiParam({ name: 'gameId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'replaceCatalogCharacter',
    summary: 'Replace a character and its child records',
    description:
      'Replaces the character and aliases/stats/skills, resetting omitted optional fields to defaults. Talents and potentials are preserved when omitted; an explicit array replaces that collection and [] clears it. Editors may only replace existing drafts in assigned active games and cannot publish or edit published records. Admins can manage all catalog records. URL game/character relationship is checked transactionally.',
  })
  @ApiResponse({ status: 200, type: IdResponseDto, headers: requestIdHeaders })
  @ApiError(
    404,
    'NOT_FOUND',
    'Character not found',
    'No character with this ID belongs to the specified game.',
  )
  async replace(
    @Param('gameId', new ParseUUIDPipe()) game: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const value = parseInput(characterInput, body);
    const record = await this.writer.writeCharacter(game, body, id, (manager) =>
      this.scope(manager, req, game, value.status, id),
    );
    return { data: { id: record.id } };
  }
  private async scope(
    manager: EntityManager,
    req: AuthRequest,
    game: string,
    status: string,
    id?: string,
  ): Promise<void> {
    if (req.auth!.user.permissions.includes('catalog:write')) return;
    if (status !== 'draft') throw new ForbiddenException('Editors can only manage drafts');
    const grants = await manager.query(
      `SELECT 1 FROM user_game_access a JOIN games g ON g.id=a.game_id WHERE a.user_id=$1 AND a.game_id=$2 AND g.status='active' FOR SHARE OF a,g`,
      [req.auth!.user.id, game],
    );
    if (!grants.length) throw new ForbiddenException('Game access required');
    if (id) {
      const records = await manager.query(
        'SELECT status FROM characters WHERE id=$1 AND game_id=$2 FOR UPDATE',
        [id, game],
      );
      if (records[0] && records[0].status !== 'draft')
        throw new ForbiddenException('Editors can only manage drafts');
    }
  }
}
