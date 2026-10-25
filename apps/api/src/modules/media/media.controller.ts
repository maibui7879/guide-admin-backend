import { csrfHeader } from '../auth/swagger/auth-api.decorators';
import { MediaUploadResponseDto } from './media.dto';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Param,
  ParseUUIDPipe,
  Req,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, RequireAnyPermission } from '../auth/decorators/auth.decorators';
import type { AuthRequest } from '../auth/services/auth.service';
import { MediaService } from './media.service';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
import { MediaLibraryService } from './media-library.service';
import {
  MediaLibraryQuery,
  MediaLibraryResponseDto,
  MediaUsageResponseDto,
} from './media-library.dto';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../common/swagger/api-responses';

@Controller('api/v1')
@ApiTags('guide media')
@ApiHttpBoundary()
@ApiError(404, 'NOT_FOUND', 'Image not found', 'Image not found')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly library: MediaLibraryService,
  ) {}
  @Get('admin/games/:gameId/media')
  @ApiCookieAuth('atlasSession')
  @RequireAnyPermission('content:write', 'content:review', 'content:publish')
  @ApiOperation({
    operationId: 'listGameMedia',
    summary: 'List game media assets',
    description:
      'Game-scoped staff only. Filter by unused, referenced or deletion_pending. Historical references count as used. Deterministic createdAt descending, UUID ascending pagination. Does not return storage keys or bucket credentials.',
  })
  @ApiResponse({ status: 200, type: MediaLibraryResponseDto, headers: requestIdHeaders })
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'A staff session is required.')
  @ApiError(403, 'FORBIDDEN', 'Game access required', 'Requires game-scoped CMS access.')
  list(
    @Param('gameId', new ParseUUIDPipe()) gameId: string,
    @Query() query: MediaLibraryQuery,
    @Req() req: AuthRequest,
  ) {
    return this.library.list(req.auth!.user, gameId, query);
  }
  @Get('admin/media/:id/usages')
  @ApiCookieAuth('atlasSession')
  @RequireAnyPermission('content:write', 'content:review', 'content:publish')
  @ApiOperation({
    operationId: 'listMediaUsages',
    summary: 'List revision and character references to an image',
    description:
      'Includes current and historical revisions, including archived content. isPublished identifies the publication pointer, not a guarantee that its game/subject is publicly available.',
  })
  @ApiResponse({ status: 200, type: MediaUsageResponseDto, headers: requestIdHeaders })
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'A staff session is required.')
  @ApiError(403, 'FORBIDDEN', 'Game access required', 'Requires game-scoped CMS access.')
  usages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQuery,
    @Req() req: AuthRequest,
  ) {
    return this.library.usages(req.auth!.user, id, query);
  }
  @Delete('admin/media/:id')
  @HttpCode(204)
  @ApiCookieAuth('atlasSession')
  @RequireAnyPermission('content:publish')
  @csrfHeader()
  @ApiOperation({
    operationId: 'deleteUnusedMedia',
    summary: 'Delete an unreferenced image',
    description:
      'Publisher only (ADMIN under current roles). Requires CSRF and game access. Returns 409 if any revision, including archived/historical revisions, uses the image. Commits a deletion tombstone before object removal, blocking new references and private reads. On storage failure returns 503; retry DELETE on the same ID. A completed deletion returns 404 on later requests. No automatic bulk deletion.',
  })
  @ApiResponse({
    status: 204,
    headers: requestIdHeaders,
    description: 'Object and metadata removed; empty body.',
  })
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'A staff session is required.')
  @ApiError(
    403,
    'FORBIDDEN',
    'Publisher access required',
    'Requires publisher access and valid CSRF.',
  )
  @ApiError(
    409,
    'CONFLICT',
    'Image is referenced and cannot be deleted',
    'Historical and cover references prevent deletion.',
  )
  @ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'Image deletion is pending; retry the same DELETE request',
    'Storage failure; metadata is retained for retry.',
  )
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) {
    await this.library.remove(req.auth!.user, id);
  }
  @Post('admin/games/:gameId/media')
  @RequireAnyPermission('content:write')
  @ApiCookieAuth('atlasSession')
  @ApiConsumes('multipart/form-data')
  @csrfHeader()
  @ApiOperation({
    summary: 'Upload a guide image',
    description:
      'Requires session, CSRF header, allowed Origin and game access. PNG/JPEG/WebP up to 5 MiB, at most 16 megapixels. Re-encoded as WebP without source metadata. Not public until referenced by a published revision.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    type: MediaUploadResponseDto,
    headers: requestIdHeaders,
    description: 'Image ID, dimensions, MIME type, byteSize and private previewUrl inside {data}.',
  })
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'Authentication required')
  @ApiError(403, 'FORBIDDEN', 'Game access or CSRF required', 'Game access or CSRF required')
  @ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'Image storage is unavailable',
    'Image storage is unavailable',
  )
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5242880, files: 1, fields: 0 } }))
  upload(
    @Param('gameId', new ParseUUIDPipe()) gameId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() req: AuthRequest,
  ) {
    return this.media.upload(req.auth!.user, gameId, file);
  }
  @Get('admin/media/:id/file')
  @ApiError(401, 'UNAUTHENTICATED', 'Authentication required', 'A staff session is required.')
  @ApiError(403, 'FORBIDDEN', 'Game access required', 'Requires game-scoped CMS access.')
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @RequireAnyPermission('content:write', 'content:review', 'content:publish')
  @ApiCookieAuth('atlasSession')
  @ApiOperation({
    summary: 'Read a private draft image',
    description: 'Authenticated game-scoped read; no-store.',
  })
  async preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    this.send(res, await this.media.file(id, req.auth!.user));
  }
  @Get('media/:id/file')
  @ApiResponse({
    status: 200,
    headers: requestIdHeaders,
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @Public()
  @ApiOperation({
    summary: 'Read an image in a published guide or character',
    description:
      'Returns 404 for unused/draft images, unpublished or archived pages and unavailable wiki targets. Public responses are no-store so unpublishing is effective on the next request.',
  })
  async published(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    this.send(res, await this.media.file(id));
  }
  private send(res: Response, bytes: Buffer) {
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(bytes);
  }
}
