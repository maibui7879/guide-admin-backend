import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
import { PageMetaDto } from '../../common/swagger/api-responses';
import { MediaUploadDataDto } from './media.dto';

export class MediaLibraryQuery extends PaginationQuery {
  @ApiPropertyOptional({
    enum: ['all', 'unused', 'referenced', 'deletion_pending'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'unused', 'referenced', 'deletion_pending'])
  usage: 'all' | 'unused' | 'referenced' | 'deletion_pending' = 'all';
}
export class MediaAssetDto extends MediaUploadDataDto {
  @ApiProperty({ format: 'uuid' }) gameId!: string;
  @ApiProperty({ format: 'uuid' }) uploadedBy!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'SHA-256 of stored WebP; null for legacy uploads.',
  })
  checksum!: string | null;
  @ApiProperty({ enum: ['available', 'deletion_pending'] }) status!: string;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Number of revision and character references; includes historical guide revisions.',
  })
  referenceCount!: number;
}
export class MediaLibraryResponseDto {
  @ApiProperty({ type: [MediaAssetDto] }) data!: MediaAssetDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class MediaUsageDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) contentId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) characterId!: string | null;
  @ApiProperty() slug!: string;
  @ApiProperty() state!: string;
  @ApiProperty({ type: 'integer', nullable: true }) revision!: number | null;
  @ApiProperty() title!: string;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty() isPublished!: boolean;
}
export class MediaUsageResponseDto {
  @ApiProperty({ type: [MediaUsageDto] }) data!: MediaUsageDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
