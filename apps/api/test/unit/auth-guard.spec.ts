import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../../src/modules/auth/guards/auth.guard';
import { Public, RequireAnyPermission } from '../../src/modules/auth/decorators/auth.decorators';
import { AuthService } from '../../src/modules/auth/services/auth.service';

@Public()
class PublicReads {
  read() {}
  write() {}
}
class Private {
  unconfigured() {}
  @RequireAnyPermission('users:manage') manage() {}
}
describe('default-deny authorization guard', () => {
  const authenticate = jest.fn();
  const checkCsrf = jest.fn();
  const guard = new AuthGuard(new Reflector(), {
    authenticate,
    checkCsrf,
  } as unknown as AuthService);
  function context(
    controller: typeof PublicReads | typeof Private,
    handler: () => void,
    method: string,
  ): ExecutionContext {
    const req = { method };
    return {
      getClass: () => controller,
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    authenticate.mockResolvedValue({ user: { permissions: [] } });
    checkCsrf.mockImplementation(() => {});
  });
  it('allows public reads without a session lookup', async () => {
    await expect(
      guard.canActivate(context(PublicReads, PublicReads.prototype.read, 'GET')),
    ).resolves.toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('does not inherit public access for a mutation added to a public-read controller', async () => {
    await expect(
      guard.canActivate(context(PublicReads, PublicReads.prototype.write, 'POST')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authenticate).toHaveBeenCalled();
    expect(checkCsrf).toHaveBeenCalled();
  });
  it('denies authenticated handlers with no explicit policy and enforces declared permissions', async () => {
    await expect(
      guard.canActivate(context(Private, Private.prototype.unconfigured, 'GET')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(context(Private, Private.prototype.manage, 'POST')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    authenticate.mockResolvedValueOnce({ user: { permissions: ['users:manage'] } });
    await expect(
      guard.canActivate(context(Private, Private.prototype.manage, 'POST')),
    ).resolves.toBe(true);
  });
});
