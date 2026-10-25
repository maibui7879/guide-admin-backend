import { ApiProperty } from '@nestjs/swagger';
import { WIKI_TOPICS } from '../domain/wiki-identity';
export const wikiCreateSchema = {
  oneOf: ['game', 'character', 'team'].map((kind) => ({
    type: 'object' as const,
    additionalProperties: false,
    required:
      kind === 'game' ? ['kind'] : ['kind', kind === 'character' ? 'characterId' : 'teamId'],
    properties: {
      kind: { type: 'string', enum: [kind] },
      topic: { type: 'string', enum: [...WIKI_TOPICS], default: 'overview' },
      ...(kind === 'game'
        ? {}
        : {
            [kind === 'character' ? 'characterId' : 'teamId']: { type: 'string', format: 'uuid' },
          }),
    },
  })),
  description:
    'Required, immutable wiki identity. One page per game + subject + controlled topic, including drafts and archived pages. Category is editorial metadata and does not change this identity. Targets must belong to the game.',
};
export class WikiIdentityDto {
  @ApiProperty({ enum: ['game', 'character', 'team'] }) kind!: 'game' | 'character' | 'team';
  @ApiProperty({ enum: WIKI_TOPICS }) topic!: (typeof WIKI_TOPICS)[number];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) characterId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) teamId!: string | null;
  @ApiProperty({
    description: 'Canonical key scoped to gameId; stable across edits, publication and archive.',
    example: 'character:03d6b90a-69ca-43bb-80a4-5dbff11b8e78:build',
  })
  key!: string;
}
