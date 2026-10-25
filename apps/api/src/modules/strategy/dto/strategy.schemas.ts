import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
export const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const text = (maxLength: number): SchemaObject => ({ type: 'string', maxLength });
export const expectedSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: { expectedVersion: { type: 'integer', minimum: 1, maximum: 2147483646 } },
};
export const equipmentSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'category', 'rarity'],
  properties: {
    name: { ...text(150), minLength: 1 },
    category: { type: 'string', enum: ['disc', 'weapon', 'armor', 'accessory'] },
    rarity: { type: 'integer', minimum: 1, maximum: 6 },
    description: { ...text(10000), default: '' },
    imageUrl: { type: 'string', format: 'uri', nullable: true },
    sourceUrl: { type: 'string', format: 'uri', nullable: true },
    verifiedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};
const common = {
  title: { ...text(150), minLength: 1 },
  description: { ...text(1000), minLength: 1 },
  gameVersionId: { ...uuid, nullable: true },
};
export const buildSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'recommendations'],
  properties: {
    ...common,
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['equipmentId', 'slot', 'rank'],
        properties: {
          equipmentId: uuid,
          slot: { type: 'string', enum: ['main', 'support', 'alternative'] },
          rank: { type: 'integer', minimum: 1, maximum: 100 },
          notes: { ...text(2000), default: '' },
        },
      },
    },
  },
};
export const tierSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'scope', 'categories'],
  properties: {
    ...common,
    scope: { ...text(200), minLength: 1 },
    categories: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'entries'],
        properties: {
          key: { type: 'string', maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          title: { ...text(100), minLength: 1 },
          entries: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['characterId', 'explanation'],
              properties: { characterId: uuid, explanation: { ...text(2000), minLength: 1 } },
            },
          },
        },
      },
    },
  },
};
export const headSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'gameId',
    'slug',
    'kind',
    'state',
    'version',
    'currentRevision',
    'publishedRevision',
    'characterId',
  ],
  properties: {
    id: uuid,
    gameId: uuid,
    slug: text(100),
    kind: { type: 'string', enum: ['build', 'tier_list'] },
    state: { type: 'string', enum: ['draft', 'published', 'archived'] },
    version: { type: 'integer', minimum: 1 },
    currentRevision: { type: 'integer', minimum: 1 },
    publishedRevision: { type: 'integer', nullable: true },
    characterId: { ...uuid, nullable: true },
  },
};
export const equipmentRecordSchema: SchemaObject = {
  type: 'object',
  properties: {
    ...equipmentSchema.properties,
    id: uuid,
    gameId: uuid,
    slug: text(100),
    version: { type: 'integer' },
    status: { type: 'string', enum: ['draft', 'published', 'archived'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export const envelope = (data: SchemaObject, page = false): SchemaObject => ({
  type: 'object',
  required: page ? ['data', 'meta'] : ['data'],
  properties: {
    data: page ? { type: 'array', items: data } : data,
    ...(page
      ? {
          meta: {
            type: 'object',
            required: ['page', 'limit', 'total', 'totalPages'],
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        }
      : {}),
  },
});
