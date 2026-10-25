import { GUIDE_CATEGORIES, GuideCategory } from '../domain/guide-category';
import { EntitySchema, EntitySchemaColumnOptions } from 'typeorm';
import { RichNode } from '../domain/rich-document';
import { WikiFields, WIKI_TOPICS } from '../domain/wiki-identity';

export type ContentState = 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
export interface Content extends WikiFields {
  id: string;
  gameId: string;
  slug: string;
  contentType: string;
  authorId: string;
  state: ContentState;
  version: number;
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ContentRevision {
  coverImageId: string | null;
  coverAlt: string;
  coverCaption: string;
  contentId: string;
  revision: number;
  authorId: string;
  derivedFrom: number | null;
  title: string;
  description: string;
  category: GuideCategory;
  schemaVersion: number;
  body: RichNode;
  sources: { url: string; label: string; verifiedAt: string | null }[];
  readingMinutes: number;
  createdAt: Date;
}
export interface Publication {
  contentId: string;
  revision: number;
  publishedBy: string;
  publishedAt: Date;
}
export interface ContentRelation {
  id: string;
  contentId: string;
  revision: number;
  characterId: string | null;
  gameVersionId: string | null;
}
export const uuid = (name?: string, nullable = false): EntitySchemaColumnOptions => ({
  type: 'uuid',
  name,
  nullable,
});
export const timestamp = (name: string): EntitySchemaColumnOptions => ({
  type: 'timestamptz',
  name,
  default: () => 'now()',
});
export const primary = (table: string): EntitySchemaColumnOptions => ({
  type: 'uuid',
  primary: true,
  primaryKeyConstraintName: `pk_${table}`,
});

export const ContentEntity = new EntitySchema<Content>({
  name: 'Content',
  tableName: 'contents',
  columns: {
    id: primary('contents'),
    gameId: uuid('game_id'),
    slug: { type: 'varchar', length: 100 },
    wikiKind: { name: 'wiki_kind', type: 'varchar', length: 16 },
    wikiTopic: { name: 'wiki_topic', type: 'varchar', length: 16 },
    wikiCharacterId: uuid('wiki_character_id', true),
    wikiTeamId: uuid('wiki_team_id', true),
    contentType: { name: 'content_type', type: 'varchar', length: 16, default: 'guide' },
    authorId: uuid('author_id'),
    state: { type: 'varchar', length: 16, default: 'draft' },
    version: { type: 'integer', default: 1 },
    currentRevision: { name: 'current_revision', type: 'integer', default: 1 },
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  foreignKeys: [
    {
      name: 'fk_contents_wiki_character',
      target: 'Character',
      columnNames: ['wikiCharacterId', 'gameId'],
      referencedColumnNames: ['id', 'gameId'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_contents_wiki_team',
      target: 'Team',
      columnNames: ['wikiTeamId', 'gameId'],
      referencedColumnNames: ['id', 'gameId'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_contents_game',
      target: 'Game',
      columnNames: ['gameId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_contents_author',
      target: 'User',
      columnNames: ['authorId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  uniques: [{ name: 'uq_contents_game_slug', columns: ['gameId', 'slug'] }],
  indices: [
    {
      name: 'uq_contents_media_reference',
      columns: ['id', 'gameId'],
      unique: true,
      synchronize: false,
    },
    {
      name: 'uq_contents_wiki_character',
      columns: ['gameId', 'wikiCharacterId', 'wikiTopic'],
      unique: true,
      where: "wiki_kind='character'",
    },
    {
      name: 'uq_contents_wiki_team',
      columns: ['gameId', 'wikiTeamId', 'wikiTopic'],
      unique: true,
      where: "wiki_kind='team'",
    },
    {
      name: 'uq_contents_wiki_game',
      columns: ['gameId', 'wikiTopic'],
      unique: true,
      where: "wiki_kind='game'",
    },
    { name: 'ix_contents_wiki_character', columns: ['wikiCharacterId'] },
    { name: 'ix_contents_wiki_team', columns: ['wikiTeamId'] },
    { name: 'ix_contents_author', columns: ['authorId'] },
    { name: 'ix_contents_admin', columns: ['gameId', 'state', 'updatedAt', 'id'] },
  ],
  checks: [
    {
      name: 'ck_contents_wiki_topic',
      expression: `wiki_topic IN (${WIKI_TOPICS.map((topic) => `'${topic}'`).join(',')})`,
    },
    {
      name: 'ck_contents_wiki_target',
      expression:
        "(wiki_kind='game' AND wiki_character_id IS NULL AND wiki_team_id IS NULL) OR (wiki_kind='character' AND wiki_character_id IS NOT NULL AND wiki_team_id IS NULL) OR (wiki_kind='team' AND wiki_team_id IS NOT NULL AND wiki_character_id IS NULL)",
    },
    { name: 'ck_contents_slug', expression: "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'" },
    { name: 'ck_contents_type', expression: "content_type='guide'" },
    {
      name: 'ck_contents_state',
      expression: "state IN ('draft','in_review','approved','published','archived')",
    },
    {
      name: 'ck_contents_version',
      expression: 'version>0 AND current_revision>0 AND version>=current_revision',
    },
  ],
});
export const ContentRevisionEntity = new EntitySchema<ContentRevision>({
  name: 'ContentRevision',
  tableName: 'content_revisions',
  columns: {
    coverImageId: uuid('cover_image_id', true),
    coverAlt: { type: 'varchar', length: 300, name: 'cover_alt', default: '' },
    coverCaption: { type: 'varchar', length: 500, name: 'cover_caption', default: '' },
    contentId: {
      ...uuid('content_id'),
      primary: true,
      primaryKeyConstraintName: 'pk_content_revisions',
    },
    revision: { type: 'integer', primary: true, primaryKeyConstraintName: 'pk_content_revisions' },
    authorId: uuid('author_id'),
    derivedFrom: { name: 'derived_from', type: 'integer', nullable: true },
    title: { type: 'varchar', length: 150 },
    description: { type: 'varchar', length: 500 },
    category: { type: 'varchar', length: 50 },
    schemaVersion: { name: 'schema_version', type: 'smallint', default: 1 },
    body: { type: 'jsonb' },
    sources: { type: 'jsonb', default: [] },
    readingMinutes: { name: 'reading_minutes', type: 'integer' },
    createdAt: timestamp('created_at'),
  },
  foreignKeys: [
    {
      name: 'fk_revision_cover',
      target: 'Media',
      columnNames: ['coverImageId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_revisions_content',
      target: 'Content',
      columnNames: ['contentId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_revisions_author',
      target: 'User',
      columnNames: ['authorId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_revisions_source',
      target: 'ContentRevision',
      columnNames: ['contentId', 'derivedFrom'],
      referencedColumnNames: ['contentId', 'revision'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    { name: 'ix_revision_cover', columns: ['coverImageId'] },
    { name: 'ix_guides_search', synchronize: false },
    { name: 'ix_revisions_author', columns: ['authorId'] },
    { name: 'ix_revisions_source', columns: ['contentId', 'derivedFrom'] },
  ],
  checks: [
    {
      name: 'ck_revisions_version',
      expression: 'revision>0 AND (derived_from IS NULL OR derived_from<revision)',
    },
    {
      name: 'ck_revisions_document',
      expression: "schema_version=1 AND jsonb_typeof(body)='object'",
    },
    { name: 'ck_revisions_sources', expression: "jsonb_typeof(sources)='array'" },
    { name: 'ck_revisions_reading', expression: 'reading_minutes>0' },
    {
      name: 'ck_revisions_category',
      expression: `category IN (${GUIDE_CATEGORIES.map((category) => `'${category}'`).join(', ')})`,
    },
  ],
});
export const PublicationEntity = new EntitySchema<Publication>({
  name: 'Publication',
  tableName: 'publications',
  columns: {
    contentId: {
      ...uuid('content_id'),
      primary: true,
      primaryKeyConstraintName: 'pk_publications',
    },
    revision: { type: 'integer' },
    publishedBy: uuid('published_by'),
    publishedAt: timestamp('published_at'),
  },
  foreignKeys: [
    {
      name: 'fk_publications_revision',
      target: 'ContentRevision',
      columnNames: ['contentId', 'revision'],
      referencedColumnNames: ['contentId', 'revision'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_publications_actor',
      target: 'User',
      columnNames: ['publishedBy'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    { name: 'ix_publications_revision', columns: ['contentId', 'revision'] },
    { name: 'ix_publications_actor', columns: ['publishedBy'] },
    { name: 'ix_publications_feed', columns: ['publishedAt', 'contentId'] },
  ],
});
export const ContentRelationEntity = new EntitySchema<ContentRelation>({
  name: 'ContentRelation',
  tableName: 'content_relations',
  columns: {
    id: primary('content_relations'),
    contentId: uuid('content_id'),
    revision: { type: 'integer' },
    characterId: uuid('character_id', true),
    gameVersionId: uuid('game_version_id', true),
  },
  foreignKeys: [
    {
      name: 'fk_relations_revision',
      target: 'ContentRevision',
      columnNames: ['contentId', 'revision'],
      referencedColumnNames: ['contentId', 'revision'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_relations_character',
      target: 'Character',
      columnNames: ['characterId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_relations_patch',
      target: 'GameVersion',
      columnNames: ['gameVersionId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  uniques: [
    { name: 'uq_relations_character', columns: ['contentId', 'revision', 'characterId'] },
    { name: 'uq_relations_patch', columns: ['contentId', 'revision', 'gameVersionId'] },
  ],
  indices: [
    { name: 'ix_relations_character', columns: ['characterId'] },
    { name: 'ix_relations_patch', columns: ['gameVersionId'] },
  ],
  checks: [
    {
      name: 'ck_relations_target',
      expression: '(character_id IS NOT NULL)::int + (game_version_id IS NOT NULL)::int=1',
    },
  ],
});
export const contentEntities = [
  ContentEntity,
  ContentRevisionEntity,
  PublicationEntity,
  ContentRelationEntity,
];
