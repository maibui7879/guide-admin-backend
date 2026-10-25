import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiError,
  ApiHttpBoundary,
  ApiSuccess,
  HealthResponseDto,
} from '../../common/swagger/api-responses';
import { Public } from '../auth/decorators/auth.decorators';

@ApiTags('health')
@Public()
@ApiHttpBoundary()
@Controller('health')
export class HealthController {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  @Get('live')
  @ApiOperation({
    operationId: 'getLiveness',
    summary: 'Check service liveness',
    description:
      'Confirms the HTTP service is running. Does not query PostgreSQL or depend on database readiness.',
  })
  @ApiSuccess(HealthResponseDto, 'Service is alive. This response is not wrapped in data.', {
    healthy: { summary: 'Service is alive', value: { status: 'ok' } },
  })
  live(): HealthResponseDto {
    return { status: 'ok' };
  }
  @Get('ready')
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Check database readiness',
    description:
      'Executes a bounded SELECT 1 query. Returns 503 when PostgreSQL is unavailable; the liveness endpoint can still return 200.',
  })
  @ApiSuccess(
    HealthResponseDto,
    'Database connection is ready. This response is not wrapped in data.',
    { healthy: { summary: 'Database is ready', value: { status: 'ok' } } },
  )
  @ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'Database unavailable',
    'PostgreSQL cannot be reached or its readiness query fails.',
  )
  async ready(): Promise<HealthResponseDto> {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
