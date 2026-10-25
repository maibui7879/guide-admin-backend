import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CatalogService } from '../services/catalog.service';
import { CharacterQuery, PaginationQuery } from '../dto/query.dto';
import { ApiError, ApiHttpBoundary, ApiSuccess } from '../../../common/swagger/api-responses';
import {
  CharacterResponseDto,
  CharactersPageDto,
  GamesPageDto,
  VersionsPageDto,
} from '../dto/response.dto';
import {
  pageExamples,
  sampleGame,
  sampleCharacter,
  sampleProfile,
} from '../swagger/catalog.examples';
import { Public } from '../../auth/decorators/auth.decorators';

@ApiTags('catalog')
@Public()
@ApiHttpBoundary()
@Controller('api/v1/games')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get()
  @ApiOperation({
    operationId: 'listGames',
    summary: 'List active games',
    description:
      'Sorted by name ascending, then UUID ascending. Returns an empty data array when the requested page is beyond the result set.',
  })
  @ApiSuccess(
    GamesPageDto,
    'Paginated active games. Archived games are excluded.',
    pageExamples(sampleGame),
  )
  games(@Query() q: PaginationQuery): Promise<GamesPageDto> {
    return this.catalog.games(q);
  }

  @Get(':gameSlug/versions')
  @ApiOperation({
    operationId: 'listGameVersions',
    summary: 'List published game patches',
    description:
      'Sorted by release date descending (unknown dates last), then UUID ascending. Patch identifiers are separate from editorial revision numbers. A game with no recorded public patches returns an empty array.',
  })
  @ApiParam({ name: 'gameSlug', example: 'stella-sora', description: 'Slug of an active game.' })
  @ApiSuccess(
    VersionsPageDto,
    'Paginated published patch metadata. Patch examples are illustrative, not seeded game releases.',
    pageExamples({
      id: 'd1980b64-a50e-4cda-8bc7-38f5517b4f42',
      version: 'example-patch',
      releaseDate: null,
    }),
  )
  @ApiError(404, 'NOT_FOUND', 'Game not found', 'The game does not exist or is archived.')
  versions(@Param('gameSlug') game: string, @Query() q: PaginationQuery): Promise<VersionsPageDto> {
    return this.catalog.versions(game, q);
  }

  @Get(':gameSlug/characters')
  @ApiOperation({
    operationId: 'listCharacters',
    summary: 'Search and filter published characters',
    description:
      'Filters combine with AND. q is a case-insensitive literal substring of name or alias; %, _ and backslash are not wildcards. Sorted by name ascending, then UUID ascending. Unmatched filters return an empty array with total=0, totalPages=0. Draft/archived characters are never returned.',
  })
  @ApiParam({ name: 'gameSlug', example: 'stella-sora', description: 'Slug of an active game.' })
  @ApiSuccess(
    CharactersPageDto,
    'Paginated published character summaries. Detail-only fields are excluded.',
    pageExamples(sampleCharacter),
  )
  @ApiError(404, 'NOT_FOUND', 'Game not found', 'The game does not exist or is archived.')
  characters(
    @Param('gameSlug') game: string,
    @Query() q: CharacterQuery,
  ): Promise<CharactersPageDto> {
    return this.catalog.characters(game, q);
  }

  @Get(':gameSlug/characters/:slug')
  @ApiOperation({
    operationId: 'getCharacter',
    summary: 'Get a published character profile',
    description:
      'Includes provenance, versioned mechanics and ordered aliases/stats/skills. Missing combat data is an empty array, not invented values. Names and slugs are scoped to the specified game. This detail endpoint does not inspect query parameters; only collection endpoints validate query fields.',
  })
  @ApiParam({ name: 'gameSlug', example: 'stella-sora', description: 'Slug of an active game.' })
  @ApiParam({
    name: 'slug',
    example: 'allie',
    description: 'Character slug within the specified game.',
  })
  @ApiSuccess(
    CharacterResponseDto,
    'Published profile with source attribution and nullable optional attributes.',
    {
      profile: {
        summary: 'Profile with combat data not yet recorded',
        value: { data: sampleProfile },
      },
    },
  )
  @ApiError(
    404,
    'NOT_FOUND',
    'Character not found',
    'The character/game does not exist, the game is archived, or the character is unpublished/archived. Unknown game responses use message "Game not found".',
  )
  character(
    @Param('gameSlug') game: string,
    @Param('slug') slug: string,
  ): Promise<CharacterResponseDto> {
    return this.catalog.character(game, slug);
  }
}
