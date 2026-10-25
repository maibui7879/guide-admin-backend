import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { potentialCategories } from '../domain/progression-input';

const parameters = {
  type: 'array' as const,
  maxItems: 100,
  items: { oneOf: [{ type: 'string', maxLength: 10000 }, { type: 'number' }] },
  description:
    'Source parameter values; slash-separated progressions remain strings. No skill level is assumed.',
};
export class TalentBoostDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150, default: null }) name?:
    | string
    | null;
  @ApiProperty({ maxLength: 20000 }) description!: string;
  @ApiPropertyOptional({ ...parameters, default: [] }) params?: (string | number)[];
  @ApiPropertyOptional({ ...parameters, default: [] }) hiddenParams?: (string | number)[];
}
export class TalentWriteDto {
  @ApiProperty({ maxLength: 150 }) name!: string;
  @ApiProperty({
    type: [TalentBoostDto],
    minItems: 1,
    maxItems: 100,
    description: 'Boosts in source/editorial order; includes the named effect and stat boosts.',
  })
  boosts!: TalentBoostDto[];
}
export class PotentialWriteDto {
  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 2147483647,
    default: null,
    description: 'Upstream potential ID, unique within the character; not a database UUID.',
  })
  sourceId?: number | null;
  @ApiProperty({ enum: potentialCategories }) category!: string;
  @ApiProperty({ maxLength: 150 }) name!: string;
  @ApiProperty({ maxLength: 20000 }) description!: string;
  @ApiPropertyOptional({ ...parameters, default: [] }) params?: (string | number)[];
  @ApiPropertyOptional({ ...parameters, default: [] }) hiddenParams?: (string | number)[];
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 150,
    default: null,
    description: 'Source icon identifier, not an asset URL.',
  })
  icon?: string | null;
  @ApiPropertyOptional({ enum: ['core', 'common', 'rare'], nullable: true, default: null })
  rarity?: string | null;
  @ApiPropertyOptional({ enum: ['Diamond', 'Triangle', 'Round'], nullable: true, default: null })
  corner?: string | null;
}
export class TalentBoostResponseDto {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty(parameters) params!: (string | number)[];
  @ApiProperty(parameters) hiddenParams!: (string | number)[];
}
export class TalentDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: [TalentBoostResponseDto] }) boosts!: TalentBoostResponseDto[];
  @ApiProperty({ type: 'integer', minimum: 0 }) position!: number;
}
export class PotentialDto {
  @ApiProperty({ type: 'integer', nullable: true }) sourceId!: number | null;
  @ApiProperty({ enum: potentialCategories }) category!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty(parameters) params!: (string | number)[];
  @ApiProperty(parameters) hiddenParams!: (string | number)[];
  @ApiProperty({ type: String, nullable: true, description: 'Source icon identifier, not a URL.' })
  icon!: string | null;
  @ApiProperty({ type: String, enum: ['core', 'common', 'rare'], nullable: true }) rarity!:
    | string
    | null;
  @ApiProperty({ type: String, enum: ['Diamond', 'Triangle', 'Round'], nullable: true }) corner!:
    | string
    | null;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Global order within this character�s potential collection.',
  })
  position!: number;
}
