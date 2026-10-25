import { z } from 'zod';
import { safeHttpsUrl } from '../../guides/domain/rich-document';

export const slugInput = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const expectedVersionInput = z
  .object({ expectedVersion: z.number().int().positive().max(2147483646) })
  .strict();
const source = z.string().transform(safeHttpsUrl).nullable().default(null);
export const equipmentInput = z
  .object({
    name: z.string().trim().min(1).max(150),
    category: z.enum(['disc', 'weapon', 'armor', 'accessory']),
    rarity: z.number().int().min(1).max(6),
    description: z.string().trim().max(10000).default(''),
    imageUrl: source,
    sourceUrl: source,
    verifiedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const createEquipmentInput = equipmentInput.extend({ slug: slugInput }).strict();
export const replaceEquipmentInput = equipmentInput.extend(expectedVersionInput.shape).strict();
const editorialFields = {
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(1000),
  gameVersionId: z.uuid().nullable().default(null),
};
const recommendation = z
  .object({
    equipmentId: z.uuid(),
    slot: z.enum(['main', 'support', 'alternative']),
    rank: z.number().int().min(1).max(100),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict();
export const buildPayload = z
  .object({
    ...editorialFields,
    recommendations: z
      .array(recommendation)
      .min(1)
      .max(100)
      .superRefine((rows, ctx) => {
        for (const key of [
          rows.map((r) => `${r.slot}:${r.rank}`),
          rows.map((r) => `${r.slot}:${r.equipmentId}`),
        ])
          if (new Set(key).size !== key.length)
            ctx.addIssue({ code: 'custom', message: 'Duplicate equipment or rank within a slot' });
      }),
  })
  .strict();
const tierEntry = z
  .object({ characterId: z.uuid(), explanation: z.string().trim().min(1).max(2000) })
  .strict();
export const tierPayload = z
  .object({
    ...editorialFields,
    scope: z.string().trim().min(1).max(200),
    categories: z
      .array(
        z
          .object({
            key: slugInput,
            title: z.string().trim().min(1).max(100),
            entries: z.array(tierEntry).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.categories.map((c) => c.key),
      ids = value.categories.flatMap((c) => c.entries.map((e) => e.characterId));
    if (
      new Set(keys).size !== keys.length ||
      new Set(ids).size !== ids.length ||
      ids.length === 0 ||
      ids.length > 500
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Tier keys and character placements must be unique; require 1 to 500 entries',
      });
  });
export const createBuildInput = z
  .object({ slug: slugInput, characterId: z.uuid(), payload: buildPayload })
  .strict();
export const createTierInput = z.object({ slug: slugInput, payload: tierPayload }).strict();
export const replaceBuildInput = expectedVersionInput.extend({ payload: buildPayload }).strict();
export const replaceTierInput = expectedVersionInput.extend({ payload: tierPayload }).strict();
export type StrategyKind = 'build' | 'tier_list';
export type StrategyPayload = z.infer<typeof buildPayload> | z.infer<typeof tierPayload>;
