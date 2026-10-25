import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';

export class EquipmentQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['disc', 'weapon', 'armor', 'accessory'] })
  @IsOptional()
  @IsIn(['disc', 'weapon', 'armor', 'accessory'])
  category?: string;
}
export class EquipmentAdminQuery extends EquipmentQuery {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
}
export class StrategyQuery extends PaginationQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() characterId?: string;
}
export class StrategyAdminQuery extends StrategyQuery {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  state?: string;
}
