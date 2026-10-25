import { EntitySchema } from 'typeorm';
export interface Media {
  id: string;
  gameId: string;
  uploadedBy: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: Date;
  checksum: string | null;
  deletedAt: Date | null;
}
export interface RevisionMedia {
  contentId: string;
  revision: number;
  mediaId: string;
  gameId: string;
}
export const MediaEntity = new EntitySchema<Media>({
  name: 'Media',
  tableName: 'media_assets',
  columns: {
    id: { type: 'uuid', primary: true, primaryKeyConstraintName: 'pk_media_assets' },
    gameId: { type: 'uuid', name: 'game_id' },
    uploadedBy: { type: 'uuid', name: 'uploaded_by' },
    storageKey: { type: 'varchar', length: 150, name: 'storage_key' },
    mimeType: { type: 'varchar', length: 30, name: 'mime_type' },
    byteSize: { type: 'integer', name: 'byte_size' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    createdAt: { type: 'timestamptz', name: 'created_at', default: () => 'now()' },
    checksum: { type: 'varchar', length: 64, nullable: true },
    deletedAt: { type: 'timestamptz', name: 'deleted_at', nullable: true },
  },
  foreignKeys: [
    {
      name: 'fk_media_game',
      target: 'Game',
      columnNames: ['gameId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_media_uploader',
      target: 'User',
      columnNames: ['uploadedBy'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  uniques: [
    { name: 'uq_media_storage', columns: ['storageKey'] },
    { name: 'uq_media_game_reference', columns: ['id', 'gameId'] },
  ],
  indices: [
    { name: 'ix_media_game', columns: ['gameId', 'createdAt'] },
    { name: 'ix_media_uploader', columns: ['uploadedBy'] },
  ],
  checks: [
    { name: 'ck_media_checksum', expression: "checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'" },
    {
      name: 'ck_media_image',
      expression:
        "mime_type='image/webp' AND byte_size BETWEEN 1 AND 5242880 AND width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192 AND width::bigint*height<=16777216",
    },
  ],
});
export const RevisionMediaEntity = new EntitySchema<RevisionMedia>({
  name: 'RevisionMedia',
  tableName: 'content_revision_media',
  columns: {
    contentId: {
      type: 'uuid',
      name: 'content_id',
      primary: true,
      primaryKeyConstraintName: 'pk_content_revision_media',
    },
    revision: {
      type: 'integer',
      primary: true,
      primaryKeyConstraintName: 'pk_content_revision_media',
    },
    mediaId: {
      type: 'uuid',
      name: 'media_id',
      primary: true,
      primaryKeyConstraintName: 'pk_content_revision_media',
    },
    gameId: { type: 'uuid', name: 'game_id' },
  },
  foreignKeys: [
    {
      name: 'fk_revision_media_revision',
      target: 'ContentRevision',
      columnNames: ['contentId', 'revision'],
      referencedColumnNames: ['contentId', 'revision'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_revision_media_content_game',
      target: 'Content',
      columnNames: ['contentId', 'gameId'],
      referencedColumnNames: ['id', 'gameId'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_revision_media_asset_game',
      target: 'Media',
      columnNames: ['mediaId', 'gameId'],
      referencedColumnNames: ['id', 'gameId'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [{ name: 'ix_revision_media_asset', columns: ['mediaId', 'gameId'] }],
});
export const mediaEntities = [MediaEntity, RevisionMediaEntity];
