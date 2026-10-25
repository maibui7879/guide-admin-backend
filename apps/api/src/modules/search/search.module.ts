import { Controller, Get, Module, Param, Query, Header, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { HttpTelemetry } from '../../common/http/http-telemetry';
import { DataSource } from 'typeorm';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/auth.decorators';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../common/swagger/api-responses';
import { envelope, uuid } from '../strategy/dto/strategy.schemas';
import { SearchQuery } from './search-query.dto';
import { SearchService } from './search.service';
@Controller('api/v1/games/:gameSlug/search')
@ApiTags('search')
@ApiHttpBoundary()
@ApiError(404, 'NOT_FOUND', 'Game not found', 'Game is inactive or unavailable.')
class SearchController {
  constructor(private readonly service: SearchService) {}
  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'searchPublishedGame',
    summary: 'Search published catalogue and editorial content',
    description:
      'PostgreSQL full-text search, simple language configuration, character aliases and phrase syntax. Ranked descending then kind, slug and UUID. Publication joins exclude drafts, archived pages and unavailable dependencies. No Redis cache; correctness follows PostgreSQL publication state.',
  })
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    schema: envelope(
      {
        type: 'object',
        properties: {
          id: uuid,
          slug: { type: 'string' },
          kind: { type: 'string', enum: ['character', 'guide', 'equipment', 'build', 'tier_list'] },
          title: { type: 'string' },
          description: { type: 'string' },
          rank: { type: 'number' },
          apiPath: { type: 'string' },
        },
      },
      true,
    ),
  })
  async search(@Param('gameSlug') game: string, @Query() q: SearchQuery, @Req() req: Request) {
    const result = await this.service.search(game, q);
    (req.app.locals.atlasTelemetry as HttpTelemetry | undefined)?.recordSearch(result.meta.total);
    return result;
  }
}
@Module({})
export class SearchModule {
  static register(db: DataSource) {
    return {
      module: SearchModule,
      controllers: [SearchController],
      providers: [{ provide: DataSource, useValue: db }, SearchService],
    };
  }
}
