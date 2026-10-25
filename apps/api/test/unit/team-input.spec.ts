import { randomUUID } from 'node:crypto';
import {
  createTeamInput,
  replaceTeamInput,
  deleteTeamInput,
} from '../../src/modules/teams/domain/team-input';

const main = randomUUID();
const supports = [randomUUID(), randomUUID()];
const fields = {
  slug: 'test-team',
  name: 'Test team',
  mainCharacterId: main,
  supportCharacterIds: supports,
};
describe('team write boundary', () => {
  it('accepts a main and exactly two distinct supports, normalizing UUID casing', () => {
    expect(createTeamInput.parse({ ...fields, mainCharacterId: main.toUpperCase() })).toMatchObject(
      { ...fields, status: 'draft', description: '' },
    );
  });
  it.each(
    [
      [],
      [supports[0]],
      [...supports, randomUUID()],
      [main, supports[0]],
      [supports[0], supports[0].toUpperCase()],
    ].map((supportCharacterIds) => ({ supportCharacterIds })),
  )('rejects invalid membership %j', ({ supportCharacterIds }) => {
    expect(createTeamInput.safeParse({ ...fields, supportCharacterIds }).success).toBe(false);
  });
  it('requires bounded concurrency tokens and rejects mass assignment', () => {
    expect(replaceTeamInput.safeParse(fields).success).toBe(false);
    expect(replaceTeamInput.safeParse({ ...fields, expectedVersion: 1 }).success).toBe(true);
    expect(deleteTeamInput.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(deleteTeamInput.safeParse({ expectedVersion: 2147483647 }).success).toBe(false);
    expect(
      createTeamInput.safeParse({ ...fields, gameId: randomUUID(), id: randomUUID() }).success,
    ).toBe(false);
  });
});
