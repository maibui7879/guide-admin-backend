import { EntitySchema, EntitySchemaColumnOptions } from 'typeorm';
import { CharacterTalentEntity, CharacterPotentialEntity } from './progression.entities';

export interface BaseRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface Game extends BaseRecord {
  slug: string;
  name: string;
  status: string;
  metadata: Record<string, unknown>;
}
export interface GameVersion extends BaseRecord {
  gameId: string;
  version: string;
  releaseDate: string | null;
  status: string;
}
export interface Character extends BaseRecord {
  gameId: string;
  slug: string;
  name: string;
  status: string;
  rarity: number;
  element: string;
  role: string | null;
  portraitUrl: string | null;
  imageUrl: string | null;
  voice: string | null;
  sourceUrl: string | null;
  verifiedAt: Date | null;
  mechanicsSchemaVersion: number;
  mechanics: { attackType?: 'Melee' | 'Ranged' };
}
export interface CharacterAlias {
  id: string;
  characterId: string;
  alias: string;
  position: number;
}
export interface CharacterStat {
  id: string;
  characterId: string;
  code: string;
  value: number;
  level: number;
  position: number;
}
export interface Skill {
  id: string;
  characterId: string;
  name: string;
  kind: string;
  description: string;
  position: number;
}

const base = (table: string): Record<string, EntitySchemaColumnOptions> => ({
  id: { type: 'uuid', primary: true, primaryKeyConstraintName: `pk_${table}` },
  createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
  updatedAt: { name: 'updated_at', type: 'timestamptz', default: () => 'now()' },
});
const varchar = (length: number, name?: string, nullable = false): EntitySchemaColumnOptions => ({
  type: 'varchar',
  length,
  name,
  nullable,
});

export const GameEntity = new EntitySchema<Game>({
  name: 'Game',
  tableName: 'games',
  columns: {
    ...base('games'),
    slug: varchar(100),
    name: varchar(150),
    status: { type: 'varchar', length: 16, default: 'active' },
    metadata: { type: 'jsonb', default: {} },
  },
  uniques: [{ name: 'uq_games_slug', columns: ['slug'] }],
  checks: [
    { name: 'ck_games_status', expression: "status IN ('active', 'archived')" },
    { name: 'ck_games_metadata', expression: "jsonb_typeof(metadata) = 'object'" },
  ],
});

export const GameVersionEntity = new EntitySchema<GameVersion>({
  name: 'GameVersion',
  tableName: 'game_versions',
  columns: {
    ...base('game_versions'),
    gameId: { name: 'game_id', type: 'uuid' },
    version: varchar(100),
    releaseDate: { name: 'release_date', type: 'date', nullable: true },
    status: { type: 'varchar', length: 16, default: 'draft' },
  },
  foreignKeys: [
    {
      name: 'fk_versions_game',
      target: 'Game',
      columnNames: ['gameId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
  uniques: [{ name: 'uq_versions_game_version', columns: ['gameId', 'version'] }],
  indices: [{ name: 'uq_patch_strategy_reference', synchronize: false }],
  checks: [
    { name: 'ck_versions_status', expression: "status IN ('draft', 'published', 'archived')" },
  ],
});

export const CharacterEntity = new EntitySchema<Character>({
  name: 'Character',
  tableName: 'characters',
  columns: {
    ...base('characters'),
    gameId: { name: 'game_id', type: 'uuid' },
    slug: varchar(100),
    name: varchar(150),
    status: { type: 'varchar', length: 16, default: 'draft' },
    rarity: { type: 'smallint' },
    element: varchar(16),
    role: varchar(50, undefined, true),
    portraitUrl: varchar(2048, 'portrait_url', true),
    imageUrl: varchar(2048, 'image_url', true),
    voice: varchar(150, undefined, true),
    sourceUrl: varchar(2048, 'source_url', true),
    verifiedAt: { name: 'verified_at', type: 'timestamptz', nullable: true },
    mechanicsSchemaVersion: { name: 'mechanics_schema_version', type: 'smallint', default: 1 },
    mechanics: { type: 'jsonb', default: {} },
  },
  foreignKeys: [
    {
      name: 'fk_characters_game',
      target: 'Game',
      columnNames: ['gameId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
  uniques: [{ name: 'uq_characters_game_slug', columns: ['gameId', 'slug'] }],
  indices: [
    { name: 'ix_characters_search', synchronize: false },
    { name: 'ix_characters_catalog', columns: ['gameId', 'status', 'name', 'id'] },
    { name: 'ix_characters_element', columns: ['gameId', 'element'] },
    // Created/dropped by the Teams migration; catalog-only schemas remain independent.
    {
      name: 'uq_characters_team_reference',
      columns: ['id', 'gameId'],
      unique: true,
      synchronize: false,
    },
  ],
  checks: [
    { name: 'ck_characters_status', expression: "status IN ('draft', 'published', 'archived')" },
    { name: 'ck_characters_rarity', expression: 'rarity IN (4, 5)' },
    {
      name: 'ck_characters_element',
      expression: "element IN ('Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra')",
    },
    {
      name: 'ck_characters_mechanics',
      expression: "mechanics_schema_version = 1 AND jsonb_typeof(mechanics) = 'object'",
    },
  ],
});

const child = (table: string) => ({
  id: { type: 'uuid' as const, primary: true, primaryKeyConstraintName: `pk_${table}` },
  characterId: { name: 'character_id', type: 'uuid' as const },
  position: { type: 'integer' as const },
});
const childForeignKey = (table: string) => [
  {
    name: `fk_${table}_character`,
    target: 'Character',
    columnNames: ['characterId'],
    referencedColumnNames: ['id'],
    onDelete: 'CASCADE' as const,
  },
];
export const CharacterAliasEntity = new EntitySchema<CharacterAlias>({
  name: 'CharacterAlias',
  tableName: 'character_aliases',
  columns: { ...child('character_aliases'), alias: varchar(150) },
  foreignKeys: childForeignKey('character_aliases'),
  indices: [{ name: 'ix_aliases_search', synchronize: false }],
  uniques: [
    { name: 'uq_alias_name', columns: ['characterId', 'alias'] },
    { name: 'uq_alias_position', columns: ['characterId', 'position'] },
  ],
  checks: [{ name: 'ck_alias_position', expression: 'position >= 0' }],
});
export const CharacterStatEntity = new EntitySchema<CharacterStat>({
  name: 'CharacterStat',
  tableName: 'character_stats',
  columns: {
    ...child('character_stats'),
    code: varchar(50),
    value: { type: 'double precision' },
    level: { type: 'smallint' },
  },
  foreignKeys: childForeignKey('character_stats'),
  uniques: [
    { name: 'uq_stat_code_level', columns: ['characterId', 'code', 'level'] },
    { name: 'uq_stat_position', columns: ['characterId', 'position'] },
  ],
  checks: [
    { name: 'ck_stat_value', expression: "value >= 0 AND value < 'Infinity'::float8" },
    { name: 'ck_stat_level', expression: 'level BETWEEN 1 AND 1000' },
    { name: 'ck_stat_position', expression: 'position >= 0' },
  ],
});
export const SkillEntity = new EntitySchema<Skill>({
  name: 'Skill',
  tableName: 'skills',
  columns: {
    ...child('skills'),
    name: varchar(150),
    kind: varchar(16),
    description: { type: 'text' },
  },
  foreignKeys: childForeignKey('skills'),
  uniques: [{ name: 'uq_skill_position', columns: ['characterId', 'position'] }],
  checks: [
    { name: 'ck_skill_kind', expression: "kind IN ('normal', 'main', 'support', 'ultimate')" },
    { name: 'ck_skill_position', expression: 'position >= 0' },
  ],
});

export const catalogEntities = [
  CharacterTalentEntity,
  CharacterPotentialEntity,
  GameEntity,
  GameVersionEntity,
  CharacterEntity,
  CharacterAliasEntity,
  CharacterStatEntity,
  SkillEntity,
];
