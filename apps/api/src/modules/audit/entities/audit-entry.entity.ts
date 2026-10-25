import { EntitySchema } from 'typeorm';

export interface AuditEntry {
  id: string;
  actorId: string;
  contentId: string;
  action: string;
  version: number;
  revision: number;
  requestId: string;
  details: Record<string, unknown>;
  createdAt: Date;
}
export const AuditEntryEntity = new EntitySchema<AuditEntry>({
  name: 'AuditEntry',
  tableName: 'audit_entries',
  columns: {
    id: { type: 'uuid', primary: true, primaryKeyConstraintName: 'pk_audit_entries' },
    actorId: { name: 'actor_id', type: 'uuid' },
    contentId: { name: 'content_id', type: 'uuid' },
    action: { type: 'varchar', length: 32 },
    version: { type: 'integer' },
    revision: { type: 'integer' },
    requestId: { name: 'request_id', type: 'varchar', length: 64 },
    details: { type: 'jsonb', default: {} },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
  },
  foreignKeys: [
    {
      name: 'fk_audit_actor',
      target: 'User',
      columnNames: ['actorId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'fk_audit_content',
      target: 'Content',
      columnNames: ['contentId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  uniques: [{ name: 'uq_audit_version', columns: ['contentId', 'version'] }],
  indices: [{ name: 'ix_audit_actor', columns: ['actorId'] }],
  checks: [{ name: 'ck_audit_details', expression: "jsonb_typeof(details)='object'" }],
});
