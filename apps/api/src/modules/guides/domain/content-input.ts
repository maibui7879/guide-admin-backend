import { z } from 'zod';
import { safeHttpsUrl } from './rich-document';
import { GUIDE_CATEGORIES } from './guide-category';
import { wikiInput } from './wiki-identity';

const uniqueIds = z
  .array(z.uuid())
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
export const revisionFields = {
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(500),
  category: z.enum(GUIDE_CATEGORIES),
  body: z.unknown(),
  schemaVersion: z.literal(1).default(1),
  characterIds: uniqueIds.default([]),
  gameVersionId: z.uuid().nullable().default(null),
  coverImageId: z.uuid().nullable().default(null),
  coverAlt: z.string().trim().max(300).default(''),
  coverCaption: z.string().trim().max(500).default(''),
  sources: z
    .array(
      z
        .object({
          url: z.string().transform(safeHttpsUrl),
          label: z.string().trim().min(1).max(150),
          verifiedAt: z.iso.datetime({ offset: true }).nullable().default(null),
        })
        .strict(),
    )
    .max(20)
    .default([]),
};
export const createContentInput = z
  .object({
    gameId: z.uuid(),
    wiki: wikiInput,
    slug: z
      .string()
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    contentType: z.literal('guide').default('guide'),
    ...revisionFields,
  })
  .strict();
export const expectedInput = z
  .object({ expectedRevision: z.number().int().positive().max(2147483646) })
  .strict();
export const editContentInput = expectedInput.extend(revisionFields).strict();
export const returnContentInput = expectedInput
  .extend({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const restoreContentInput = expectedInput
  .extend({ sourceRevision: z.number().int().positive().max(2147483647) })
  .strict();
export type RevisionInput = z.infer<typeof editContentInput>;
