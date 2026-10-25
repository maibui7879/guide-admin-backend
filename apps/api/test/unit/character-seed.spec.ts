import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRoster, plainSkill, RosterSnapshot } from '../../src/database/seeds/stella-source';
import { characterInput } from '../../src/modules/catalog/services/catalog-writer.service';

describe('Stella Sora source snapshot', () => {
  const snapshot = JSON.parse(
    readFileSync(resolve(__dirname, '../../src/database/fixtures/stella-sora-roster.json'), 'utf8'),
  ) as RosterSnapshot;
  it('contains 41 unique validated characters and four skills each', () => {
    expect(snapshot.characters).toHaveLength(41);
    expect(new Set(snapshot.characters.map((c) => c.sourceId)).size).toBe(41);
    expect(new Set(snapshot.characters.map((c) => c.slug)).size).toBe(41);
    for (const { sourceId, ...character } of snapshot.characters) {
      expect(sourceId).toBeGreaterThan(0);
      expect(characterInput.safeParse(character).success).toBe(true);
      expect(character.skills.map((s) => s.kind)).toEqual([
        'normal',
        'main',
        'support',
        'ultimate',
      ]);
      expect(character.stats.every((s) => s.level === 1)).toBe(true);
      expect(character.talents).toHaveLength(5);
      expect(character.talents!.every((talent) => talent.boosts.length > 0)).toBe(true);
      expect(new Set(character.potentials!.map((potential) => potential.category))).toEqual(
        new Set(['mainCore', 'mainNormal', 'common', 'supportCore', 'supportNormal']),
      );
    }
    expect(snapshot.characters.reduce((count, c) => count + c.talents!.length, 0)).toBe(205);
    expect(snapshot.characters.reduce((count, c) => count + c.potentials!.length, 0)).toBe(1189);
  });
  it('retains released Firstlight Noya without inventing missing DEF', () => {
    const noya = snapshot.characters.find((c) => c.sourceId === 162)!;
    expect(noya.slug).toBe('firstlight-noya');
    expect(noya.stats.some((s) => s.code === 'DEF')).toBe(false);
    expect(snapshot.source.staleUnreleasedIds).toEqual([]);
    expect(snapshot.source.excludedUnreleasedIds).toEqual([121, 161]);
  });
  it('removes game markup while preserving comparisons and parameter progressions', () => {
    expect(
      plainSkill('<color=#fff>Power</color> < Decibels =100 ##Burn#2013# &Param1&', ['10%/20%']),
    ).toContain('Power < Decibels =100 Burn Parameter 1');
    expect(plainSkill('&Param1&', ['10%/20%'])).toContain('Parameter 1: 10%/20%');
    expect(() => plainSkill('&Param2&', ['10%'])).toThrow('Missing source skill parameter');
  });
  it('rejects invalid source revisions before importing', () => {
    expect(() => buildRoster('{}', '{}', 'main', snapshot.source.verifiedAt)).toThrow(
      'full source commit',
    );
  });
});
