import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError, ApiHttpBoundary, requestIdHeaders } from '../../../common/swagger/api-responses';
import { RequireAnyPermission } from '../decorators/auth.decorators';
import { authFailure, csrfHeader, forbidden } from '../swagger/auth-api.decorators';
import { CreateUserDto, GameAccessDto, RolesDto, UserResponseDto } from '../dto/users.dto';
import { UsersService } from '../services/users.service';
import { parseInput } from '../../../common/validation/parse-input';

@Controller('api/v1/admin/users')
@ApiTags('admin users')
@ApiHttpBoundary()
@ApiCookieAuth('atlasSession')
@RequireAnyPermission('users:manage')
@authFailure()
@forbidden()
@csrfHeader()
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}
  @Post()
  @ApiBody({ type: CreateUserDto })
  @ApiOperation({
    operationId: 'createStaffUser',
    summary: 'Create a staff account (ADMIN)',
    description:
      'Requires users:manage, an allowed Origin and CSRF token. No public registration route. Passwords require 12â€“128 characters and are stored with Argon2id.',
  })
  @ApiResponse({ status: 201, type: UserResponseDto, headers: requestIdHeaders })
  @ApiError(409, 'CONFLICT', 'User already exists', 'Email is already registered.')
  async create(@Body() body: unknown) {
    return { data: await this.users.create(body) };
  }

  @Put(':userId/roles')
  @HttpCode(204)
  @ApiBody({ type: RolesDto })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({
    operationId: 'replaceStaffRoles',
    summary: 'Replace staff roles (ADMIN)',
    description:
      'Replacement set. Prevents removal of the last active ADMIN and immediately revokes all sessions belonging to the changed user, including the caller if editing themselves.',
  })
  @ApiResponse({ status: 204, headers: requestIdHeaders })
  @ApiError(404, 'NOT_FOUND', 'User not found', 'User does not exist.')
  @ApiError(
    409,
    'CONFLICT',
    'Cannot remove the last active admin',
    'At least one active admin must remain.',
  )
  roles(@Param('userId', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const input = parseInput(
      z
        .object({
          roles: z
            .array(z.enum(['ADMIN', 'EDITOR', 'REVIEWER']))
            .min(1)
            .max(3)
            .refine((v) => new Set(v).size === v.length),
        })
        .strict(),
      body,
    );
    return this.users.roles(id, input.roles);
  }

  @Put(':userId/games')
  @HttpCode(204)
  @ApiBody({ type: GameAccessDto })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({
    operationId: 'replaceStaffGameAccess',
    summary: 'Replace game access grants (ADMIN)',
    description:
      'Editors need a matching grant to modify drafts in a game. Changes apply to the next mutation; no permission/scope claims are trusted from the client.',
  })
  @ApiResponse({ status: 204, headers: requestIdHeaders })
  @ApiError(404, 'NOT_FOUND', 'User not found', 'User does not exist.')
  games(@Param('userId', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const input = parseInput(
      z
        .object({
          gameIds: z
            .array(z.uuid())
            .max(100)
            .refine((v) => new Set(v).size === v.length),
        })
        .strict(),
      body,
    );
    return this.users.games(id, input.gameIds);
  }
}
