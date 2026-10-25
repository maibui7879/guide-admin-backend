import { z } from 'zod';
export const WIKI_TOPICS = [
  'overview',
  'build',
  'strategy',
  'beginner',
  'combat',
  'progression',
  'boss',
] as const;
const topic = z.enum(WIKI_TOPICS).default('overview');
export const wikiInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('game'), topic }).strict(),
  z.object({ kind: z.literal('character'), characterId: z.uuid(), topic }).strict(),
  z.object({ kind: z.literal('team'), teamId: z.uuid(), topic }).strict(),
]);
export interface WikiFields {
  wikiKind: 'game' | 'character' | 'team';
  wikiTopic: (typeof WIKI_TOPICS)[number];
  wikiCharacterId: string | null;
  wikiTeamId: string | null;
}
export function wikiIdentity(content: WikiFields) {
  return {
    kind: content.wikiKind,
    topic: content.wikiTopic,
    characterId: content.wikiCharacterId,
    teamId: content.wikiTeamId,
    key: `${content.wikiKind}:${content.wikiCharacterId ?? content.wikiTeamId ?? 'game'}:${content.wikiTopic}`,
  };
}
export function presentContent<T extends WikiFields>(content: T) {
  const { wikiKind, wikiTopic, wikiCharacterId, wikiTeamId, ...fields } = content;
  return { ...fields, wiki: wikiIdentity({ wikiKind, wikiTopic, wikiCharacterId, wikiTeamId }) };
}
