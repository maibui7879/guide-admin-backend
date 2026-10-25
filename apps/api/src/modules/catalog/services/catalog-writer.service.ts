import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { z } from 'zod';
import { talentsInput, potentialsInput } from '../domain/progression-input';
import { writeProgression } from './write-progression';
import {
  CharacterEntity,
  CharacterAliasEntity,
  CharacterStatEntity,
  GameEntity,
  GameVersionEntity,
  SkillEntity,
} from '../entities/catalog.entities';

const slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const label = z.string().trim().min(1).max(150);
const asset = z
  .string()
  .max(2048)
  .refine(
    (s) => (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(s) && !s.includes('..')) || /^https:\/\//.test(s),
  )
  .nullable()
  .default(null);
export const characterInput = z
  .object({
    slug,
    name: label,
    rarity: z.union([z.literal(4), z.literal(5)]),
    element: z.enum(['Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra']),
    role: z.string().trim().min(1).max(50).nullable().default(null),
    status: z.enum(['draft', 'published', 'archived']).default('draft'),
    portraitUrl: asset,
    imageUrl: asset,
    voice: label.nullable().default(null),
    sourceUrl: z.url().startsWith('https://').max(2048).nullable().default(null),
    verifiedAt: z.iso.datetime().nullable().default(null),
    mechanicsSchemaVersion: z.literal(1).default(1),
    mechanics: z
      .object({ attackType: z.enum(['Melee', 'Ranged']).optional() })
      .strict()
      .default({}),
    aliases: z
      .array(label)
      .max(30)
      .default([])
      .refine((a) => new Set(a).size === a.length, 'Duplicate aliases'),
    talents: talentsInput.optional(),
    potentials: potentialsInput.optional(),
    stats: z
      .array(
        z
          .object({
            code: z.string().min(1).max(50),
            value: z.number().nonnegative().finite(),
            level: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    skills: z
      .array(
        z
          .object({
            name: label,
            kind: z.enum(['normal', 'main', 'support', 'ultimate']),
            description: z.string().trim().min(1).max(5000),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict()
  .refine(
    (v) => v.status !== 'published' || Boolean(v.sourceUrl && v.verifiedAt),
    'Published records require verified provenance',
  );

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('Invalid catalog input');
  return result.data;
}

// Internal application interface; HTTP callers require the Phase 3 auth/resource guards.
@Injectable()
export class CatalogWriterService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async createGame(input: unknown) {
    const value = validated(
      z
        .object({
          slug,
          name: label,
          status: z.enum(['active', 'archived']).default('active'),
          metadata: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
      input,
    );
    return this.translate(() =>
      this.db.getRepository(GameEntity).save({ id: randomUUID(), ...value }),
    );
  }
  async createVersion(gameId: string, input: unknown) {
    validated(z.uuid(), gameId);
    const value = validated(
      z
        .object({
          version: z.string().min(1).max(100),
          releaseDate: z.iso.date().nullable().default(null),
          status: z.enum(['draft', 'published', 'archived']).default('draft'),
        })
        .strict(),
      input,
    );
    return this.translate(() =>
      this.db.getRepository(GameVersionEntity).save({ id: randomUUID(), gameId, ...value }),
    );
  }
  async writeCharacter(
    gameId: string,
    input: unknown,
    id?: string,
    authorize?: (manager: EntityManager) => Promise<void>,
    transaction?: EntityManager,
  ) {
    validated(z.uuid(), gameId);
    if (id) validated(z.uuid(), id);
    const value = validated(characterInput, input);
    const { aliases, stats, skills, talents, potentials, ...fields } = value;
    const write = async (manager: EntityManager) => {
      if (authorize) await authorize(manager);
      if (
        id &&
        !(await manager
          .getRepository(CharacterEntity)
          .findOne({ where: { id, gameId }, lock: { mode: 'pessimistic_write' } }))
      ) {
        throw new NotFoundException('Character not found');
      }
      const character = await manager.getRepository(CharacterEntity).save({
        id: id ?? randomUUID(),
        gameId,
        ...fields,
        verifiedAt: fields.verifiedAt ? new Date(fields.verifiedAt) : null,
        updatedAt: new Date(),
      });
      if (id) {
        await manager.getRepository(CharacterAliasEntity).delete({ characterId: id });
        await manager.getRepository(CharacterStatEntity).delete({ characterId: id });
        await manager.getRepository(SkillEntity).delete({ characterId: id });
      }
      if (aliases.length)
        await manager.getRepository(CharacterAliasEntity).insert(
          aliases.map((alias, position) => ({
            id: randomUUID(),
            characterId: character.id,
            alias,
            position,
          })),
        );
      if (stats.length)
        await manager.getRepository(CharacterStatEntity).insert(
          stats.map((stat, position) => ({
            id: randomUUID(),
            characterId: character.id,
            ...stat,
            position,
          })),
        );
      if (skills.length)
        await manager.getRepository(SkillEntity).insert(
          skills.map((skill, position) => ({
            id: randomUUID(),
            characterId: character.id,
            ...skill,
            position,
          })),
        );
      await writeProgression(manager, character.id, talents, potentials);
      return character;
    };
    return this.translate(() => (transaction ? write(transaction) : this.db.transaction(write)));
  }
  private async translate<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const code = (error.driverError as { code?: string }).code;
        if (code === '23505') throw new ConflictException('Catalog entry already exists');
        if (code === '23503' || code === '23514')
          throw new BadRequestException('Invalid catalog relation or value');
      }
      throw error;
    }
  }
}
