import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../../common/swagger/api-responses';
import { RequireAnyPermission } from '../../auth/decorators/auth.decorators';
import { AuthRequest } from '../../auth/services/auth.service';
import { authFailure, csrfHeader, forbidden } from '../../auth/swagger/auth-api.decorators';
import {
  AdminTeamQuery,
  AdminTeamResponseDto,
  AdminTeamsPageDto,
  CreateTeamDto,
  DeleteTeamDto,
  ReplaceTeamDto,
} from '../dto/team.dto';
import { teamReadPermissions, TeamsService } from '../services/teams.service';

@Controller('api/v1/admin/games/:gameId/teams')
@ApiTags('admin teams')
@ApiCookieAuth('atlasSession')
@ApiHttpBoundary()
@authFailure()
@forbidden()
@ApiParam({ name: 'gameId', format: 'uuid' })
@ApiError(404, 'NOT_FOUND', 'Team not found', 'No team with that ID in the specified active game.')
@ApiError(
  409,
  'CONFLICT',
  'Team has changed',
  'Stale expectedVersion, duplicate slug/lineup or already archived. Canonical lineup uniqueness includes archived records; restore the existing team instead of duplicating it.',
)
export class AdminTeamsController {
  constructor(private readonly teams: TeamsService) {}
  @Get()
  @RequireAnyPermission(...teamReadPermissions)
  @ApiOperation({
    operationId: 'listAdminTeams',
    summary: 'List teams including drafts and archives',
    description:
      'Game-scoped staff only. Optional status filter; deterministic name/UUID pagination. ADMIN has global game scope.',
  })
  @ApiResponse({ status: 200, type: AdminTeamsPageDto, headers: requestIdHeaders })
  list(
    @Param('gameId', ParseUUIDPipe) game: string,
    @Query() query: AdminTeamQuery,
    @Req() req: AuthRequest,
  ): Promise<AdminTeamsPageDto> {
    return this.teams.adminList(req.auth!.user, game, query);
  }
  @Get(':id')
  @RequireAnyPermission(...teamReadPermissions)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'getAdminTeam',
    summary: 'Read a team and its version',
    description:
      'Includes draft/archived status and the concurrency token. Staff game grants are checked on every request.',
  })
  @ApiResponse({ status: 200, type: AdminTeamResponseDto, headers: requestIdHeaders })
  get(
    @Param('gameId', ParseUUIDPipe) game: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<AdminTeamResponseDto> {
    return this.teams.adminGet(req.auth!.user, game, id);
  }
  @Post()
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @csrfHeader()
  @ApiBody({ type: CreateTeamDto })
  @ApiOperation({
    operationId: 'createTeam',
    summary: 'Create a team with one Main and two Supports',
    description:
      'Distinct characters from the same active game. EDITOR requires game access and draft status; ADMIN can publish. The same Main/support pair cannot be registered twice, regardless of support order.',
  })
  @ApiResponse({ status: 201, type: AdminTeamResponseDto, headers: requestIdHeaders })
  create(
    @Param('gameId', ParseUUIDPipe) game: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<AdminTeamResponseDto> {
    return this.teams.create(req.auth!.user, game, body);
  }
  @Put(':id')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @csrfHeader()
  @ApiBody({ type: ReplaceTeamDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'replaceTeam',
    summary: 'Replace team fields using optimistic concurrency',
    description:
      'Full replacement; expectedVersion is required. UUID/game stay stable. Editors can update existing drafts only; ADMIN can publish or restore an archived team. Publication requires three published members. This catalog operation is separate from guide revision/review workflow.',
  })
  @ApiResponse({ status: 200, type: AdminTeamResponseDto, headers: requestIdHeaders })
  replace(
    @Param('gameId', ParseUUIDPipe) game: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<AdminTeamResponseDto> {
    return this.teams.replace(req.auth!.user, game, id, body);
  }
  @Delete(':id')
  @RequireAnyPermission('catalog:write', 'catalog:draft:write')
  @csrfHeader()
  @ApiBody({ type: DeleteTeamDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'archiveTeam',
    summary: 'Delete a team by archiving its stable identity',
    description:
      'Send JSON expectedVersion with CSRF/Origin. Returns archived team with incremented version, never physically deletes it. Public reads become 404. Editors may archive drafts in assigned games only; ADMIN can archive published teams.',
  })
  @ApiResponse({ status: 200, type: AdminTeamResponseDto, headers: requestIdHeaders })
  remove(
    @Param('gameId', ParseUUIDPipe) game: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<AdminTeamResponseDto> {
    return this.teams.remove(req.auth!.user, game, id, body);
  }
}
