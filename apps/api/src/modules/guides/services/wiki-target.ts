import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WikiFields } from '../domain/wiki-identity';

export async function assertWikiTarget(
  manager: EntityManager,
  content: WikiFields & { gameId: string },
  published: boolean,
) {
  if (content.wikiKind === 'game') return;
  const isCharacter = content.wikiKind === 'character';
  const rows = await manager.query<
    { id: string; main_character_id?: string; support_one_id?: string; support_two_id?: string }[]
  >(
    `SELECT * FROM ${isCharacter ? 'characters' : 'teams'} WHERE game_id=$1 AND id=$2 AND ($3::boolean=false OR status='published') FOR SHARE`,
    [content.gameId, isCharacter ? content.wikiCharacterId : content.wikiTeamId, published],
  );
  if (!rows.length) throw new BadRequestException('Invalid or unpublished wiki target');
  if (!isCharacter && published) {
    const team = rows[0];
    const characters = await manager.query(
      "SELECT id FROM characters WHERE game_id=$1 AND id=ANY($2::uuid[]) AND status='published' ORDER BY id FOR SHARE",
      [content.gameId, [team.main_character_id, team.support_one_id, team.support_two_id]],
    );
    if (characters.length !== 3)
      throw new BadRequestException('Wiki team members must be published');
  }
}
