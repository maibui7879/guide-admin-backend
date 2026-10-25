import type { GuideCategory } from '../domain/guide-category';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Principal } from '../../auth/services/auth.service';
import { parseInput } from '../../../common/validation/parse-input';
import { AuditService } from '../../audit/audit.service';
import {
  Content,
  ContentEntity,
  ContentRelationEntity,
  ContentRevision,
  ContentRevisionEntity,
  PublicationEntity,
} from '../entities/content.entities';
import {
  createContentInput,
  editContentInput,
  expectedInput,
  restoreContentInput,
  returnContentInput,
} from '../domain/content-input';
import { documentText, parseRichDocument } from '../domain/rich-document';
import { transition } from '../domain/content-workflow';
import { ContentAccessService } from './content-access.service';
import { presentContent } from '../domain/wiki-identity';
import { assertWikiTarget } from './wiki-target';
import { MediaService } from '../../media/media.service';
import { RevisionMediaEntity } from '../../media/media.entities';

interface RevisionFields {
  coverImageId: string | null;
  coverAlt: string;
  coverCaption: string;
  title: string;
  description: string;
  category: GuideCategory;
  body: unknown;
  schemaVersion: number;
  sources: ContentRevision['sources'];
  characterIds: string[];
  gameVersionId: string | null;
}

@Injectable()
export class ContentWriterService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    private readonly access: ContentAccessService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async create(actor: Principal, input: unknown, requestId: string) {
    const value = parseInput(createContentInput, input);
    const body = parseRichDocument(value.body);
    try {
      return await this.db.transaction(async (manager) => {
        await this.access.assert(manager, actor, value.gameId, ['content:write']);
        const content = manager.getRepository(ContentEntity).create({
          id: randomUUID(),
          gameId: value.gameId,
          slug: value.slug,
          contentType: value.contentType,
          wikiKind: value.wiki.kind,
          wikiTopic: value.wiki.topic,
          wikiCharacterId: value.wiki.kind === 'character' ? value.wiki.characterId : null,
          wikiTeamId: value.wiki.kind === 'team' ? value.wiki.teamId : null,
          authorId: actor.id,
          state: 'draft',
          version: 1,
          currentRevision: 1,
        });
        await assertWikiTarget(manager, content, false);
        await manager.getRepository(ContentEntity).insert(content);
        await this.insertRevision(manager, content, actor.id, { ...value, body });
        await this.audit.record(manager, {
          actorId: actor.id,
          contentId: content.id,
          action: 'content.created',
          version: 1,
          revision: 1,
          requestId,
          details: { fromState: null, toState: 'draft' },
        });
        return this.result(manager, content.id);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        throw new ConflictException(
          (error.driverError as { constraint?: string }).constraint?.startsWith('uq_contents_wiki_')
            ? 'Wiki page already exists for this target and topic'
            : 'Content slug already exists',
        );
      if (
        error instanceof QueryFailedError &&
        ['23503', '23514'].includes((error.driverError as { code: string }).code)
      )
        throw new BadRequestException('Invalid wiki target or identity');
      throw error;
    }
  }

  async edit(actor: Principal, id: string, input: unknown, requestId: string) {
    const value = parseInput(editContentInput, input);
    const body = parseRichDocument(value.body);
    return this.mutate(
      actor,
      id,
      value.expectedRevision,
      requestId,
      'content.edited',
      ['content:write'],
      async (manager, content) => {
        content.state = transition(content.state, 'edit');
        content.currentRevision++;
        await this.insertRevision(manager, content, actor.id, { ...value, body });
      },
    );
  }

  async restore(actor: Principal, id: string, input: unknown, requestId: string) {
    const value = parseInput(restoreContentInput, input);
    return this.mutate(
      actor,
      id,
      value.expectedRevision,
      requestId,
      'content.restored',
      ['content:write'],
      async (manager, content) => {
        content.state = transition(content.state, 'restore');
        const source = await manager
          .getRepository(ContentRevisionEntity)
          .findOneBy({ contentId: id, revision: value.sourceRevision });
        if (!source) throw new NotFoundException('Revision not found');
        const relations = await this.relations(manager, id, source.revision);
        content.currentRevision++;
        await this.insertRevision(
          manager,
          content,
          actor.id,
          { ...source, ...relations },
          source.revision,
        );
      },
      { sourceRevision: value.sourceRevision },
    );
  }

  async submit(actor: Principal, id: string, input: unknown, requestId: string) {
    const { expectedRevision } = parseInput(expectedInput, input);
    return this.mutate(
      actor,
      id,
      expectedRevision,
      requestId,
      'content.submitted',
      ['content:write'],
      async (manager, content) => {
        content.state = transition(content.state, 'submit');
        const revision = await manager
          .getRepository(ContentRevisionEntity)
          .findOneByOrFail({ contentId: id, revision: content.currentRevision });
        if (!documentText(parseRichDocument(revision.body)).trim())
          throw new BadRequestException('Guide text is required for review');
      },
    );
  }

  async approve(actor: Principal, id: string, input: unknown, requestId: string) {
    const { expectedRevision } = parseInput(expectedInput, input);
    return this.mutate(
      actor,
      id,
      expectedRevision,
      requestId,
      'content.approved',
      ['content:review'],
      async (manager, content) => {
        content.state = transition(content.state, 'approve');
        const revision = await manager
          .getRepository(ContentRevisionEntity)
          .findOneByOrFail({ contentId: id, revision: content.currentRevision });
        if (revision.authorId === actor.id)
          throw new ForbiddenException('Authors cannot approve their own revision');
      },
    );
  }

  async returnToDraft(actor: Principal, id: string, input: unknown, requestId: string) {
    const value = parseInput(returnContentInput, input);
    return this.mutate(
      actor,
      id,
      value.expectedRevision,
      requestId,
      'content.returned',
      ['content:review'],
      async (_manager, content) => {
        content.state = transition(content.state, 'return');
      },
      { reason: value.reason },
    );
  }

  async publish(actor: Principal, id: string, input: unknown, requestId: string) {
    const { expectedRevision } = parseInput(expectedInput, input);
    return this.mutate(
      actor,
      id,
      expectedRevision,
      requestId,
      'content.published',
      ['content:publish'],
      async (manager, content) => {
        content.state = transition(content.state, 'publish');
        await assertWikiTarget(manager, content, true);
        const relations = await this.relations(manager, id, content.currentRevision);
        await this.validateRelations(manager, content.gameId, relations, true);
        await manager.getRepository(PublicationEntity).upsert(
          {
            contentId: id,
            revision: content.currentRevision,
            publishedBy: actor.id,
            publishedAt: new Date(),
          },
          ['contentId'],
        );
      },
    );
  }

  async unpublish(actor: Principal, id: string, input: unknown, requestId: string) {
    const { expectedRevision } = parseInput(expectedInput, input);
    return this.mutate(
      actor,
      id,
      expectedRevision,
      requestId,
      'content.unpublished',
      ['content:publish'],
      async (manager, content) => {
        const publication = await manager
          .getRepository(PublicationEntity)
          .findOneBy({ contentId: id });
        if (!publication) throw new ConflictException('Content is not published');
        await manager.getRepository(PublicationEntity).delete({ contentId: id });
        if (content.state === 'published') content.state = 'draft';
      },
    );
  }

  async archive(actor: Principal, id: string, input: unknown, requestId: string) {
    const { expectedRevision } = parseInput(expectedInput, input);
    return this.mutate(
      actor,
      id,
      expectedRevision,
      requestId,
      'content.archived',
      ['content:publish'],
      async (manager, content) => {
        content.state = transition(content.state, 'archive');
        await manager.getRepository(PublicationEntity).delete({ contentId: id });
      },
    );
  }

  private async mutate(
    actor: Principal,
    id: string,
    expectedRevision: number,
    requestId: string,
    action: string,
    permissions: string[],
    work: (manager: EntityManager, content: Content) => Promise<void>,
    details: Record<string, unknown> = {},
  ) {
    return this.db.transaction(async (manager) => {
      const content = await manager
        .getRepository(ContentEntity)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!content) throw new NotFoundException('Content not found');
      await this.access.assert(manager, actor, content.gameId, permissions);
      if (content.version !== expectedRevision) throw new ConflictException('Content has changed');
      const fromState = content.state;
      await work(manager, content);
      content.version++;
      await manager.getRepository(ContentEntity).update(id, {
        state: content.state,
        currentRevision: content.currentRevision,
        version: content.version,
        updatedAt: new Date(),
      });
      await this.audit.record(manager, {
        actorId: actor.id,
        contentId: id,
        action,
        version: content.version,
        revision: content.currentRevision,
        requestId,
        details: { ...details, fromState, toState: content.state },
      });
      return this.result(manager, id);
    });
  }

  private async result(manager: EntityManager, id: string) {
    const content = await manager.getRepository(ContentEntity).findOneByOrFail({ id });
    const publication = await manager.getRepository(PublicationEntity).findOneBy({ contentId: id });
    return { ...presentContent(content), publication };
  }

  private async insertRevision(
    manager: EntityManager,
    content: Content,
    authorId: string,
    value: RevisionFields,
    derivedFrom: number | null = null,
  ) {
    await this.validateRelations(manager, content.gameId, value, false);
    const body = parseRichDocument(value.body);
    if (value.coverImageId && !value.coverAlt.trim())
      throw new BadRequestException('Cover alt text is required');
    const mediaIds = await this.media.validate(manager, content.gameId, body, value.coverImageId);
    await manager.getRepository(ContentRevisionEntity).insert({
      contentId: content.id,
      revision: content.currentRevision,
      authorId,
      derivedFrom,
      title: value.title,
      description: value.description,
      category: value.category,
      coverImageId: value.coverImageId,
      coverAlt: value.coverAlt,
      coverCaption: value.coverCaption,
      body,
      schemaVersion: 1,
      sources: value.sources,
      readingMinutes: Math.max(
        1,
        Math.ceil(documentText(body).trim().split(/\s+/).filter(Boolean).length / 200),
      ),
    });
    if (mediaIds.length)
      await manager.getRepository(RevisionMediaEntity).insert(
        mediaIds.map((mediaId) => ({
          contentId: content.id,
          revision: content.currentRevision,
          mediaId,
          gameId: content.gameId,
        })),
      );
    const targets = [
      ...value.characterIds.map((characterId) => ({ characterId, gameVersionId: null })),
      ...(value.gameVersionId ? [{ characterId: null, gameVersionId: value.gameVersionId }] : []),
    ];
    if (targets.length)
      await manager.getRepository(ContentRelationEntity).insert(
        targets.map((target) => ({
          id: randomUUID(),
          contentId: content.id,
          revision: content.currentRevision,
          ...target,
        })),
      );
  }

  private async relations(manager: EntityManager, contentId: string, revision: number) {
    const rows = await manager.getRepository(ContentRelationEntity).findBy({ contentId, revision });
    return {
      characterIds: rows.flatMap((row) => (row.characterId ? [row.characterId] : [])),
      gameVersionId: rows.find((row) => row.gameVersionId)?.gameVersionId ?? null,
    };
  }

  private async validateRelations(
    manager: EntityManager,
    gameId: string,
    value: { characterIds: string[]; gameVersionId: string | null },
    published: boolean,
  ) {
    if (value.characterIds.length) {
      const rows = await manager.query(
        "SELECT id FROM characters WHERE game_id=$1 AND id=ANY($2::uuid[]) AND ($3::boolean=false OR status='published') ORDER BY id FOR SHARE",
        [gameId, value.characterIds, published],
      );
      if (rows.length !== value.characterIds.length)
        throw new BadRequestException('Invalid character relation');
    }
    if (value.gameVersionId) {
      const rows = await manager.query(
        "SELECT id FROM game_versions WHERE game_id=$1 AND id=$2 AND ($3::boolean=false OR status='published') FOR SHARE",
        [gameId, value.gameVersionId, published],
      );
      if (!rows.length) throw new BadRequestException('Invalid game patch relation');
    }
  }
}
