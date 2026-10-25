import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';
import { PageMetaDto } from '../../../common/swagger/api-responses';

export class TeamQuery extends PaginationQuery {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter teams containing this character in any role.',
  })
  @IsOptional()
  @IsUUID()
  characterId?: string;
}
export class AdminTeamQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: 'draft' | 'published' | 'archived';
}
export class CreateTeamDto {
  @ApiProperty({ maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', example: 'aqua-core' })
  slug!: string;
  @ApiProperty({ minLength: 1, maxLength: 150 }) name!: string;
  @ApiPropertyOptional({ maxLength: 2000, default: '' }) description?: string;
  @ApiPropertyOptional({
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
    description:
      'Editors can create drafts only. ADMIN can publish when all members are published.',
  })
  status?: string;
  @ApiProperty({ format: 'uuid' }) mainCharacterId!: string;
  @ApiProperty({
    type: 'array',
    minItems: 2,
    maxItems: 2,
    uniqueItems: true,
    items: { type: 'string', format: 'uuid' },
    description:
      'Exactly two distinct supports, different from Main. Sorted canonically by UUID; reversing them does not create another team.',
  })
  supportCharacterIds!: string[];
}
export class ReplaceTeamDto extends CreateTeamDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483646,
    description:
      'Latest admin team version. Stale writes return 409. PUT replaces all fields; omitted description/status reset to defaults.',
  })
  expectedVersion!: number;
}
export class DeleteTeamDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483646,
    description:
      'Latest team version. DELETE archives the record and increments its version; identity and members are retained.',
  })
  expectedVersion!: number;
}
export class TeamMemberDto {
  @ApiProperty({ enum: ['main', 'support'] }) role!: string;
  @ApiProperty({ format: 'uuid' }) characterId!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() element!: string;
  @ApiProperty({ type: 'integer' }) rarity!: number;
  @ApiProperty({ type: String, nullable: true }) portraitUrl!: string | null;
}
export class PublicTeamDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({
    type: [TeamMemberDto],
    minItems: 3,
    maxItems: 3,
    description: 'Main first, followed by the two canonically ordered supports.',
  })
  members!: TeamMemberDto[];
}
export class AdminTeamDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) gameId!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['draft', 'published', 'archived'] }) status!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ format: 'uuid' }) mainCharacterId!: string;
  @ApiProperty({ type: [String], minItems: 2, maxItems: 2 }) supportCharacterIds!: string[];
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}
export class TeamResponseDto {
  @ApiProperty({ type: PublicTeamDto }) data!: PublicTeamDto;
}
export class AdminTeamResponseDto {
  @ApiProperty({ type: AdminTeamDto }) data!: AdminTeamDto;
}
export class TeamsPageDto {
  @ApiProperty({ type: [PublicTeamDto] }) data!: PublicTeamDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class AdminTeamsPageDto {
  @ApiProperty({ type: [AdminTeamDto] }) data!: AdminTeamDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
