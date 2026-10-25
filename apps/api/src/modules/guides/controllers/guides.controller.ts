import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiError, ApiHttpBoundary, ApiSuccess } from '../../../common/swagger/api-responses';
import { Public } from '../../auth/decorators/auth.decorators';
import { GuidesQuery } from '../dto/content-query.dto';
import { GuideResponseDto, GuidesPageDto } from '../dto/content-response.dto';
import { ContentReaderService } from '../services/content-reader.service';

@Controller('api/v1/games/:gameSlug/guides')
@ApiTags('guides')
@Public()
@ApiHttpBoundary()
@ApiParam({ name: 'gameSlug', example: 'stella-sora' })
@ApiError(
  404,
  'NOT_FOUND',
  'Guide not found',
  'Guide has no publication, is archived, or its game is unavailable. An unpublished guide is indistinguishable from a missing guide.',
)
export class GuidesController {
  constructor(private readonly reader: ContentReaderService) {}

  @Get()
  @ApiOperation({
    operationId: 'listPublishedGuides',
    summary: 'Browse published guides',
    description:
      'Reads the publication snapshot, even when a newer draft/review exists. Active games only. Optional category filter, deterministic publishedAt descending then UUID ascending. Unknown query fields, including status/revision, return 400.',
  })
  @ApiSuccess(GuidesPageDto, 'Published guide summaries. Empty pages are valid.', {
    empty: {
      summary: 'No published guides',
      value: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    },
  })
  guides(@Param('gameSlug') game: string, @Query() query: GuidesQuery): Promise<GuidesPageDto> {
    return this.reader.guides(game, query);
  }

  @Get(':slug')
  @ApiParam({ name: 'slug', example: 'getting-started' })
  @ApiOperation({
    operationId: 'getPublishedGuide',
    summary: 'Read the current published guide revision',
    description:
      'Only the publication pointer is used. Query parameters cannot select another revision, expose a draft or preview content. Returns validated editor JSON, safe HTML and public character/patch references. No staff identity, review feedback or draft metadata is exposed.',
  })
  @ApiSuccess(
    GuideResponseDto,
    'Current publication; missing patch is null and missing sources/characters are empty arrays.',
    {
      guide: {
        summary: 'Illustrative published guide, not seeded editorial advice',
        value: {
          data: {
            id: 'aa2d1a0f-d281-46d6-9865-41f5affc109c',
            slug: 'getting-started',
            title: 'Getting started',
            description: 'An editorial introduction.',
            category: 'beginner',
            readingMinutes: 1,
            publishedAt: '2026-10-24T00:00:00.000Z',
            revision: 1,
            schemaVersion: 1,
            body: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Guide text.' }] }],
            },
            html: '<p>Guide text.</p>',
            sources: [],
            gameVersion: null,
            characters: [],
          },
        },
      },
    },
  )
  guide(@Param('gameSlug') game: string, @Param('slug') slug: string): Promise<GuideResponseDto> {
    return this.reader.guide(game, slug);
  }
}
