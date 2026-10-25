import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import type { Principal } from '../auth/services/auth.service';
import { ContentAccessService } from '../guides/services/content-access.service';
import { parseInput } from '../../common/validation/parse-input';
const inputSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    portraitMediaId: z.uuid().nullable().default(null),
    imageMediaId: z.uuid().nullable().default(null),
    portraitAlt: z.string().trim().max(300).default(''),
    imageAlt: z.string().trim().max(300).default(''),
  })
  .strict()
  .refine(
    (v) =>
      (!v.portraitMediaId || v.portraitAlt.length > 0) &&
      (!v.imageMediaId || v.imageAlt.length > 0),
  );
@Injectable()
export class CharacterMediaService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
  ) {}
  async get(game: string, character: string, actor?: Principal) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [row] = await m.query(
        `SELECT ch.id,ch.game_id,ch.name,ch.portrait_url,ch.image_url,cm.portrait_media_id,cm.image_media_id,cm.portrait_alt,cm.image_alt,COALESCE(cm.version,0) AS version FROM characters ch JOIN games g ON g.id=ch.game_id LEFT JOIN character_media cm ON cm.character_id=ch.id WHERE ${actor ? 'g.id=$1::uuid AND ch.id=$2::uuid' : "g.slug=$1 AND ch.slug=$2 AND ch.status='published'"} AND g.status='active'`,
        [game, character],
      );
      if (!row) throw new NotFoundException('Character not found');
      if (actor)
        await this.access.assert(m, actor, row.game_id, [
          'catalog:write',
          'catalog:draft:write',
          'content:review',
        ]);
      const prefix = actor ? '/api/v1/admin/media/' : '/api/v1/media/';
      const descriptor = (id: string | null, alt: string | null, fallback: string | null) =>
        id
          ? { mediaId: id, url: prefix + id + '/file', alt }
          : fallback
            ? { mediaId: null, url: fallback, alt: row.name }
            : null;
      return {
        data: {
          characterId: row.id,
          gameId: row.game_id,
          ...(actor ? { version: row.version } : {}),
          portrait: descriptor(row.portrait_media_id, row.portrait_alt, row.portrait_url),
          image: descriptor(row.image_media_id, row.image_alt, row.image_url),
        },
      };
    });
  }
  async replace(actor: Principal, game: string, character: string, input: unknown) {
    const v = parseInput(inputSchema, input);
    return this.db.transaction(async (m) => {
      await this.access.assert(m, actor, game, ['catalog:write', 'catalog:draft:write']);
      const [ch] = await m.query(
        'SELECT status FROM characters WHERE id=$1 AND game_id=$2 FOR UPDATE',
        [character, game],
      );
      if (!ch) throw new NotFoundException('Character not found');
      if (!actor.permissions.includes('catalog:write') && ch.status !== 'draft')
        throw new ForbiddenException('Editors can only change draft character media');
      const [current] = await m.query('SELECT version FROM character_media WHERE character_id=$1', [
        character,
      ]);
      if ((current?.version ?? 0) !== v.expectedVersion)
        throw new ConflictException('Character media changed');
      const ids = [
        ...new Set([v.portraitMediaId, v.imageMediaId].filter((id): id is string => id !== null)),
      ].sort();
      if (
        ids.length &&
        (
          await m.query(
            'SELECT id FROM media_assets WHERE id=ANY($1::uuid[]) AND game_id=$2 AND deleted_at IS NULL ORDER BY id FOR SHARE',
            [ids, game],
          )
        ).length !== ids.length
      )
        throw new BadRequestException('Image is unavailable or belongs to another game');
      await m.query(
        `INSERT INTO character_media(character_id,game_id,portrait_media_id,image_media_id,portrait_alt,image_alt,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(character_id) DO UPDATE SET portrait_media_id=EXCLUDED.portrait_media_id,image_media_id=EXCLUDED.image_media_id,portrait_alt=EXCLUDED.portrait_alt,image_alt=EXCLUDED.image_alt,updated_by=EXCLUDED.updated_by,version=character_media.version+1,updated_at=now()`,
        [character, game, v.portraitMediaId, v.imageMediaId, v.portraitAlt, v.imageAlt, actor.id],
      );
      return { data: { characterId: character, version: v.expectedVersion + 1 } };
    });
  }
}
