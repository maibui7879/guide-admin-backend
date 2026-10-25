import { EntitySchema } from 'typeorm';
import type { TalentInput, PotentialInput } from '../domain/progression-input';

export interface CharacterTalent extends TalentInput {
  id: string;
  characterId: string;
  position: number;
}
export interface CharacterPotential extends PotentialInput {
  id: string;
  characterId: string;
  position: number;
}
const columns = {
  id: { type: 'uuid' as const, primary: true },
  characterId: { type: 'uuid' as const, name: 'character_id' },
  position: { type: 'integer' as const },
  name: { type: 'varchar' as const, length: 150 },
};
const foreignKeys = (table: string) => [
  {
    name: `fk_${table}_character`,
    target: 'Character',
    columnNames: ['characterId'],
    referencedColumnNames: ['id'],
    onDelete: 'CASCADE' as const,
  },
];
export const CharacterTalentEntity = new EntitySchema<CharacterTalent>({
  name: 'CharacterTalent',
  tableName: 'character_talents',
  columns: {
    ...columns,
    id: { ...columns.id, primaryKeyConstraintName: 'pk_character_talents' },
    boosts: { type: 'jsonb' },
  },
  foreignKeys: foreignKeys('character_talents'),
  uniques: [{ name: 'uq_talent_position', columns: ['characterId', 'position'] }],
  checks: [
    { name: 'ck_talent_position', expression: 'position >= 0' },
    {
      name: 'ck_talent_boosts',
      expression: "jsonb_typeof(boosts) = 'array' AND jsonb_array_length(boosts) BETWEEN 1 AND 100",
    },
  ],
});
export const CharacterPotentialEntity = new EntitySchema<CharacterPotential>({
  name: 'CharacterPotential',
  tableName: 'character_potentials',
  columns: {
    ...columns,
    id: { ...columns.id, primaryKeyConstraintName: 'pk_character_potentials' },
    sourceId: { type: 'integer', name: 'source_id', nullable: true },
    category: { type: 'varchar', length: 20 },
    description: { type: 'text' },
    params: { type: 'jsonb' },
    hiddenParams: { type: 'jsonb', name: 'hidden_params' },
    icon: { type: 'varchar', length: 150, nullable: true },
    rarity: { type: 'varchar', length: 16, nullable: true },
    corner: { type: 'varchar', length: 16, nullable: true },
  },
  foreignKeys: foreignKeys('character_potentials'),
  uniques: [
    { name: 'uq_potential_position', columns: ['characterId', 'position'] },
    { name: 'uq_potential_source', columns: ['characterId', 'sourceId'] },
  ],
  checks: [
    { name: 'ck_potential_position', expression: 'position >= 0' },
    { name: 'ck_potential_source', expression: 'source_id > 0' },
    {
      name: 'ck_potential_category',
      expression:
        "category IN ('mainCore', 'mainNormal', 'common', 'supportCore', 'supportNormal')",
    },
    {
      name: 'ck_potential_params',
      expression: "jsonb_typeof(params) = 'array' AND jsonb_typeof(hidden_params) = 'array'",
    },
    { name: 'ck_potential_rarity', expression: "rarity IN ('core', 'common', 'rare')" },
    { name: 'ck_potential_corner', expression: "corner IN ('Diamond', 'Triangle', 'Round')" },
  ],
});
