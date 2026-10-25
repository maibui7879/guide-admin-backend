import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { ApiError } from '../../../common/swagger/api-responses';
export const csrfHeader = () =>
  applyDecorators(
    ApiHeader({
      name: 'X-CSRF-Token',
      required: true,
      description: 'Synchronizer token from the pre-login challenge or current session response.',
      schema: { type: 'string' },
    }),
    ApiHeader({
      name: 'Origin',
      required: true,
      description:
        'Browser-supplied origin, checked against API_ORIGIN and CORS_ORIGINS. CLI clients must send an allowed origin explicitly.',
      schema: { type: 'string', format: 'uri' },
      example: 'http://localhost:3000',
    }),
  );
export const authFailure = () =>
  ApiError(
    401,
    'UNAUTHENTICATED',
    'Authentication required',
    'Session is missing, expired, revoked, or its user is inactive.',
  );
export const forbidden = () =>
  ApiError(
    403,
    'FORBIDDEN',
    'Invalid CSRF token',
    'CSRF/origin check failed, or the actor lacks permission/resource access.',
  );
