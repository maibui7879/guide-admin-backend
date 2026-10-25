import { GUIDE_CATEGORIES, GuideCategory } from '../domain/guide-category';
import type { RichNode } from '../domain/rich-document';
import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/swagger/api-responses';
import { GuideSourceDto, RevisionSummaryDto } from './content-write.dto';
import { WikiIdentityDto } from './wiki.dto';

export class PublicationDto {
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'uuid' }) publishedBy!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: Date;
}
export class ContentHeadDto {
  @ApiProperty({ type: WikiIdentityDto }) wiki!: WikiIdentityDto;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) gameId!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: ['guide'] }) contentType!: string;
  @ApiProperty({ format: 'uuid' }) authorId!: string;
  @ApiProperty({ enum: ['draft', 'in_review', 'approved', 'published', 'archived'] })
  state!: string;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Concurrency token; send as expectedRevision on the next mutation.',
  })
  version!: number;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Latest immutable body snapshot, independent from publication and version.',
  })
  currentRevision!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}
export class ContentMutationDto extends ContentHeadDto {
  @ApiProperty({ type: PublicationDto, nullable: true }) publication!: PublicationDto | null;
}
export class ContentResponseDto {
  @ApiProperty({ type: ContentMutationDto }) data!: ContentMutationDto;
}
export class ContentPageDto {
  @ApiProperty({ type: [ContentHeadDto] }) data!: ContentHeadDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class RevisionDto extends RevisionSummaryDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) body!: RichNode;
  @ApiProperty({ type: [GuideSourceDto] }) sources!: GuideSourceDto[];
}
export class RelationsDto {
  @ApiProperty({ type: [String], format: 'uuid' }) characterIds!: string[];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) gameVersionId!: string | null;
}
export class PreviewDto extends ContentMutationDto {
  @ApiProperty({ type: () => CoverImageDto, nullable: true }) cover!: CoverImageDto | null;
  @ApiProperty({ type: RevisionDto }) revision!: RevisionDto;
  @ApiProperty({ type: RelationsDto }) relations!: RelationsDto;
  @ApiProperty({
    description: 'Safe HTML rendered by the server from the allowlisted editor document.',
  })
  html!: string;
}
export class PreviewResponseDto {
  @ApiProperty({ type: PreviewDto }) data!: PreviewDto;
}
export class RevisionsPageDto {
  @ApiProperty({ type: [RevisionSummaryDto] }) data!: RevisionSummaryDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ type: 'integer' }) version!: number;
  @ApiProperty({ type: 'integer' }) revision!: number;
  @ApiProperty() requestId!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'State transition, review reason or restore source; never credentials or the guide body.',
  })
  details!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] }) data!: AuditEntryDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class GuideSummaryDto {
  @ApiProperty({ type: WikiIdentityDto }) wiki!: WikiIdentityDto;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: GUIDE_CATEGORIES }) category!: GuideCategory;
  @ApiProperty({ type: 'integer', minimum: 1 }) readingMinutes!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: Date;
}
export class GuidePatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) releaseDate!: string | null;
}
export class GuideCharacterDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
}
export class CoverImageDto {
  @ApiProperty({ format: 'uuid' }) mediaId!: string;
  @ApiProperty() url!: string;
  @ApiProperty() alt!: string;
  @ApiProperty() caption!: string;
}
export class GuideDetailDto extends GuideSummaryDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) coverImageId!: string | null;
  @ApiProperty() coverAlt!: string;
  @ApiProperty() coverCaption!: string;
  @ApiProperty({ type: CoverImageDto, nullable: true }) cover!: CoverImageDto | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) revision!: number;
  @ApiProperty({ enum: [1] }) schemaVersion!: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) body!: RichNode;
  @ApiProperty({
    description:
      'Escaped, allowlisted HTML generated by the server. Raw HTML is never accepted as editor input.',
  })
  html!: string;
  @ApiProperty({ type: [GuideSourceDto] }) sources!: GuideSourceDto[];
  @ApiProperty({ type: GuidePatchDto, nullable: true }) gameVersion!: GuidePatchDto | null;
  @ApiProperty({ type: [GuideCharacterDto] }) characters!: GuideCharacterDto[];
}
export class GuideResponseDto {
  @ApiProperty({ type: GuideDetailDto }) data!: GuideDetailDto;
}
export class GuidesPageDto {
  @ApiProperty({ type: [GuideSummaryDto] }) data!: GuideSummaryDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
