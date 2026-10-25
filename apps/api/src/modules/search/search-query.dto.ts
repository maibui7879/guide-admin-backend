import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
export class SearchQuery extends PaginationQuery {
  @ApiProperty({
    minLength: 2,
    maxLength: 100,
    description:
      'Plain terms or web-search phrase syntax; all terms must match. PostgreSQL simple configuration supports names without English stemming.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  q!: string;
  @ApiPropertyOptional({
    enum: ['all', 'character', 'guide', 'equipment', 'build', 'tier_list'],
    default: 'all',
  })
  @IsIn(['all', 'character', 'guide', 'equipment', 'build', 'tier_list'])
  kind = 'all';
}
