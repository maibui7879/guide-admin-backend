import { characterInput } from '../../src/modules/catalog/services/catalog-writer.service';
import { plainProgression } from '../../src/database/seeds/stella-source';

const character = { slug: 'fixture', name: 'Fixture', rarity: 5, element: 'Aqua' };
const potential = { category: 'mainCore', name: 'Fixture', description: 'Fixture', sourceId: 123 };
describe('Character progression validation', () => {
  it('keeps omitted collections distinct from explicit empty collections', () => {
    expect(characterInput.parse(character).talents).toBeUndefined();
    expect(characterInput.parse({ ...character, talents: [], potentials: [] })).toMatchObject({
      talents: [],
      potentials: [],
    });
  });
  it.each([
    { potentials: [{ ...potential, category: 'unknown' }] },
    { potentials: [potential, potential] },
    { potentials: [{ ...potential, params: [Infinity] }] },
    { potentials: [{ ...potential, sourceId: -1 }] },
    { potentials: [{ ...potential, corner: 'invalid' }] },
    { talents: [{ name: 'Invalid', boosts: [] }] },
    { talents: [{ name: 'Invalid', boosts: [{ description: 'Fixture', unknown: true }] }] },
  ])('rejects malformed or ambiguous progression input: %j', (progression) => {
    expect(characterInput.safeParse({ ...character, ...progression }).success).toBe(false);
  });
  it('preserves hidden parameter progressions and removes game markup', () => {
    const result = plainProgression(
      '<color=#fff>&Param1&</color> &HiddenParam1&',
      ['10%/20%'],
      [3],
    );
    expect(result).toContain('Parameter 1 Hidden parameter 1');
    expect(result).toContain('Parameter 1: 10%/20%');
    expect(result).toContain('Hidden parameter 1: 3');
    expect(() => plainProgression('&HiddenParam2&', [], [3])).toThrow(
      'Missing source hidden parameter',
    );
  });
});
