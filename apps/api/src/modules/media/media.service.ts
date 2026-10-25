import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import sharp, { type OutputInfo } from 'sharp';
import { MediaEntity } from './media.entities';
import { MediaStorage } from './media-storage';
import { ContentAccessService } from '../guides/services/content-access.service';
import type { Principal } from '../auth/services/auth.service';
import type { RichNode } from '../guides/domain/rich-document';
import { publicJoin } from '../guides/services/content-reader.service';

export function documentMediaIds(body: RichNode): string[] {
  return [
    ...new Set([
      ...(body.type === 'image' ? [body.attrs!.mediaId!] : []),
      ...(body.content ?? []).flatMap(documentMediaIds),
    ]),
  ];
}
@Injectable()
export class MediaService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
    private readonly storage: MediaStorage,
  ) {}
  async upload(actor: Principal, gameId: string, file?: { buffer: Buffer }) {
    await this.db.transaction((manager) =>
      this.access.assert(manager, actor, gameId, ['content:write']),
    );
    if (!file?.buffer?.length || file.buffer.length > 5242880)
      throw new BadRequestException('An image up to 5 MiB is required');
    const bytes = file.buffer;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!png && !jpeg && !webp) throw new BadRequestException('Use PNG, JPEG or WebP');
    let image: { data: Buffer; info: OutputInfo };
    try {
      const decoder = sharp(file.buffer, {
        limitInputPixels: 16777216,
        animated: false,
        failOn: 'warning',
      });
      const metadata = await decoder.metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > 8192 ||
        metadata.height > 8192 ||
        (metadata.pages ?? 1) > 1
      )
        throw new Error();
      image = await decoder.rotate().webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
      if (image.data.length > 5242880) throw new Error();
    } catch {
      throw new BadRequestException('Invalid, oversized or animated image; use PNG, JPEG or WebP');
    }
    const id = randomUUID();
    const storageKey = `${id}.webp`;
    await this.storage.put(storageKey, image.data);
    try {
      await this.db.transaction(async (manager) => {
        await this.access.assert(manager, actor, gameId, ['content:write']);
        await manager.getRepository(MediaEntity).insert({
          id,
          gameId,
          uploadedBy: actor.id,
          storageKey,
          mimeType: 'image/webp',
          byteSize: image.data.length,
          width: image.info.width,
          height: image.info.height,
          checksum: createHash('sha256').update(image.data).digest('hex'),
        });
      });
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
    return {
      data: {
        id,
        width: image.info.width,
        height: image.info.height,
        mimeType: 'image/webp',
        byteSize: image.data.length,
        previewUrl: `/api/v1/admin/media/${id}/file`,
      },
    };
  }
  async validate(
    manager: EntityManager,
    gameId: string,
    body: RichNode,
    coverImageId: string | null,
  ) {
    const ids = [...new Set([...documentMediaIds(body), ...(coverImageId ? [coverImageId] : [])])];
    if (ids.length > 50) throw new BadRequestException('A guide can reference at most 50 images');
    if (ids.length) {
      const rows = await manager.query(
        'SELECT id FROM media_assets WHERE game_id=$1 AND deleted_at IS NULL AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
        [gameId, ids],
      );
      if (rows.length !== ids.length)
        throw new BadRequestException('Image is missing or belongs to another game');
    }
    return ids;
  }
  async file(id: string, actor?: Principal) {
    const media = await this.db.getRepository(MediaEntity).findOneBy({ id });
    if (!media || media.deletedAt) throw new NotFoundException('Image not found');
    if (actor)
      await this.db.transaction((manager) =>
        this.access.assert(manager, actor, media.gameId, [
          'content:write',
          'content:review',
          'content:publish',
        ]),
      );
    else {
      const rows = await this.db.query(
        `SELECT c.id ${publicJoin.replace('g.slug=$1 AND ', '')} AND EXISTS(SELECT 1 FROM content_revision_media cm WHERE cm.content_id=p.content_id AND cm.revision=p.revision AND cm.media_id=$1 AND cm.game_id=c.game_id) LIMIT 1`,
        [id],
      );
      if (
        !rows.length &&
        !(
          await this.db.query(
            `SELECT ch.id FROM character_media cm JOIN characters ch ON ch.id=cm.character_id AND ch.game_id=cm.game_id JOIN games g ON g.id=ch.game_id WHERE (cm.portrait_media_id=$1 OR cm.image_media_id=$1) AND ch.status='published' AND g.status='active' LIMIT 1`,
            [id],
          )
        ).length
      )
        throw new NotFoundException('Image not found');
    }
    try {
      return await this.storage.get(media.storageKey);
    } catch {
      throw new NotFoundException('Image not found');
    }
  }
}
