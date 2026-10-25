import { parseInput } from '../../../common/validation/parse-input';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { z } from 'zod';
import { hashPassword } from '../security/password';
import { Role } from '../entities/auth.entities';

export const createUserInput = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    roles: z
      .array(z.enum(['ADMIN', 'EDITOR', 'REVIEWER']))
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
@Injectable()
export class UsersService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async create(input: unknown, bootstrap = false) {
    const value = parseInput(createUserInput, input);
    const hash = await hashPassword(value.password);
    try {
      return await this.db.transaction(async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext('atlas-admin-membership'))");
        if (
          bootstrap &&
          (
            await manager.query(
              "SELECT 1 FROM user_roles ur JOIN users u ON u.id=ur.user_id WHERE ur.role_code='ADMIN' AND u.is_active LIMIT 1",
            )
          ).length
        )
          throw new ConflictException('An admin already exists');
        const id = randomUUID();
        await manager.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
          id,
          value.email,
          hash,
        ]);
        for (const role of value.roles)
          await manager.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [
            id,
            role,
          ]);
        return { id, email: value.email, roles: value.roles };
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        throw new ConflictException('User already exists');
      throw error;
    }
  }
  async roles(userId: string, roles: Role[]): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('atlas-admin-membership'))");
      if (!(await manager.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId])).length)
        throw new NotFoundException('User not found');
      if (!roles.includes('ADMIN')) {
        const admins: { user_id: string }[] = await manager.query(
          "SELECT ur.user_id FROM user_roles ur JOIN users u ON u.id=ur.user_id WHERE ur.role_code='ADMIN' AND u.is_active",
        );
        if (admins.length === 1 && admins[0].user_id === userId)
          throw new ConflictException('Cannot remove the last active admin');
      }
      await manager.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
      for (const role of roles)
        await manager.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [
          userId,
          role,
        ]);
      await manager.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [userId],
      );
    });
  }
  async games(userId: string, gameIds: string[]): Promise<void> {
    try {
      await this.db.transaction(async (manager) => {
        if (!(await manager.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId])).length)
          throw new NotFoundException('User not found');
        await manager.query('DELETE FROM user_game_access WHERE user_id=$1', [userId]);
        for (const gameId of gameIds)
          await manager.query('INSERT INTO user_game_access(user_id,game_id) VALUES($1,$2)', [
            userId,
            gameId,
          ]);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23503'
      )
        throw new BadRequestException('Game not found');
      throw error;
    }
  }
}
