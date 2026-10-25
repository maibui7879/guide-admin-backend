import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Principal } from '../../auth/services/auth.service';

@Injectable()
export class ContentAccessService {
  async assert(
    manager: EntityManager,
    actor: Principal,
    gameId: string,
    permissions: string[],
  ): Promise<void> {
    if (!permissions.some((permission) => actor.permissions.includes(permission)))
      throw new ForbiddenException('Insufficient permissions');
    const games = await manager.query(
      "SELECT id FROM games WHERE id=$1 AND status='active' FOR SHARE",
      [gameId],
    );
    if (!games.length) throw new NotFoundException('Game not found');
    if (actor.roles.includes('ADMIN')) return;
    const grants = await manager.query(
      'SELECT 1 FROM user_game_access WHERE user_id=$1 AND game_id=$2 FOR SHARE',
      [actor.id, gameId],
    );
    if (!grants.length) throw new ForbiddenException('Game access required');
  }
}
