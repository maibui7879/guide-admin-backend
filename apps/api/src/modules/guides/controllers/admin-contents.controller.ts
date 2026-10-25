import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';
import { AdminContentsQuery } from '../dto/content-query.dto';
import {
  AuditPageDto,
  ContentPageDto,
  ContentResponseDto,
  PreviewResponseDto,
  RevisionsPageDto,
} from '../dto/content-response.dto';
import {
  CreateContentDto,
  EditContentDto,
  ExpectedRevisionDto,
  RestoreContentDto,
  ReturnContentDto,
} from '../dto/content-write.dto';
import { ContentReaderService } from '../services/content-reader.service';
import { ContentWriterService } from '../services/content-writer.service';
import { ApiContentCommand } from '../swagger/content-api.decorators';

type StaffRequest = AuthRequest & { requestId: string };
const readPermissions = ['content:write', 'content:review', 'content:publish'];

@Controller('api/v1/admin/contents')
@ApiTags('admin contents')
@ApiCookieAuth('atlasSession')
@ApiHttpBoundary()
@authFailure()
@forbidden()
@ApiError(404, 'NOT_FOUND', 'Content not found', 'Content, revision or active game is unavailable.')
@ApiError(
  409,
  'CONFLICT',
  'Content has changed',
  'Stale expectedRevision, duplicate slug/wiki identity or invalid workflow transition. Wiki identity is reserved in every state, including archived. Refetch the head; never silently retry a stale write.',
)
export class AdminContentsController {
  constructor(
    private readonly reader: ContentReaderService,
    private readonly writer: ContentWriterService,
  ) {}

  @Get()
  @RequireAnyPermission(...readPermissions)
  @ApiOperation({
    operationId: 'listAdminContents',
    summary: 'List content heads in an authorized game',
    description:
      'Draft/review queue sorted by updatedAt descending then UUID ascending. Required gameId is resource-authorized, even when no records match. State describes the working copy; an older publication can coexist.',
  })
  @ApiResponse({ status: 200, type: ContentPageDto, headers: requestIdHeaders })
  contents(@Query() query: AdminContentsQuery, @Req() req: StaffRequest): Promise<ContentPageDto> {
    return this.reader.contents(req.auth!.user, query);
  }

  @Post()
  @RequireAnyPermission('content:write')
  @csrfHeader()
  @ApiOperation({
    operationId: 'createContent',
    summary: 'Create a guide and its first draft',
    description:
      'ADMIN or game-scoped EDITOR. Requires an immutable wiki subject and controlled topic. A second page for the same game/subject/topic returns 409 even with a different slug or author, including archived pages. Use revisions of the existing page. Slug is also unique within a game. No public content is created until review, approval and publication. Body and contextual relations are immutable snapshots.',
  })
  @ApiBody({ type: CreateContentDto })
  @ApiResponse({ status: 201, type: ContentResponseDto, headers: requestIdHeaders })
  async create(@Body() body: unknown, @Req() req: StaffRequest): Promise<ContentResponseDto> {
    return { data: await this.writer.create(req.auth!.user, body, req.requestId) };
  }

  @Patch(':id/draft')
  @RequireAnyPermission('content:write')
  @ApiContentCommand(
    'editContentDraft',
    EditContentDto,
    'Replace the draft with a new revision',
    'Allowed from draft or published. Creates an immutable snapshot with a new revision number; the current publication remains visible. All revision fields are replaced, including sources and relations. Editing approved/in-review content requires return-to-draft first.',
  )
  async edit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.edit(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/submit-review')
  @HttpCode(200)
  @RequireAnyPermission('content:write')
  @ApiContentCommand(
    'submitContentReview',
    ExpectedRevisionDto,
    'Submit the exact draft for review',
    'draft Ã¢â€ â€™ in_review. Requires nonempty guide text. The body is frozen while in review; the concurrency token advances.',
  )
  async submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.submit(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequireAnyPermission('content:review')
  @ApiContentCommand(
    'approveContent',
    ExpectedRevisionDto,
    'Approve the submitted revision',
    'in_review Ã¢â€ â€™ approved. ADMIN or scoped REVIEWER. The latest revision author cannot approve their own work, including admins. A later edit requires another review.',
  )
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.approve(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/return-to-draft')
  @HttpCode(200)
  @RequireAnyPermission('content:review')
  @ApiContentCommand(
    'returnContentToDraft',
    ReturnContentDto,
    'Return reviewed content with feedback',
    'in_review/approved Ã¢â€ â€™ draft. Requires a reason in the audit trail. The existing published revision stays visible.',
  )
  async returnToDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.returnToDraft(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireAnyPermission('content:publish')
  @ApiContentCommand(
    'publishContent',
    ExpectedRevisionDto,
    'Publish the approved revision',
    'approved Ã¢â€ â€™ published. ADMIN only under initial roles. Verifies linked characters/patch are published in the same game. Publication pointer, version and audit record commit atomically.',
  )
  async publish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.publish(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequireAnyPermission('content:publish')
  @ApiContentCommand(
    'unpublishContent',
    ExpectedRevisionDto,
    'Remove the public publication',
    'ADMIN. Public reads immediately become 404. Preserves all revisions and any newer working draft/review; a published head returns to draft. Requires an existing publication.',
  )
  async unpublish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.unpublish(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequireAnyPermission('content:publish')
  @ApiContentCommand(
    'archiveContent',
    ExpectedRevisionDto,
    'Archive a guide and remove its publication',
    'ADMIN. Terminal archived state, preserving history and audit. Archived content cannot be edited, restored, reviewed or published.',
  )
  async archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.archive(req.auth!.user, id, body, req.requestId) };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequireAnyPermission('content:write')
  @ApiContentCommand(
    'restoreContentRevision',
    RestoreContentDto,
    'Copy a historical revision into a new draft',
    'Allowed from draft or published. Copies body, sources and relations from an existing revision in this content. Never rewinds/deletes history or publishes without a new review. derivedFrom records the source.',
  )
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: StaffRequest,
  ): Promise<ContentResponseDto> {
    return { data: await this.writer.restore(req.auth!.user, id, body, req.requestId) };
  }

  @Get(':id/preview')
  @RequireAnyPermission(...readPermissions)
  @ApiOperation({
    operationId: 'previewContent',
    summary: 'Preview the latest revision as authorized staff',
    description:
      'Authenticated JSON preview with safe server-rendered HTML. no-store and X-Robots-Tag: noindex, nofollow. Never available through a public slug or share token.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    type: PreviewResponseDto,
    headers: {
      ...requestIdHeaders,
      'X-Robots-Tag': { schema: { type: 'string', enum: ['noindex, nofollow'] } },
    },
  })
  preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: StaffRequest,
  ): Promise<PreviewResponseDto> {
    return this.reader.preview(req.auth!.user, id);
  }

  @Get(':id/revisions')
  @RequireAnyPermission(...readPermissions)
  @ApiOperation({
    operationId: 'listContentRevisions',
    summary: 'List immutable revision metadata',
    description:
      'Newest revision first. Bodies are omitted from the paginated list; use the authenticated revision detail endpoint.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: RevisionsPageDto, headers: requestIdHeaders })
  revisions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQuery,
    @Req() req: StaffRequest,
  ): Promise<RevisionsPageDto> {
    return this.reader.revisions(req.auth!.user, id, query);
  }

  @Get(':id/revisions/:revision')
  @RequireAnyPermission(...readPermissions)
  @ApiOperation({
    operationId: 'getContentRevision',
    summary: 'Preview a historical revision',
    description:
      'Authorized staff only. Immutable historical body, sources and relations; current head/version and publication are also included. No public historical revision API.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'revision', schema: { type: 'integer', minimum: 1, maximum: 2147483647 } })
  @ApiResponse({ status: 200, type: PreviewResponseDto, headers: requestIdHeaders })
  revision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('revision', ParseIntPipe) revision: number,
    @Req() req: StaffRequest,
  ): Promise<PreviewResponseDto> {
    return this.reader.preview(req.auth!.user, id, revision);
  }

  @Get(':id/audit')
  @RequireAnyPermission(...readPermissions)
  @ApiOperation({
    operationId: 'listContentAudit',
    summary: 'Read the content audit trail',
    description:
      'Game-scoped staff only. Newest version first, including state changes, review feedback, actor and request ID. Audit records contain no guide body or credentials.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AuditPageDto, headers: requestIdHeaders })
  audit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQuery,
    @Req() req: StaffRequest,
  ): Promise<AuditPageDto> {
    return this.reader.audit(req.auth!.user, id, query);
  }
}
