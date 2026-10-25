import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import type { TalentInput, PotentialInput } from '../domain/progression-input';
import { CharacterTalentEntity, CharacterPotentialEntity } from '../entities/progression.entities';

// The caller holds the parent row lock. Omitted collections preserve existing data;
// an explicit empty array clears that collection, matching full-replacement writes.
export async function writeProgression(
  manager: EntityManager,
  characterId: string,
  talents?: TalentInput[],
  potentials?: PotentialInput[],
) {
  if (talents !== undefined) {
    await manager.getRepository(CharacterTalentEntity).delete({ characterId });
    if (talents.length)
      await manager.getRepository(CharacterTalentEntity).insert(
        talents.map((talent, position) => ({
          id: randomUUID(),
          characterId,
          position,
          ...talent,
        })),
      );
  }
  if (potentials !== undefined) {
    await manager.getRepository(CharacterPotentialEntity).delete({ characterId });
    if (potentials.length)
      await manager.getRepository(CharacterPotentialEntity).insert(
        potentials.map((potential, position) => ({
          id: randomUUID(),
          characterId,
          position,
          ...potential,
        })),
      );
  }
}
