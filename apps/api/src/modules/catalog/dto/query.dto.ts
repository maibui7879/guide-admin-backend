import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationQuery } from '../../../common/dto/pagination-query.dto';
export { PaginationQuery } from '../../../common/dto/pagination-query.dto';

export class CharacterQuery extends PaginationQuery {
  @ApiPropertyOptional({
    maxLength: 100,
    example: 'Allie',
    description:
      'Trimmed, case-insensitive literal substring of character name or alias. Empty string applies no search filter.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({
    enum: ['Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra'],
    example: 'Aqua',
    description: 'Exact, case-sensitive element label.',
  })
  @IsOptional()
  @IsIn(['Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra'])
  element?: string;
  @ApiPropertyOptional({
    type: 'integer',
    enum: [4, 5],
    example: 5,
    description: 'Exact star rarity.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([4, 5])
  rarity?: number;
  @ApiPropertyOptional({
    maxLength: 50,
    example: 'Vanguard',
    description:
      'Exact, case-sensitive class label, such as Vanguard or Versatile. Empty string applies no role filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;
}
