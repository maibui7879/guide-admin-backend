import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import {
  CharacterEntity,
  CharacterAliasEntity,
  CharacterStatEntity,
  GameEntity,
  SkillEntity,
} from '../../modules/catalog/entities/catalog.entities';
import {
  CatalogWriterService,
  characterInput,
} from '../../modules/catalog/services/catalog-writer.service';
import { RosterSnapshot } from './stella-source';
import {
  CharacterTalentEntity,
  CharacterPotentialEntity,
} from '../../modules/catalog/entities/progression.entities';
import { writeProgression } from '../../modules/catalog/services/write-progression';
import type { TalentInput, PotentialInput } from '../../modules/catalog/domain/progression-input';

class PreserveExisting extends Error {}

export async function seedCatalog(database: DataSource) {
  const snapshot = JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/stella-sora-roster.json'), 'utf8'),
  ) as RosterSnapshot;
  const legacy = JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/stella-sora.json'), 'utf8'),
  ) as {
    verifiedAt: string;
    characters: {
      slug: string;
      name: string;
      rarity: number;
      element: string;
      role: string;
      mechanics: { attackType: string };
    }[];
  };
  const entries = snapshot.characters.map(({ sourceId, ...input }) => ({
    sourceId,
    input: characterInput.parse(input),
  }));
  if (
    new Set(entries.map((c) => c.sourceId)).size !== entries.length ||
    new Set(entries.map((c) => c.input.slug)).size !== entries.length
  )
    throw new Error('Duplicate seed identity');
  const writer = new CatalogWriterService(database);
  const game =
    (await database.getRepository(GameEntity).findOneBy({ slug: 'stella-sora' })) ??
    (await writer.createGame({ slug: 'stella-sora', name: 'Stella Sora' }));
  const result = {
    created: 0,
    upgraded: 0,
    preserved: 0,
    progressionBackfilled: 0,
    total: entries.length,
  };
  for (const { input } of entries) {
    const existing = await database
      .getRepository(CharacterEntity)
      .findOneBy({ gameId: game.id, slug: input.slug });
    try {
      await writer.writeCharacter(game.id, input, existing?.id, async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext('atlas-seed-stella-sora'))");
        const current = await manager.getRepository(CharacterEntity).findOne({
          where: { gameId: game.id, slug: input.slug },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current && !existing) return;
        if (!current || current.id !== existing?.id) throw new PreserveExisting();
        const old = legacy.characters.find((c) => c.slug === current.slug);
        if (
          !old ||
          current.sourceUrl !== `https://www.kaiden.gg/stella-sora/characters/${current.slug}/` ||
          current.verifiedAt?.toISOString() !== legacy.verifiedAt ||
          current.status !== 'published' ||
          current.voice !== null ||
          current.mechanicsSchemaVersion !== 1 ||
          current.name !== old.name ||
          current.rarity !== old.rarity ||
          current.element !== old.element ||
          current.role !== old.role ||
          JSON.stringify(current.mechanics) !== JSON.stringify(old.mechanics) ||
          current.portraitUrl !== `/assets/${current.slug}-portrait.webp` ||
          current.imageUrl !== `/assets/${current.slug}.webp`
        )
          throw new PreserveExisting();
        if (
          (await manager
            .getRepository(CharacterAliasEntity)
            .existsBy({ characterId: current.id })) ||
          (await manager
            .getRepository(CharacterStatEntity)
            .existsBy({ characterId: current.id })) ||
          (await manager.getRepository(SkillEntity).existsBy({ characterId: current.id })) ||
          (await manager
            .getRepository(CharacterTalentEntity)
            .existsBy({ characterId: current.id })) ||
          (await manager
            .getRepository(CharacterPotentialEntity)
            .existsBy({ characterId: current.id }))
        )
          throw new PreserveExisting();
      });
      if (existing) result.upgraded++;
      else result.created++;
    } catch (error) {
      if (!(error instanceof PreserveExisting)) throw error;
      result.preserved++;
      if (await backfillProgression(database, game.id, input)) result.progressionBackfilled++;
    }
  }
  const mappings = await database.getRepository(CharacterEntity).findBy({ gameId: game.id });
  await database.query(
    `INSERT INTO platform_metadata(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [
      'stella-sora-roster',
      JSON.stringify({
        source: snapshot.source,
        characters: entries.map((c) => ({
          sourceId: c.sourceId,
          slug: c.input.slug,
          characterId: mappings.find((row) => row.slug === c.input.slug)?.id,
        })),
      }),
    ],
  );
  return result;
}

async function backfillProgression(
  database: DataSource,
  gameId: string,
  input: {
    slug: string;
    sourceUrl: string | null;
    talents?: TalentInput[];
    potentials?: PotentialInput[];
  },
) {
  return database.transaction(async (manager) => {
    const current = await manager
      .getRepository(CharacterEntity)
      .findOne({ where: { gameId, slug: input.slug }, lock: { mode: 'pessimistic_write' } });
    // Add only absent collections to previously imported, published source records.
    // Other character fields, stats, skills and their UUIDs are never rewritten.
    if (
      !current ||
      current.status !== 'published' ||
      !input.sourceUrl ||
      current.sourceUrl !== input.sourceUrl
    )
      return false;
    const hasTalents = await manager
      .getRepository(CharacterTalentEntity)
      .existsBy({ characterId: current.id });
    const hasPotentials = await manager
      .getRepository(CharacterPotentialEntity)
      .existsBy({ characterId: current.id });
    const talents = hasTalents ? undefined : input.talents;
    const potentials = hasPotentials ? undefined : input.potentials;
    if (!talents?.length && !potentials?.length) return false;
    await writeProgression(manager, current.id, talents, potentials);
    return true;
  });
}
