import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  createContentInput,
  editContentInput,
} from '../../src/modules/guides/domain/content-input';
import { GUIDE_CATEGORIES } from '../../src/modules/guides/domain/guide-category';
import { GuidesQuery } from '../../src/modules/guides/dto/content-query.dto';

const revision = {
  title: 'Test guide',
  description: 'Category validation',
  body: { type: 'doc', content: [{ type: 'paragraph' }] },
};
describe('guide category contract', () => {
  it.each(GUIDE_CATEGORIES)(
    'accepts %s consistently for creation, editing and filtering',
    (category) => {
      expect(
        createContentInput.safeParse({
          ...revision,
          category,
          gameId: 'dd4a9b95-f886-4f61-9f29-f87748ea7034',
          slug: 'test',
          wiki: { kind: 'game' },
        }).success,
      ).toBe(true);
      expect(
        editContentInput.safeParse({ ...revision, category, expectedRevision: 1 }).success,
      ).toBe(true);
      expect(validateSync(plainToInstance(GuidesQuery, { category }))).toEqual([]);
    },
  );
  it.each(['characters', 'character-guide', 'Character', 'unknown', '', ['boss']])(
    'rejects aliases and invalid categories: %s',
    (category) => {
      expect(
        editContentInput.safeParse({ ...revision, category, expectedRevision: 1 }).success,
      ).toBe(false);
      expect(validateSync(plainToInstance(GuidesQuery, { category })).length).toBeGreaterThan(0);
    },
  );
});
