import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import {
  ApiError,
  ApiHttpBoundary,
  ApiSuccess,
  requestIdHeaders,
} from '../../../common/swagger/api-responses';
import { AuthRequest, AuthService } from '../services/auth.service';
import { Public, SessionOnly } from '../decorators/auth.decorators';
import { CsrfResponseDto, LoginDto, SessionResponseDto } from '../dto/auth.dto';

import { csrfHeader, authFailure, forbidden } from '../swagger/auth-api.decorators';

@ApiTags('admin auth')
@ApiHttpBoundary()
@Controller('api/v1/admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get('csrf')
  @Public()
  @ApiOperation({
    operationId: 'getLoginCsrf',
    summary: 'Get a login CSRF challenge',
    description:
      'Returns a 10-minute pre-login token and sets an HttpOnly challenge cookie. Keep credentials included on subsequent login. All auth responses are no-store.',
  })
  @ApiSuccess(CsrfResponseDto, 'Login challenge with HttpOnly cookie.', {
    challenge: {
      summary: 'Illustrative token only',
      value: { data: { csrfToken: 'example-challenge-token' } },
    },
  })
  @forbidden()
  challenge(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.challenge(req, res);
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    operationId: 'loginAdmin',
    summary: 'Log in a staff member',
    description:
      'Requires JSON, an allowed Origin header, the challenge cookie and its X-CSRF-Token. Creates a fresh session; a previous supplied session is revoked. SameSite=Strict, HttpOnly, host-only cookie; Secure in production. Passwords/tokens are not logged. Account and IP rate limits are shared through PostgreSQL.',
  })
  @ApiBody({ type: LoginDto })
  @csrfHeader()
  @ApiResponse({
    status: 200,
    type: SessionResponseDto,
    description:
      'Sets atlas_session cookie and clears the challenge cookie. Returns a session-bound CSRF token.',
    headers: {
      ...requestIdHeaders,
      'Set-Cookie': {
        description: 'HttpOnly session cookie; never accessible through JavaScript.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiError(
    401,
    'UNAUTHENTICATED',
    'Invalid email or password',
    'Identical response for an unknown account, bad password, inactive account or account without a staff role.',
  )
  @forbidden()
  @ApiError(
    429,
    'RATE_LIMITED',
    'Too many login attempts',
    'Login limit exceeded. Retry-After contains seconds until the fixed window resets.',
    [],
    {
      'Retry-After': {
        description: 'Seconds until the fixed login window resets.',
        schema: { type: 'integer', minimum: 1 },
      },
    },
  )
  login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body.email, body.password, req, res);
  }

  @Get('session')
  @SessionOnly()
  @ApiCookieAuth('atlasSession')
  @ApiOperation({
    operationId: 'getAdminSession',
    summary: 'Get the current staff identity',
    description:
      'Loads fresh roles/permissions from the database and extends idle expiry within the absolute lifetime. Returns the current CSRF token. Session IDs/password hashes are never exposed.',
  })
  @ApiResponse({ status: 200, type: SessionResponseDto, headers: requestIdHeaders })
  @authFailure()
  session(@Req() req: AuthRequest) {
    return this.auth.view(req.auth!);
  }

  @Post('rotate')
  @HttpCode(200)
  @SessionOnly()
  @ApiCookieAuth('atlasSession')
  @csrfHeader()
  @ApiOperation({
    operationId: 'rotateAdminSession',
    summary: 'Rotate the current session token',
    description:
      'Requires allowed Origin and current CSRF token. Replaces the token atomically, invalidating the old cookie immediately. Absolute lifetime is not extended. Serialize rotations in the client and use the returned CSRF token afterwards.',
  })
  @ApiResponse({
    status: 200,
    type: SessionResponseDto,
    headers: { ...requestIdHeaders, 'Set-Cookie': { schema: { type: 'string' } } },
  })
  @authFailure()
  @forbidden()
  rotate(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.rotate(req.auth!, res);
  }

  @Post('logout')
  @HttpCode(204)
  @SessionOnly()
  @ApiCookieAuth('atlasSession')
  @csrfHeader()
  @ApiOperation({
    operationId: 'logoutAdmin',
    summary: 'Revoke the current session',
    description:
      'Requires allowed Origin and current CSRF token. Revokes the database session and expires its cookie.',
  })
  @ApiResponse({
    status: 204,
    description: 'Session revoked; empty response body.',
    headers: requestIdHeaders,
  })
  @authFailure()
  @forbidden()
  logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req.auth!, res);
  }
}
