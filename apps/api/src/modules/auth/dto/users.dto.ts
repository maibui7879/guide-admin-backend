import { ApiProperty } from '@nestjs/swagger';
export class CreateUserDto {
  @ApiProperty({ format: 'email', maxLength: 254 }) email!: string;
  @ApiProperty({ format: 'password', writeOnly: true, minLength: 12, maxLength: 128 })
  password!: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'string', enum: ['ADMIN', 'EDITOR', 'REVIEWER'] },
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  })
  roles!: string[];
}
export class UserResponseDto {
  @ApiProperty({
    type: 'object',
    required: ['id', 'email', 'roles'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      roles: { type: 'array', items: { type: 'string' } },
    },
  })
  data!: { id: string; email: string; roles: string[] };
}
export class RolesDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', enum: ['ADMIN', 'EDITOR', 'REVIEWER'] },
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  })
  roles!: string[];
}
export class GameAccessDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    maxItems: 100,
    uniqueItems: true,
    description: 'Replacement set of game IDs. Empty array removes all game grants.',
  })
  gameIds!: string[];
}
