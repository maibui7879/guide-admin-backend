import { z } from 'zod';

export const potentialCategories = [
  'mainCore',
  'mainNormal',
  'common',
  'supportCore',
  'supportNormal',
] as const;
const parameters = z.array(z.union([z.string().max(10000), z.number().finite()])).max(100);
export const talentBoostInput = z
  .object({
    name: z.string().trim().min(1).max(150).nullable().default(null),
    description: z.string().trim().min(1).max(20000),
    params: parameters.default([]),
    hiddenParams: parameters.default([]),
  })
  .strict();
export const talentInput = z
  .object({
    name: z.string().trim().min(1).max(150),
    boosts: z.array(talentBoostInput).min(1).max(100),
  })
  .strict();
export const potentialInput = z
  .object({
    sourceId: z.number().int().positive().max(2147483647).nullable().default(null),
    category: z.enum(potentialCategories),
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().min(1).max(20000),
    params: parameters.default([]),
    hiddenParams: parameters.default([]),
    icon: z.string().min(1).max(150).nullable().default(null),
    rarity: z.enum(['core', 'common', 'rare']).nullable().default(null),
    corner: z.enum(['Diamond', 'Triangle', 'Round']).nullable().default(null),
  })
  .strict();
export const talentsInput = z.array(talentInput).max(30);
export const potentialsInput = z
  .array(potentialInput)
  .max(100)
  .refine((items) => {
    const ids = items.flatMap((item) => (item.sourceId === null ? [] : [item.sourceId]));
    return new Set(ids).size === ids.length;
  }, 'Duplicate potential source IDs');
export type TalentBoost = z.infer<typeof talentBoostInput>;
export type TalentInput = z.infer<typeof talentInput>;
export type PotentialInput = z.infer<typeof potentialInput>;
