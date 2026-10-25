import { EntitySchema } from 'typeorm';

export interface Team {
  id: string;
  gameId: string;
  slug: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  mainCharacterId: string;
  supportOneId: string;
  supportTwoId: string;
  createdAt: Date;
  updatedAt: Date;
}
export const TeamEntity = new EntitySchema<Team>({
  name: 'Team',
  tableName: 'teams',
  columns: {
    id: { type: 'uuid', primary: true, primaryKeyConstraintName: 'pk_teams' },
    gameId: { name: 'game_id', type: 'uuid' },
    slug: { type: 'varchar', length: 100 },
    name: { type: 'varchar', length: 150 },
    description: { type: 'varchar', length: 2000, default: '' },
    status: { type: 'varchar', length: 16, default: 'draft' },
    version: { type: 'integer', default: 1 },
    mainCharacterId: { name: 'main_character_id', type: 'uuid' },
    supportOneId: { name: 'support_one_id', type: 'uuid' },
    supportTwoId: { name: 'support_two_id', type: 'uuid' },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
    updatedAt: { name: 'updated_at', type: 'timestamptz', default: () => 'now()' },
  },
  foreignKeys: [
    {
      name: 'fk_teams_game',
      target: 'Game',
      columnNames: ['gameId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    ...(['mainCharacterId', 'supportOneId', 'supportTwoId'] as const).map((field, index) => ({
      name: ['fk_teams_main', 'fk_teams_support_one', 'fk_teams_support_two'][index],
      target: 'Character',
      columnNames: [field, 'gameId'],
      referencedColumnNames: ['id', 'gameId'],
      onDelete: 'RESTRICT' as const,
    })),
  ],
  uniques: [
    { name: 'uq_teams_slug', columns: ['gameId', 'slug'] },
    {
      name: 'uq_teams_lineup',
      columns: ['gameId', 'mainCharacterId', 'supportOneId', 'supportTwoId'],
    },
  ],
  indices: [
    {
      name: 'uq_teams_wiki_reference',
      columns: ['id', 'gameId'],
      unique: true,
      synchronize: false,
    },
    { name: 'ix_teams_public', columns: ['gameId', 'status', 'name', 'id'] },
    { name: 'ix_teams_main', columns: ['mainCharacterId'] },
    { name: 'ix_teams_support_one', columns: ['supportOneId'] },
    { name: 'ix_teams_support_two', columns: ['supportTwoId'] },
  ],
  checks: [
    { name: 'ck_teams_status', expression: "status IN ('draft', 'published', 'archived')" },
    { name: 'ck_teams_version', expression: 'version > 0' },
    { name: 'ck_teams_slug', expression: "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'" },
    {
      name: 'ck_teams_members',
      expression:
        'main_character_id <> support_one_id AND main_character_id <> support_two_id AND support_one_id < support_two_id',
    },
  ],
});
