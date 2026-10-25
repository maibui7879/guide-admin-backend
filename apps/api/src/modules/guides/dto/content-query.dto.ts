import { GUIDE_CATEGORIES, GuideCategory } from '../domain/guide-category';
import type { ContentState } from '../entities/content.entities';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';

export class GuidesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: GUIDE_CATEGORIES, example: 'beginner' })
  @IsOptional()
  @IsIn(GUIDE_CATEGORIES)
  category?: GuideCategory;
}
export class AdminContentsQuery extends PaginationQuery {
  @ApiProperty({
    format: 'uuid',
    description: 'Required game scope. Editors and reviewers need a game grant.',
  })
  @IsUUID()
  gameId!: string;
  @ApiPropertyOptional({ enum: ['draft', 'in_review', 'approved', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'in_review', 'approved', 'published', 'archived'])
  state?: ContentState;
}
