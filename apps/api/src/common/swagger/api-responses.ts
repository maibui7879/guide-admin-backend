import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiProperty,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

export class PageMetaDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000000, example: 1 }) page!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, example: 20 }) limit!: number;
  @ApiProperty({ type: 'integer', minimum: 0, example: 6 }) total!: number;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 1,
    description: 'Zero when there are no matching records.',
  })
  totalPages!: number;
}
export class ErrorDetailDto {
  @ApiProperty({
    example: 'VALIDATION_ERROR',
    enum: [
      'VALIDATION_ERROR',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
      'INTERNAL_ERROR',
    ],
  })
  code!: string;
  @ApiProperty({ example: 'Invalid request' }) message!: string;
  @ApiProperty({
    example: '8bd1f85e-8515-4e72-b23b-8a80717c0f55',
    description: 'Matches the X-Request-Id response header.',
  })
  requestId!: string;
  @ApiProperty({
    type: [String],
    example: ['limit must not be greater than 100'],
    description: 'Validation messages; empty for other errors.',
  })
  details!: string[];
}
export class ErrorResponseDto {
  @ApiProperty({ type: ErrorDetailDto }) error!: ErrorDetailDto;
}
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' }) status!: 'ok';
}

export const requestIdHeaders = {
  'X-Request-Id': {
    description: 'Caller-provided request ID when valid, otherwise a generated UUID.',
    schema: { type: 'string' as const },
    example: '8bd1f85e-8515-4e72-b23b-8a80717c0f55',
  },
};

export function ApiSuccess(
  type: Type<unknown>,
  description: string,
  examples: Record<string, { summary: string; value: unknown }>,
) {
  return applyDecorators(
    ApiExtraModels(type),
    ApiResponse({
      status: 200,
      description,
      headers: requestIdHeaders,
      content: { 'application/json': { schema: { $ref: getSchemaPath(type) }, examples } },
    }),
  );
}
export function ApiError(
  status: number,
  code: string,
  message: string,
  description: string,
  details: string[] = [],
  extraHeaders: Record<
    string,
    { description: string; schema: { type: 'string' | 'integer'; minimum?: number } }
  > = {},
) {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ApiResponse({
      status,
      description,
      headers: { ...requestIdHeaders, ...extraHeaders },
      content: {
        'application/json': {
          schema: { $ref: getSchemaPath(ErrorResponseDto) },
          example: {
            error: { code, message, requestId: '8bd1f85e-8515-4e72-b23b-8a80717c0f55', details },
          },
        },
      },
    }),
  );
}
export function ApiHttpBoundary() {
  return applyDecorators(
    ApiHeader({
      name: 'X-Request-Id',
      required: false,
      description:
        'Optional tracing ID. Invalid values are replaced; this header is not an authentication token.',
      schema: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$', maxLength: 64 },
      example: 'catalog-request-123',
    }),
    ApiError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      'Malformed JSON, or invalid/unexpected parameters on endpoints with query validation. Query validation failures include field messages in details.',
    ),
    ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request body too large',
      'JSON body exceeds 256 KiB, including a body supplied to a GET request.',
    ),
    ApiError(
      500,
      'INTERNAL_ERROR',
      'Internal server error',
      'Unexpected server or catalog database error. Internal details are not exposed.',
    ),
  );
}
