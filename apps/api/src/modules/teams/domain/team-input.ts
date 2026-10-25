import { z } from 'zod';

export const teamFields = {
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).default(''),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  mainCharacterId: z.uuid().transform((value) => value.toLowerCase()),
  supportCharacterIds: z.array(z.uuid().transform((value) => value.toLowerCase())).length(2),
};
const distinct = (value: { mainCharacterId: string; supportCharacterIds: string[] }) =>
  new Set([value.mainCharacterId, ...value.supportCharacterIds]).size === 3;
export const createTeamInput = z
  .object(teamFields)
  .strict()
  .refine(distinct, 'Three distinct characters are required');
export const replaceTeamInput = z
  .object({ ...teamFields, expectedVersion: z.number().int().min(1).max(2147483646) })
  .strict()
  .refine(distinct);
export const deleteTeamInput = z
  .object({ expectedVersion: z.number().int().min(1).max(2147483646) })
  .strict();

export type TeamInput = z.infer<typeof createTeamInput>;
