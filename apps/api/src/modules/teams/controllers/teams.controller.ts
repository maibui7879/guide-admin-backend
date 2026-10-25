import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiError, ApiHttpBoundary, ApiSuccess } from '../../../common/swagger/api-responses';
import { Public } from '../../auth/decorators/auth.decorators';
import { TeamQuery, TeamResponseDto, TeamsPageDto } from '../dto/team.dto';
import { TeamsService } from '../services/teams.service';

@Controller('api/v1/games/:gameSlug/teams')
@ApiTags('teams')
@Public()
@ApiHttpBoundary()
@ApiParam({ name: 'gameSlug', example: 'stella-sora' })
@ApiError(
  404,
  'NOT_FOUND',
  'Team not found',
  'Missing/unpublished team, inactive game or unpublished member. Unknown game collections return Game not found.',
)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}
  @Get()
  @ApiOperation({
    operationId: 'listTeams',
    summary: 'Browse published teams',
    description:
      'Active games and three published members only. Sorted name then UUID ascending; optional characterId matches any slot. Unknown query fields are rejected.',
  })
  @ApiSuccess(TeamsPageDto, 'Published teams with three ordered members.', {
    empty: {
      summary: 'No public teams',
      value: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    },
  })
  list(@Param('gameSlug') game: string, @Query() query: TeamQuery): Promise<TeamsPageDto> {
    return this.teams.list(game, query);
  }
  @Get(':slug')
  @ApiParam({ name: 'slug', example: 'aqua-core' })
  @ApiOperation({
    operationId: 'getTeam',
    summary: 'Read a published team',
    description:
      'Stable Team UUID and current lineup. Drafts/archived records are indistinguishable from missing teams. Preset codes and editorial guides are separate resources.',
  })
  @ApiSuccess(TeamResponseDto, 'Published team detail.', {})
  get(@Param('gameSlug') game: string, @Param('slug') slug: string): Promise<TeamResponseDto> {
    return this.teams.get(game, slug);
  }
}
