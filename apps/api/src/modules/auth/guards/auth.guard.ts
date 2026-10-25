import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRequest, AuthService } from '../services/auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const explicitPublic = this.reflector.get<boolean>('auth.public', context.getHandler());
    const publicRead =
      this.reflector.get<boolean>('auth.public', context.getClass()) &&
      ['GET', 'HEAD', 'OPTIONS'].includes(context.switchToHttp().getRequest<AuthRequest>().method);
    if (explicitPublic || publicRead) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const identity = await this.auth.authenticate(req);
    req.auth = identity;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) this.auth.checkCsrf(req, identity);
    const permissions = this.reflector.getAllAndOverride<string[]>('auth.permissions', targets);
    const sessionOnly = this.reflector.getAllAndOverride<boolean>('auth.sessionOnly', targets);
    if (
      !sessionOnly &&
      (!permissions?.length || !permissions.some((p) => identity.user.permissions.includes(p)))
    )
      throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
