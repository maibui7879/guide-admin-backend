import { EntitySchema, EntitySchemaColumnOptions } from 'typeorm';

const uuid = (table: string): EntitySchemaColumnOptions => ({
  type: 'uuid',
  primary: true,
  primaryKeyConstraintName: `pk_${table}`,
});
const time = (name: string): EntitySchemaColumnOptions => ({
  name,
  type: 'timestamptz',
  default: () => 'now()',
});
export const UserEntity = new EntitySchema({
  name: 'User',
  tableName: 'users',
  columns: {
    id: uuid('users'),
    email: { type: 'varchar', length: 254 },
    passwordHash: { name: 'password_hash', type: 'varchar', length: 512 },
    isActive: { name: 'is_active', type: 'boolean', default: true },
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  uniques: [{ name: 'uq_users_email', columns: ['email'] }],
  checks: [{ name: 'ck_users_email', expression: 'email = lower(email)' }],
});
export const RoleEntity = new EntitySchema({
  name: 'Role',
  tableName: 'roles',
  columns: {
    code: { type: 'varchar', length: 32, primary: true, primaryKeyConstraintName: 'pk_roles' },
  },
});
export const PermissionEntity = new EntitySchema({
  name: 'Permission',
  tableName: 'permissions',
  columns: {
    code: {
      type: 'varchar',
      length: 64,
      primary: true,
      primaryKeyConstraintName: 'pk_permissions',
    },
  },
});
export const UserRoleEntity = new EntitySchema({
  name: 'UserRole',
  tableName: 'user_roles',
  columns: {
    userId: {
      name: 'user_id',
      type: 'uuid',
      primary: true,
      primaryKeyConstraintName: 'pk_user_roles',
    },
    roleCode: {
      name: 'role_code',
      type: 'varchar',
      length: 32,
      primary: true,
      primaryKeyConstraintName: 'pk_user_roles',
    },
  },
  foreignKeys: [
    {
      name: 'fk_user_roles_user',
      target: 'User',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
    {
      name: 'fk_user_roles_role',
      target: 'Role',
      columnNames: ['roleCode'],
      referencedColumnNames: ['code'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [{ name: 'ix_user_roles_role', columns: ['roleCode'] }],
});
export const RolePermissionEntity = new EntitySchema({
  name: 'RolePermission',
  tableName: 'role_permissions',
  columns: {
    roleCode: {
      name: 'role_code',
      type: 'varchar',
      length: 32,
      primary: true,
      primaryKeyConstraintName: 'pk_role_permissions',
    },
    permissionCode: {
      name: 'permission_code',
      type: 'varchar',
      length: 64,
      primary: true,
      primaryKeyConstraintName: 'pk_role_permissions',
    },
  },
  foreignKeys: [
    {
      name: 'fk_role_permissions_role',
      target: 'Role',
      columnNames: ['roleCode'],
      referencedColumnNames: ['code'],
      onDelete: 'CASCADE',
    },
    {
      name: 'fk_role_permissions_permission',
      target: 'Permission',
      columnNames: ['permissionCode'],
      referencedColumnNames: ['code'],
      onDelete: 'CASCADE',
    },
  ],
  indices: [{ name: 'ix_role_permissions_permission', columns: ['permissionCode'] }],
});
export const UserGameEntity = new EntitySchema({
  name: 'UserGameAccess',
  tableName: 'user_game_access',
  columns: {
    userId: {
      name: 'user_id',
      type: 'uuid',
      primary: true,
      primaryKeyConstraintName: 'pk_user_game_access',
    },
    gameId: {
      name: 'game_id',
      type: 'uuid',
      primary: true,
      primaryKeyConstraintName: 'pk_user_game_access',
    },
  },
  foreignKeys: [
    {
      name: 'fk_user_game_user',
      target: 'User',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
    {
      name: 'fk_user_game_game',
      target: 'Game',
      columnNames: ['gameId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
  indices: [{ name: 'ix_user_game_game', columns: ['gameId'] }],
});
export const SessionEntity = new EntitySchema({
  name: 'Session',
  tableName: 'sessions',
  columns: {
    id: uuid('sessions'),
    userId: { name: 'user_id', type: 'uuid' },
    tokenHash: { name: 'token_hash', type: 'varchar', length: 64 },
    createdAt: time('created_at'),
    lastSeenAt: time('last_seen_at'),
    absoluteExpiresAt: { name: 'absolute_expires_at', type: 'timestamptz' },
    idleExpiresAt: { name: 'idle_expires_at', type: 'timestamptz' },
    revokedAt: { name: 'revoked_at', type: 'timestamptz', nullable: true },
  },
  foreignKeys: [
    {
      name: 'fk_sessions_user',
      target: 'User',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
  uniques: [{ name: 'uq_sessions_token', columns: ['tokenHash'] }],
  indices: [
    { name: 'ix_sessions_user', columns: ['userId'] },
    { name: 'ix_sessions_expiry', columns: ['absoluteExpiresAt'] },
  ],
  checks: [{ name: 'ck_sessions_expiry', expression: 'idle_expires_at <= absolute_expires_at' }],
});
export const LoginBucketEntity = new EntitySchema({
  name: 'LoginBucket',
  tableName: 'login_buckets',
  columns: {
    key: {
      type: 'varchar',
      length: 64,
      primary: true,
      primaryKeyConstraintName: 'pk_login_buckets',
    },
    windowStartedAt: { name: 'window_started_at', type: 'timestamptz' },
    attempts: { type: 'integer' },
  },
  indices: [{ name: 'ix_login_buckets_window', columns: ['windowStartedAt'] }],
  checks: [{ name: 'ck_login_attempts', expression: 'attempts > 0' }],
});

export const authEntities = [
  UserEntity,
  RoleEntity,
  PermissionEntity,
  UserRoleEntity,
  RolePermissionEntity,
  UserGameEntity,
  SessionEntity,
  LoginBucketEntity,
];
export const rolePermissions = {
  ADMIN: [
    'catalog:write',
    'catalog:draft:write',
    'users:manage',
    'content:write',
    'content:review',
    'content:publish',
  ],
  EDITOR: ['catalog:draft:write', 'content:write'],
  REVIEWER: ['content:review'],
} as const;
export type Role = keyof typeof rolePermissions;
