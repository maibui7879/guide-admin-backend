import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'editor@example.com', format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty({ format: 'password', writeOnly: true, minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
export class PrincipalDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty({ type: [String], example: ['EDITOR'] }) roles!: string[];
  @ApiProperty({ type: [String], example: ['catalog:draft:write', 'content:write'] })
  permissions!: string[];
}
export class SessionDataDto {
  @ApiProperty({ type: PrincipalDto }) user!: PrincipalDto;
  @ApiProperty({
    description:
      'Send this value in X-CSRF-Token on authenticated mutations. Changes after rotation.',
  })
  csrfToken!: string;
  @ApiProperty({ format: 'date-time', type: String }) absoluteExpiresAt!: Date;
  @ApiProperty({ format: 'date-time', type: String }) idleExpiresAt!: Date;
}
export class SessionResponseDto {
  @ApiProperty({ type: SessionDataDto }) data!: SessionDataDto;
}
export class CsrfDataDto {
  @ApiProperty({
    description:
      'Pre-login challenge token. Send in X-CSRF-Token with its accompanying HttpOnly cookie.',
  })
  csrfToken!: string;
}
export class CsrfResponseDto {
  @ApiProperty({ type: CsrfDataDto }) data!: CsrfDataDto;
}
