import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Request, Response } from 'express';
import type { Environment } from '../../../config/env';
import { dummyPasswordHash, verifyPassword } from '../security/password';

export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');
export type AuthSettings = Pick<
  Environment,
  | 'NODE_ENV'
  | 'SESSION_SECRET'
  | 'SESSION_IDLE_SECONDS'
  | 'SESSION_ABSOLUTE_SECONDS'
  | 'LOGIN_MAX_ATTEMPTS'
  | 'LOGIN_WINDOW_SECONDS'
  | 'CORS_ORIGINS'
  | 'API_ORIGIN'
>;
export interface Principal {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}
export interface SessionContext {
  id: string;
  userId: string;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
  user: Principal;
  token: string;
}
export type AuthRequest = Request & { auth?: SessionContext };
export const sessionCookie = 'atlas_session';
const loginCookie = 'atlas_login_csrf';

export function cookie(req: Request, name: string): string | undefined {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  if (values.length !== 1) return;
  try {
    return decodeURIComponent(values[0].slice(name.length + 1));
  } catch {
    return;
  }
}
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AUTH_SETTINGS) private readonly config: AuthSettings | null,
  ) {}
  private get settings(): AuthSettings {
    if (!this.config) throw new ServiceUnavailableException('Authentication is not configured');
    return this.config;
  }
  private digest(value: string): string {
    return createHmac('sha256', this.settings.SESSION_SECRET).update(value).digest('hex');
  }
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.settings.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/api/v1/admin',
    };
  }
  clearSession(res: Response): void {
    res.clearCookie(sessionCookie, this.cookieOptions());
  }
  private setSession(res: Response, token: string, expires: Date): void {
    res.cookie(sessionCookie, token, { ...this.cookieOptions(), expires });
  }
  private checkOrigin(req: Request, required = true): void {
    const origin = req.get('Origin');
    if (
      (!origin && required) ||
      (origin && ![this.settings.API_ORIGIN, ...this.settings.CORS_ORIGINS].includes(origin)) ||
      req.get('Sec-Fetch-Site') === 'cross-site'
    ) {
      throw new ForbiddenException('Origin not allowed');
    }
  }
  challenge(req: Request, res: Response) {
    this.checkOrigin(req, false);
    const nonce = randomBytes(32).toString('base64url') + '.' + String(Date.now() + 600000);
    res.cookie(loginCookie, nonce, { ...this.cookieOptions(), maxAge: 600000 });
    return { data: { csrfToken: this.digest('login:' + nonce) } };
  }
  checkLoginCsrf(req: Request): void {
    this.checkOrigin(req);
    const nonce = cookie(req, loginCookie);
    const token = req.get('X-CSRF-Token');
    if (
      !nonce ||
      !/^[A-Za-z0-9_-]{43}\.\d{13}$/.test(nonce) ||
      Number(nonce.split('.')[1]) < Date.now() ||
      Number(nonce.split('.')[1]) > Date.now() + 600000 ||
      !token ||
      !equal(token, this.digest('login:' + nonce))
    ) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    if (!req.is('application/json')) throw new ForbiddenException('JSON request required');
  }
  checkCsrf(req: Request, context: SessionContext): void {
    this.checkOrigin(req);
    const token = req.get('X-CSRF-Token');
    if (!token || !equal(token, this.digest('csrf:' + context.token)))
      throw new ForbiddenException('Invalid CSRF token');
  }
  private async principal(userId: string): Promise<Principal | undefined> {
    const rows: Principal[] = await this.db.query(
      `SELECT u.id,u.email,
      ARRAY(SELECT ur.role_code FROM user_roles ur WHERE ur.user_id=u.id ORDER BY ur.role_code) AS roles,
      ARRAY(SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.role_code=ur.role_code WHERE ur.user_id=u.id ORDER BY rp.permission_code) AS permissions
      FROM users u WHERE u.id=$1 AND u.is_active=true`,
      [userId],
    );
    return rows[0];
  }
  private async throttle(email: string, ip: string, res: Response): Promise<void> {
    const { LOGIN_WINDOW_SECONDS: window, LOGIN_MAX_ATTEMPTS: max } = this.settings;
    const started = new Date(Math.floor(Date.now() / (window * 1000)) * window * 1000);
    // Check IP first so a blocked client cannot create unbounded account bucket rows.
    for (const [key, limit] of [
      [this.digest('ip:' + ip), max * 10],
      [this.digest('account:' + email), max],
    ] as const) {
      const rows: { attempts: number }[] = await this.db.query(
        `INSERT INTO login_buckets(key,window_started_at,attempts)
        VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET
        attempts=CASE WHEN login_buckets.window_started_at=EXCLUDED.window_started_at THEN LEAST(login_buckets.attempts+1,$3) ELSE 1 END,
        window_started_at=EXCLUDED.window_started_at RETURNING attempts`,
        [key, started, limit + 1],
      );
      if (rows[0].attempts > limit) {
        res.setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((started.getTime() + window * 1000 - Date.now()) / 1000)),
        );
        throw new HttpException({ message: 'Too many login attempts' }, 429);
      }
    }
  }
  async login(email: string, password: string, req: Request, res: Response) {
    this.checkLoginCsrf(req);
    await this.throttle(email, req.ip ?? req.socket.remoteAddress ?? 'unknown', res);
    const users: { id: string; password_hash: string; is_active: boolean }[] = await this.db.query(
      'SELECT id,password_hash,is_active FROM users WHERE email=$1',
      [email],
    );
    const candidate = users[0];
    const valid = await verifyPassword(password, candidate?.password_hash ?? dummyPasswordHash);
    const user = valid && candidate?.is_active ? await this.principal(candidate.id) : undefined;
    if (!valid || !user || !user.roles.length)
      throw new UnauthorizedException('Invalid email or password');
    const token = randomBytes(32).toString('base64url');
    const old = cookie(req, sessionCookie);
    const rows: { id: string; absoluteExpiresAt: Date; idleExpiresAt: Date }[] =
      await this.db.transaction(async (manager) => {
        if (old && /^[A-Za-z0-9_-]{43}$/.test(old))
          await manager.query(
            'UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
            [this.digest('session:' + old)],
          );
        return manager.query(
          `INSERT INTO sessions(id,user_id,token_hash,absolute_expires_at,idle_expires_at)
        VALUES($1,$2,$3,now()+($4*interval '1 second'),now()+($5*interval '1 second'))
        RETURNING id,absolute_expires_at AS "absoluteExpiresAt",idle_expires_at AS "idleExpiresAt"`,
          [
            randomUUID(),
            user.id,
            this.digest('session:' + token),
            this.settings.SESSION_ABSOLUTE_SECONDS,
            this.settings.SESSION_IDLE_SECONDS,
          ],
        );
      });
    this.setSession(res, token, rows[0].absoluteExpiresAt);
    res.clearCookie(loginCookie, this.cookieOptions());
    return this.view({ ...rows[0], userId: user.id, user, token });
  }
  async authenticate(req: Request): Promise<SessionContext> {
    const token = cookie(req, sessionCookie);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Authentication required');
    const rows: { id: string; userId: string; absoluteExpiresAt: Date; idleExpiresAt: Date }[] =
      await this.db.query(
        `WITH touched AS (UPDATE sessions s SET last_seen_at=now(),
      idle_expires_at=LEAST(absolute_expires_at,now()+($2*interval '1 second'))
      WHERE token_hash=$1 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now()
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.user_id AND u.is_active=true)
      RETURNING s.id,user_id AS "userId",absolute_expires_at AS "absoluteExpiresAt",idle_expires_at AS "idleExpiresAt") SELECT * FROM touched`,
        [this.digest('session:' + token), this.settings.SESSION_IDLE_SECONDS],
      );
    const row = rows[0];
    const user = row ? await this.principal(row.userId) : undefined;
    if (!row || !user || !user.roles.length)
      throw new UnauthorizedException('Authentication required');
    return { ...row, user, token };
  }
  view(context: SessionContext) {
    return {
      data: {
        user: context.user,
        csrfToken: this.digest('csrf:' + context.token),
        absoluteExpiresAt: context.absoluteExpiresAt,
        idleExpiresAt: context.idleExpiresAt,
      },
    };
  }
  async rotate(context: SessionContext, res: Response) {
    const token = randomBytes(32).toString('base64url');
    const rows: { id: string }[] = await this.db.query(
      `WITH rotated AS (UPDATE sessions SET token_hash=$1 WHERE id=$2 AND token_hash=$3 AND revoked_at IS NULL RETURNING id) SELECT id FROM rotated`,
      [this.digest('session:' + token), context.id, this.digest('session:' + context.token)],
    );
    if (!rows.length) throw new UnauthorizedException('Authentication required');
    this.setSession(res, token, context.absoluteExpiresAt);
    return this.view({ ...context, token });
  }
  async logout(context: SessionContext, res: Response): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [context.id]);
    this.clearSession(res);
  }
}
