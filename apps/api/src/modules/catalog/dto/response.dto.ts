import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/swagger/api-responses';
import { TalentDto, PotentialDto } from './progression.dto';

export class GameSummaryDto {
  @ApiProperty({ format: 'uuid', example: '19b0a236-8f5a-423e-8d45-a8279db3ed85' }) id!: string;
  @ApiProperty({ example: 'stella-sora' }) slug!: string;
  @ApiProperty({ example: 'Stella Sora' }) name!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {},
    description: 'Public game metadata; game-specific keys.',
  })
  metadata!: Record<string, unknown>;
}
export class GameVersionDto {
  @ApiProperty({ format: 'uuid', example: 'd1980b64-a50e-4cda-8bc7-38f5517b4f42' }) id!: string;
  @ApiProperty({
    example: '1.0',
    description:
      'Game patch identifier, separate from editorial revisions. Illustrative value only.',
  })
  version!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true, example: null }) releaseDate!:
    | string
    | null;
}
export class CharacterSummaryDto {
  @ApiProperty({ format: 'uuid', example: '03d6b90a-69ca-43bb-80a4-5dbff11b8e78' }) id!: string;
  @ApiProperty({ example: 'allie' }) slug!: string;
  @ApiProperty({ example: 'Allie' }) name!: string;
  @ApiProperty({ enum: ['Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra'], example: 'Aqua' })
  element!: string;
  @ApiProperty({ type: 'integer', enum: [4, 5], example: 5 }) rarity!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Vanguard',
    description: 'Recorded character class; null when unavailable.',
  })
  role!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '/assets/allie-portrait.webp',
    description: 'Root-relative asset path or HTTPS URL.',
  })
  portraitUrl!: string | null;
}
export class MechanicsV1Dto {
  @ApiPropertyOptional({ enum: ['Melee', 'Ranged'], example: 'Melee' }) attackType?:
    | 'Melee'
    | 'Ranged';
}
export class CharacterStatDto {
  @ApiProperty({
    example: 'ATK',
    description: 'Stat code. Examples illustrate schema, not verified combat values.',
  })
  code!: string;
  @ApiProperty({ minimum: 0, example: 100 }) value!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000, example: 1 }) level!: number;
  @ApiProperty({ type: 'integer', minimum: 0, example: 0 }) position!: number;
}
export class SkillDto {
  @ApiProperty({
    example: 'Example skill',
    description: 'Illustrative name only; no fabricated skill data is seeded.',
  })
  name!: string;
  @ApiProperty({ enum: ['normal', 'main', 'support', 'ultimate'], example: 'normal' })
  kind!: string;
  @ApiProperty({ example: 'Recorded skill description.' }) description!: string;
  @ApiProperty({ type: 'integer', minimum: 0, example: 0 }) position!: number;
}
export class SourceDto {
  @ApiProperty({ format: 'uri', example: 'https://www.kaiden.gg/stella-sora/characters/allie/' })
  url!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-24T00:00:00.000Z',
    description: 'UTC verification timestamp; fixture midnight represents the review date.',
  })
  verifiedAt!: Date | null;
}
export class CharacterDetailDto extends CharacterSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: '/assets/allie.webp' }) imageUrl!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true, example: null }) voice!: string | null;
  @ApiProperty({ type: 'integer', enum: [1], example: 1 }) mechanicsSchemaVersion!: number;
  @ApiProperty({ type: MechanicsV1Dto }) mechanics!: MechanicsV1Dto;
  @ApiProperty({ type: [String], example: [], description: 'Aliases in editorial position order.' })
  aliases!: string[];
  @ApiProperty({
    type: [CharacterStatDto],
    example: [],
    description: 'Ordered stats. Empty means not recorded, not zero-valued.',
  })
  stats!: CharacterStatDto[];
  @ApiProperty({
    type: [SkillDto],
    example: [],
    description: 'Skills in editorial position order. Empty means not recorded.',
  })
  skills!: SkillDto[];
  @ApiProperty({
    type: [TalentDto],
    description: 'Ordered talent groups and their boosts. Empty means not recorded.',
  })
  talents!: TalentDto[];
  @ApiProperty({
    type: [PotentialDto],
    description:
      'Ordered potentials retaining their five source categories and parameter progressions. Empty means not recorded.',
  })
  potentials!: PotentialDto[];
  @ApiProperty({ type: [SourceDto] }) sources!: SourceDto[];
}
export class GamesPageDto {
  @ApiProperty({ type: [GameSummaryDto] }) data!: GameSummaryDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class VersionsPageDto {
  @ApiProperty({ type: [GameVersionDto] }) data!: GameVersionDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class CharactersPageDto {
  @ApiProperty({ type: [CharacterSummaryDto] }) data!: CharacterSummaryDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class CharacterResponseDto {
  @ApiProperty({ type: CharacterDetailDto }) data!: CharacterDetailDto;
}
