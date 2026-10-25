import { SetMetadata } from '@nestjs/common';
export const Public = () => SetMetadata('auth.public', true);
export const SessionOnly = () => SetMetadata('auth.sessionOnly', true);
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata('auth.permissions', permissions);
