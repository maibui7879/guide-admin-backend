import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Principal } from '../../auth/services/auth.service';
import { PaginationQuery } from '../../../common/dto/pagination-query.dto';
import { AuditEntryEntity } from '../../audit/entities/audit-entry.entity';
import {
  ContentEntity,
  ContentRelationEntity,
  ContentRevisionEntity,
  PublicationEntity,
} from '../entities/content.entities';
import { AdminContentsQuery, GuidesQuery } from '../dto/content-query.dto';
import { GuideDetailDto, GuideSummaryDto } from '../dto/content-response.dto';
import { renderRichDocument } from '../domain/rich-document';
import { ContentAccessService } from './content-access.service';
import { presentContent } from '../domain/wiki-identity';

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
export const publicJoin = `FROM contents c JOIN publications p ON p.content_id=c.id
  JOIN content_revisions r ON r.content_id=p.content_id AND r.revision=p.revision
  JOIN games g ON g.id=c.game_id
  WHERE g.slug=$1 AND g.status='active' AND c.state<>'archived'
  AND (c.wiki_kind<>'character' OR EXISTS(SELECT 1 FROM characters wc WHERE wc.id=c.wiki_character_id AND wc.game_id=c.game_id AND wc.status='published'))
  AND (c.wiki_kind<>'team' OR EXISTS(SELECT 1 FROM teams wt JOIN characters wm ON wm.id=wt.main_character_id JOIN characters ws1 ON ws1.id=wt.support_one_id JOIN characters ws2 ON ws2.id=wt.support_two_id WHERE wt.id=c.wiki_team_id AND wt.game_id=c.game_id AND wt.status='published' AND wm.status='published' AND ws1.status='published' AND ws2.status='published'))`;
const summary = `c.id,c.slug,r.title,r.description,r.category,r.reading_minutes AS "readingMinutes",p.published_at AS "publishedAt",
jsonb_build_object('kind',c.wiki_kind,'topic',c.wiki_topic,'characterId',c.wiki_character_id,'teamId',c.wiki_team_id,'key',c.wiki_kind||':'||COALESCE(c.wiki_character_id::text,c.wiki_team_id::text,'game')||':'||c.wiki_topic) AS wiki`;
const staffPermissions = ['content:write', 'content:review', 'content:publish'];

@Injectable()
export class ContentReaderService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
  ) {}

  async guides(gameSlug: string, query: GuidesQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      if (
        !(await manager.query("SELECT id FROM games WHERE slug=$1 AND status='active'", [gameSlug]))
          .length
      )
        throw new NotFoundException('Game not found');
      const params = [gameSlug, query.category ?? null];
      const filter = `${publicJoin} AND ($2::text IS NULL OR r.category=$2)`;
      const [{ total }] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total ${filter}`,
        params,
      );
      const rows = await manager.query<GuideSummaryDto[]>(
        `SELECT ${summary} ${filter} ORDER BY p.published_at DESC,c.id ASC LIMIT $3 OFFSET $4`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return page(rows, total, query);
    });
  }

  async guide(gameSlug: string, slug: string) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const [row] = await manager.query<GuideDetailDto[]>(
        `SELECT ${summary},p.revision,r.schema_version AS "schemaVersion",r.body,r.sources,
        r.cover_image_id AS "coverImageId",r.cover_alt AS "coverAlt",r.cover_caption AS "coverCaption" ${publicJoin} AND c.slug=$2`,
        [gameSlug, slug],
      );
      if (!row) throw new NotFoundException('Guide not found');
      const characters = await manager.query<{ id: string; slug: string; name: string }[]>(
        `SELECT ch.id,ch.slug,ch.name FROM content_relations cr JOIN characters ch ON ch.id=cr.character_id WHERE cr.content_id=$1 AND cr.revision=$2 AND ch.status='published' ORDER BY ch.name,ch.id`,
        [row.id, row.revision],
      );
      const patches = await manager.query<
        { id: string; version: string; releaseDate: string | null }[]
      >(
        `SELECT v.id,v.version,v.release_date AS "releaseDate" FROM content_relations cr JOIN game_versions v ON v.id=cr.game_version_id WHERE cr.content_id=$1 AND cr.revision=$2 AND v.status='published'`,
        [row.id, row.revision],
      );
      return {
        data: {
          ...row,
          html: renderRichDocument(row.body),
          characters,
          gameVersion: patches[0] ?? null,
          cover: row.coverImageId
            ? {
                mediaId: row.coverImageId,
                url: `/api/v1/media/${row.coverImageId}/file`,
                alt: row.coverAlt,
                caption: row.coverCaption,
              }
            : null,
        },
      };
    });
  }

  async contents(actor: Principal, query: AdminContentsQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.access.assert(manager, actor, query.gameId, staffPermissions);
      const [rows, total] = await manager.getRepository(ContentEntity).findAndCount({
        where: { gameId: query.gameId, ...(query.state ? { state: query.state } : {}) },
        order: { updatedAt: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return page(rows.map(presentContent), total, query);
    });
  }

  async preview(actor: Principal, id: string, revisionNumber?: number) {
    if (
      revisionNumber !== undefined &&
      (!Number.isInteger(revisionNumber) || revisionNumber < 1 || revisionNumber > 2147483647)
    )
      throw new BadRequestException('Invalid revision number');
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const content = await this.authorized(manager, actor, id);
      const revision = await manager
        .getRepository(ContentRevisionEntity)
        .findOneBy({ contentId: id, revision: revisionNumber ?? content.currentRevision });
      if (!revision) throw new NotFoundException('Revision not found');
      const rows = await manager
        .getRepository(ContentRelationEntity)
        .findBy({ contentId: id, revision: revision.revision });
      const publication = await manager
        .getRepository(PublicationEntity)
        .findOneBy({ contentId: id });
      return {
        data: {
          ...presentContent(content),
          publication,
          revision,
          html: renderRichDocument(revision.body, true),
          cover: revision.coverImageId
            ? {
                mediaId: revision.coverImageId,
                url: `/api/v1/admin/media/${revision.coverImageId}/file`,
                alt: revision.coverAlt,
                caption: revision.coverCaption,
              }
            : null,
          relations: {
            characterIds: rows.flatMap((row) => (row.characterId ? [row.characterId] : [])),
            gameVersionId: rows.find((row) => row.gameVersionId)?.gameVersionId ?? null,
          },
        },
      };
    });
  }

  async revisions(actor: Principal, id: string, query: PaginationQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorized(manager, actor, id);
      const [rows, total] = await manager.getRepository(ContentRevisionEntity).findAndCount({
        where: { contentId: id },
        select: [
          'contentId',
          'revision',
          'authorId',
          'derivedFrom',
          'title',
          'description',
          'category',
          'schemaVersion',
          'readingMinutes',
          'createdAt',
        ],
        order: { revision: 'DESC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return page(rows, total, query);
    });
  }

  async audit(actor: Principal, id: string, query: PaginationQuery) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorized(manager, actor, id);
      const [rows, total] = await manager.getRepository(AuditEntryEntity).findAndCount({
        where: { contentId: id },
        order: { version: 'DESC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return page(rows, total, query);
    });
  }

  private async authorized(manager: EntityManager, actor: Principal, id: string) {
    const content = await manager.getRepository(ContentEntity).findOneBy({ id });
    if (!content) throw new NotFoundException('Content not found');
    await this.access.assert(manager, actor, content.gameId, staffPermissions);
    return content;
  }
}
