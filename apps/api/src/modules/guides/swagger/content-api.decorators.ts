import { applyDecorators, Type } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { requestIdHeaders } from '../../../common/swagger/api-responses';
import { csrfHeader } from '../../auth/swagger/auth-api.decorators';
import { ContentResponseDto } from '../dto/content-response.dto';

export function ApiContentCommand(
  operationId: string,
  type: Type<unknown>,
  summary: string,
  description: string,
) {
  return applyDecorators(
    ApiOperation({ operationId, summary, description }),
    ApiBody({ type }),
    csrfHeader(),
    ApiParam({ name: 'id', format: 'uuid', description: 'Stable content identity.' }),
    ApiResponse({
      status: 200,
      type: ContentResponseDto,
      headers: requestIdHeaders,
      description:
        'Updated content head and current publication pointer. Send data.version as expectedRevision next time.',
    }),
  );
}
