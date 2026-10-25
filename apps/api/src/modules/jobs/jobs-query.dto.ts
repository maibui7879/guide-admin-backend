import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
export class JobsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['pending', 'dispatching', 'dispatched', 'completed', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'dispatching', 'dispatched', 'completed', 'failed'])
  state?: string;
}
export class ReviewFlagsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['open', 'resolved'], default: 'open' })
  @IsIn(['open', 'resolved'])
  status = 'open';
}
