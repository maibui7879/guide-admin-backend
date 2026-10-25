import { randomUUID } from 'node:crypto';
import { wikiInput, wikiIdentity } from '../../src/modules/guides/domain/wiki-identity';
import {
  createContentInput,
  editContentInput,
} from '../../src/modules/guides/domain/content-input';
const characterId = randomUUID();
describe('Wiki identity', () => {
  it('defaults only the controlled topic and rejects ambiguous targets', () => {
    expect(wikiInput.parse({ kind: 'character', characterId })).toEqual({
      kind: 'character',
      characterId,
      topic: 'overview',
    });
    for (const input of [
      { kind: 'character' },
      { kind: 'game', characterId },
      { kind: 'team', characterId },
      { kind: 'game', topic: 'my-other-copy' },
      { kind: 'boss' },
    ])
      expect(wikiInput.safeParse(input).success).toBe(false);
  });
  it('creates the same canonical key independent of slug, author and category', () => {
    expect(
      wikiIdentity({
        wikiKind: 'character',
        wikiTopic: 'build',
        wikiCharacterId: characterId,
        wikiTeamId: null,
      }).key,
    ).toBe(`character:${characterId}:build`);
  });
  it('requires identity on create but prevents changing it through a revision', () => {
    const fields = { title: 'Example', description: 'Example', category: 'general', body: {} };
    expect(
      createContentInput.safeParse({ ...fields, gameId: randomUUID(), slug: 'example' }).success,
    ).toBe(false);
    expect(
      editContentInput.safeParse({ ...fields, expectedRevision: 1, wiki: { kind: 'game' } })
        .success,
    ).toBe(false);
  });
});
