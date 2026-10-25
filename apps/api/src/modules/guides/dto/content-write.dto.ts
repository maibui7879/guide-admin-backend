import { GUIDE_CATEGORIES, GuideCategory } from '../domain/guide-category';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { wikiCreateSchema } from './wiki.dto';

export class GuideSourceDto {
  @ApiProperty({
    format: 'uri',
    example: 'https://example.com/source',
    description: 'HTTPS only; no credentials or control characters.',
  })
  url!: string;
  @ApiProperty({ minLength: 1, maxLength: 150 }) label!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, default: null })
  verifiedAt?: string | null;
}
export class RevisionFieldsDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    default: null,
    description: 'Uploaded image in the same game; immutable with this revision.',
  })
  coverImageId?: string | null;
  @ApiPropertyOptional({
    maxLength: 300,
    default: '',
    description: 'Required when coverImageId is set.',
  })
  coverAlt?: string;
  @ApiPropertyOptional({ maxLength: 500, default: '' }) coverCaption?: string;
  @ApiProperty({ minLength: 1, maxLength: 150, example: 'Getting started' }) title!: string;
  @ApiProperty({ minLength: 1, maxLength: 500, example: 'A reviewed introduction to the game.' })
  description!: string;
  @ApiProperty({ enum: GUIDE_CATEGORIES, example: 'beginner' })
  category!: GuideCategory;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Tiptap/ProseMirror v1 subset: paragraphs, headings, lists, blockquotes, code, breaks and image blocks. Image attrs: mediaId (uploaded UUID), alt (required, max 300), caption (max 500). Raw HTML, arbitrary src URLs and inline images are rejected. Maximum depth 12, 2000 nodes, 100000 text characters and 50 referenced images.',
    example: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Guide text.' }] }],
    },
  })
  body!: Record<string, unknown>;
  @ApiPropertyOptional({ enum: [1], default: 1 }) schemaVersion?: number;
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 50,
    uniqueItems: true,
    default: [],
  })
  characterIds?: string[];
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    default: null,
    description:
      'Game patch ID, distinct from editorial revision. Must belong to the content game.',
  })
  gameVersionId?: string | null;
  @ApiPropertyOptional({ type: [GuideSourceDto], maxItems: 20, default: [] })
  sources?: GuideSourceDto[];
}
export class CreateContentDto extends RevisionFieldsDto {
  @ApiProperty(wikiCreateSchema) wiki!: unknown;
  @ApiProperty({ format: 'uuid' }) gameId!: string;
  @ApiProperty({
    maxLength: 100,
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    example: 'getting-started',
  })
  slug!: string;
  @ApiPropertyOptional({ enum: ['guide'], default: 'guide' }) contentType?: string;
}
export class ExpectedRevisionDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483646,
    example: 1,
    description:
      'Use version from the latest admin content response. This concurrency token advances on EVERY mutation, including workflow transitions; it is separate from currentRevision, the immutable body snapshot number. A stale token returns 409.',
  })
  expectedRevision!: number;
}
export class EditContentDto extends RevisionFieldsDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483646,
    description:
      'Current content version, not currentRevision. Full replacement of revision fields; omitted optional fields reset to defaults.',
  })
  expectedRevision!: number;
}
export class RestoreContentDto extends ExpectedRevisionDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description:
      'Existing immutable revision number from this content. Copies its body and relations into a NEW draft; publication stays unchanged until review and publish.',
    maximum: 2147483647,
  })
  sourceRevision!: number;
}
export class ReturnContentDto extends ExpectedRevisionDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 1000,
    description: 'Required review feedback, stored in the audit trail.',
  })
  reason!: string;
}
export class RevisionSummaryDto extends OmitType(RevisionFieldsDto, [
  'body',
  'characterIds',
  'gameVersionId',
  'sources',
] as const) {
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'uuid' }) authorId!: string;
  @ApiProperty({ type: Number, nullable: true }) derivedFrom!: number | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) readingMinutes!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
