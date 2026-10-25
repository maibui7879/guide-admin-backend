import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaginationQuery } from '../../common/dto/pagination-query.dto';
import type { Principal } from '../auth/services/auth.service';
import { ContentAccessService } from '../guides/services/content-access.service';
import { MediaEntity } from './media.entities';
import { MediaLibraryQuery } from './media-library.dto';
import { MediaStorage } from './media-storage';

const readPermissions = ['content:write', 'content:review', 'content:publish'];
const references = `(SELECT cm.content_id,cm.revision,NULL::uuid AS character_id FROM content_revision_media cm WHERE cm.media_id=m.id
  UNION SELECT r.content_id,r.revision,NULL::uuid FROM content_revisions r WHERE r.cover_image_id=m.id
  UNION SELECT NULL::uuid,NULL::integer,cm.character_id FROM character_media cm WHERE cm.portrait_media_id=m.id OR cm.image_media_id=m.id)`;
function page<T>(data: T[], total: number, query: PaginationQuery) {
  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

@Injectable()
export class MediaLibraryService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
    private readonly storage: MediaStorage,
  ) {}
  async list(actor: Principal, gameId: string, query: MediaLibraryQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.access.assert(manager, actor, gameId, readPermissions);
      const filter =
        query.usage === 'deletion_pending'
          ? 'm.deleted_at IS NOT NULL'
          : query.usage === 'unused'
            ? `m.deleted_at IS NULL AND NOT EXISTS ${references}`
            : query.usage === 'referenced'
              ? `EXISTS ${references}`
              : 'TRUE';
      const where = `FROM media_assets m WHERE m.game_id=$1 AND ${filter}`;
      const [{ total }] = await manager.query(`SELECT count(*)::int AS total ${where}`, [gameId]);
      const rows = await manager.query(
        `SELECT m.id,m.game_id AS "gameId",m.uploaded_by AS "uploadedBy",m.mime_type AS "mimeType",m.byte_size AS "byteSize",m.width,m.height,m.checksum,m.created_at AS "createdAt",
        CASE WHEN m.deleted_at IS NULL THEN 'available' ELSE 'deletion_pending' END AS status,
        (SELECT count(*)::int FROM ${references} refs) AS "referenceCount"
        ${where} ORDER BY m.created_at DESC,m.id ASC LIMIT $2 OFFSET $3`,
        [gameId, query.limit, (query.page - 1) * query.limit],
      );
      return page(
        rows.map((row: { id: string }) => ({
          ...row,
          previewUrl: `/api/v1/admin/media/${row.id}/file`,
        })),
        total,
        query,
      );
    });
  }
  async usages(actor: Principal, id: string, query: PaginationQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const media = await manager.getRepository(MediaEntity).findOneBy({ id });
      if (!media) throw new NotFoundException('Image not found');
      await this.access.assert(manager, actor, media.gameId, readPermissions);
      const from = `FROM media_assets m CROSS JOIN LATERAL ${references} refs LEFT JOIN contents c ON c.id=refs.content_id
        LEFT JOIN content_revisions r ON r.content_id=refs.content_id AND r.revision=refs.revision
        LEFT JOIN publications p ON p.content_id=c.id LEFT JOIN characters ch ON ch.id=refs.character_id WHERE m.id=$1`;
      const [{ total }] = await manager.query(`SELECT count(*)::int AS total ${from}`, [id]);
      const rows = await manager.query(
        `SELECT c.id AS "contentId",ch.id AS "characterId",COALESCE(c.slug,ch.slug) AS slug,COALESCE(c.state,ch.status) AS state,r.revision,COALESCE(r.title,ch.name) AS title,
        CASE WHEN ch.id IS NOT NULL THEN true ELSE r.revision=c.current_revision END AS "isCurrent",CASE WHEN ch.id IS NOT NULL THEN ch.status='published' ELSE COALESCE(r.revision=p.revision,false) END AS "isPublished"
        ${from} ORDER BY COALESCE(r.created_at,ch.updated_at) DESC,COALESCE(c.id,ch.id) ASC,r.revision DESC LIMIT $2 OFFSET $3`,
        [id, query.limit, (query.page - 1) * query.limit],
      );
      return page(rows, total, query);
    });
  }
  async remove(actor: Principal, id: string): Promise<void> {
    // Commit a tombstone before touching storage. A failed object deletion can be retried.
    const media = await this.db.transaction(async (manager) => {
      const media = await manager
        .getRepository(MediaEntity)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!media) throw new NotFoundException('Image not found');
      await this.access.assert(manager, actor, media.gameId, ['content:publish']);
      const used = await manager.query(
        `SELECT 1 FROM media_assets m WHERE m.id=$1 AND EXISTS ${references}`,
        [id],
      );
      if (used.length) throw new ConflictException('Image is referenced and cannot be deleted');
      await manager
        .getRepository(MediaEntity)
        .update(id, { deletedAt: media.deletedAt ?? new Date() });
      return media;
    });
    try {
      await this.storage.remove(media.storageKey);
    } catch {
      throw new ServiceUnavailableException(
        'Image deletion is pending; retry the same DELETE request',
      );
    }
    await this.db.getRepository(MediaEntity).delete({ id });
  }
}
