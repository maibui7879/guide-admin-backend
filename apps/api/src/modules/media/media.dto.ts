import { ApiProperty } from '@nestjs/swagger';
export class MediaUploadDataDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 8192 }) width!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 8192 }) height!: number;
  @ApiProperty({ enum: ['image/webp'] }) mimeType!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5242880 }) byteSize!: number;
  @ApiProperty({ description: 'Authenticated, game-scoped URL; never a public bucket URL.' })
  previewUrl!: string;
}
export class MediaUploadResponseDto {
  @ApiProperty({ type: MediaUploadDataDto }) data!: MediaUploadDataDto;
}
