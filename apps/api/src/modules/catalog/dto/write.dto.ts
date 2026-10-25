import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TalentWriteDto, PotentialWriteDto } from './progression.dto';

export class CharacterWriteDto {
  @ApiProperty({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 100 }) slug!: string;
  @ApiProperty({ maxLength: 150 }) name!: string;
  @ApiProperty({ type: 'integer', enum: [4, 5] }) rarity!: number;
  @ApiProperty({ enum: ['Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra'] }) element!: string;
  @ApiPropertyOptional({
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
    description: 'Editors may only create/update drafts.',
  })
  status?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  role?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 })
  portraitUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 }) imageUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 }) voice?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uri',
    description: 'HTTPS source URL; required with verifiedAt when published.',
  })
  sourceUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' }) verifiedAt?:
    | string
    | null;
  @ApiPropertyOptional({ enum: [1], default: 1 }) mechanicsSchemaVersion?: number;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: false,
    properties: { attackType: { type: 'string', enum: ['Melee', 'Ranged'] } },
  })
  mechanics?: { attackType?: string };
  @ApiPropertyOptional({ type: [String], maxItems: 30, uniqueItems: true, default: [] })
  aliases?: string[];
  @ApiPropertyOptional({
    type: 'array',
    maxItems: 100,
    default: [],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'value', 'level'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 50 },
        value: { type: 'number', minimum: 0 },
        level: { type: 'integer', minimum: 1, maximum: 1000 },
      },
    },
  })
  stats?: unknown[];
  @ApiPropertyOptional({
    type: 'array',
    maxItems: 30,
    default: [],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'kind', 'description'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 150 },
        kind: { type: 'string', enum: ['normal', 'main', 'support', 'ultimate'] },
        description: { type: 'string', minLength: 1, maxLength: 5000 },
      },
    },
  })
  skills?: unknown[];
  @ApiPropertyOptional({
    type: [TalentWriteDto],
    maxItems: 30,
    description:
      'Omit to preserve existing talents. Send [] to clear; otherwise replaces the entire talent collection.',
  })
  talents?: TalentWriteDto[];
  @ApiPropertyOptional({
    type: [PotentialWriteDto],
    maxItems: 100,
    description:
      'Omit to preserve existing potentials. Send [] to clear; otherwise replaces the entire potential collection. Non-null source IDs must be unique within the character.',
  })
  potentials?: PotentialWriteDto[];
}
export class CreateGameDto {
  @ApiProperty({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 100 }) slug!: string;
  @ApiProperty({ maxLength: 150 }) name!: string;
  @ApiPropertyOptional({ enum: ['active', 'archived'], default: 'active' }) status?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, default: {} })
  metadata?: Record<string, unknown>;
}
export class CreateVersionDto {
  @ApiProperty({ minLength: 1, maxLength: 100 }) version!: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', default: null })
  releaseDate?: string | null;
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'], default: 'draft' })
  status?: string;
}
export class IdResponseDto {
  @ApiProperty({
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  })
  data!: { id: string };
}
