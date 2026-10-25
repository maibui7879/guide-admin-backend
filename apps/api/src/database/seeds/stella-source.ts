import { createHash } from 'node:crypto';
import { z } from 'zod';
import { characterInput } from '../../modules/catalog/services/catalog-writer.service';
import { potentialCategories } from '../../modules/catalog/domain/progression-input';

const skill = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  params: z.array(z.union([z.string(), z.number().finite()])).default([]),
});
const boost = skill.extend({
  name: z.string().optional(),
  hiddenParams: z.array(z.union([z.string(), z.number().finite()])).default([]),
});
const potential = boost.extend({
  id: z.number().int().positive(),
  name: z.string().min(1),
  icon: z.string().optional(),
  rarity: z.enum(['core', 'common', 'rare']).optional(),
  corner: z.enum(['Diamond', 'Triangle', 'Round']).optional(),
});
const sourceCharacter = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  star: z.union([z.literal(4), z.literal(5)]),
  element: z.enum(['Ignis', 'Aqua', 'Ventus', 'Terra', 'Lux', 'Umbra']),
  class: z.enum(['Vanguard', 'Versatile', 'Support']),
  attackType: z.enum(['Melee', 'Ranged']),
  cnCv: z.string().default(''),
  jpCv: z.string().default(''),
  normalAtk: skill,
  skill,
  supportSkill: skill,
  ultimate: skill,
  talent: z.array(z.object({ name: z.string().min(1), boost: z.array(boost).min(1) })),
  potential: z
    .object({
      mainCore: z.array(potential),
      mainNormal: z.array(potential),
      common: z.array(potential),
      supportCore: z.array(potential),
      supportNormal: z.array(potential),
    })
    .strict(),
  stat: z
    .array(
      z.object({
        Level: z.number().int().positive(),
        HP: z.number().nonnegative().finite(),
        ATK: z.number().nonnegative().finite(),
        DEF: z.number().nonnegative().finite().optional(),
        'Crit Rate': z.string(),
        'Crit DMG': z.string(),
        'Resilience Break Efficiency': z.string(),
        'VUL Exploit': z.string(),
      }),
    )
    .min(1),
});

export function plainSkill(description: string, params: (string | number)[]): string {
  const text = description
    .replace(/<\/?color(?:=[^>]*)?>/g, '')
    .replaceAll('\\u000b', '\n')
    .replaceAll(String.fromCharCode(11), '\n')
    .replace(/##([^#]+)#\d+#/g, '$1')
    .replace(/&Param(\d+)&/g, (_match, index: string) => {
      if (params[Number(index) - 1] === undefined)
        throw new Error('Missing source skill parameter');
      return `Parameter ${index}`;
    })
    .trim();
  const legend = params.map((value, index) => `Parameter ${index + 1}: ${value}`).join('\n');
  return (
    text +
    (legend
      ? '\n\nSource parameter values (slash-separated progressions retained; no assumed skill level):\n' +
        legend
      : '')
  );
}

export function buildRoster(
  raw: string,
  unreleasedRaw: string,
  commit: string,
  verifiedAt: string,
) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full source commit SHA is required');
  z.iso.datetime().parse(verifiedAt);
  const source = z.record(z.string(), sourceCharacter).parse(JSON.parse(raw));
  const unreleased = z.record(z.string(), z.unknown()).parse(JSON.parse(unreleasedRaw));
  const sourceUrl = `https://github.com/AutumnVN/ss-data/blob/${commit}/character.json`;
  const slugs = new Set<string>();
  const characters = Object.entries(source).map(([key, character]) => {
    if (String(character.id) !== key) throw new Error('Source character ID mismatch');
    const slug = character.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (slugs.has(slug)) throw new Error('Duplicate source slug');
    slugs.add(slug);
    const base = character.stat.filter((row) => row.Level === 1);
    if (base.length !== 1) throw new Error('Ambiguous level-one base stats');
    const row = base[0];
    const stats = [
      ...(['HP', 'ATK', 'DEF'] as const).flatMap((code) =>
        row[code] === undefined ? [] : [{ code, value: row[code], level: 1 }],
      ),
      ...(['Crit Rate', 'Crit DMG', 'Resilience Break Efficiency', 'VUL Exploit'] as const).map(
        (key) => {
          const value = row[key];
          if (!/^\d+(?:\.\d+)?%$/.test(value)) throw new Error('Invalid percentage stat');
          return {
            code: key.toUpperCase().replaceAll(' ', '_') + '_PERCENT',
            value: Number(value.slice(0, -1)),
            level: 1,
          };
        },
      ),
    ];
    const kinds = [
      ['normalAtk', 'normal'],
      ['skill', 'main'],
      ['supportSkill', 'support'],
      ['ultimate', 'ultimate'],
    ] as const;
    const value = characterInput.parse({
      slug,
      name: character.name,
      rarity: character.star,
      element: character.element,
      role: character.class,
      status: 'published',
      portraitUrl: `/assets/${slug}-portrait.webp`,
      imageUrl: `/assets/${slug}.webp`,
      voice:
        [
          character.jpCv ? `JP: ${character.jpCv}` : '',
          character.cnCv ? `CN: ${character.cnCv}` : '',
        ]
          .filter(Boolean)
          .join('; ') || null,
      mechanics: { attackType: character.attackType },
      sourceUrl,
      verifiedAt,
      stats,
      talents: character.talent.map((talent) => ({
        name: talent.name,
        boosts: talent.boost.map((boost) => ({
          name: boost.name || null,
          description: plainProgression(boost.desc, boost.params, boost.hiddenParams),
          params: boost.params,
          hiddenParams: boost.hiddenParams,
        })),
      })),
      potentials: potentialCategories.flatMap((category) =>
        character.potential[category].map((potential) => ({
          sourceId: potential.id,
          category,
          name: potential.name,
          description: plainProgression(potential.desc, potential.params, potential.hiddenParams),
          params: potential.params,
          hiddenParams: potential.hiddenParams,
          icon: potential.icon ?? null,
          rarity: potential.rarity ?? null,
          corner: potential.corner ?? null,
        })),
      ),
      skills: kinds.map(([field, kind]) => ({
        kind,
        name: character[field].name,
        description: plainSkill(character[field].desc, character[field].params),
      })),
    });
    return { sourceId: character.id, ...value };
  });
  return {
    source: {
      repository: 'https://github.com/AutumnVN/ss-data',
      commit,
      language: 'EN',
      sourceUrl,
      verifiedAt,
      sha256: createHash('sha256').update(raw).digest('hex'),
      unreleasedSha256: createHash('sha256').update(unreleasedRaw).digest('hex'),
      excludedUnreleasedIds: Object.keys(unreleased)
        .filter((id) => !source[id])
        .map(Number),
      staleUnreleasedIds: Object.keys(unreleased)
        .filter((id) => source[id])
        .map(Number),
      scope:
        'All released characters, four skills, ordered talent boost groups and all five potential categories. Level 1 stats only; percentage codes store percentage points. Parameters and hidden parameters retain source progressions without assumed skill level. Ambiguous higher-level ascension rows are not flattened.',
    },
    characters,
  };
}

export type RosterSnapshot = ReturnType<typeof buildRoster>;

export function plainProgression(
  description: string,
  params: (string | number)[],
  hiddenParams: (string | number)[],
): string {
  const text = description.replace(/&HiddenParam(\d+)&/g, (_match, index: string) => {
    if (hiddenParams[Number(index) - 1] === undefined)
      throw new Error('Missing source hidden parameter');
    return `Hidden parameter ${index}`;
  });
  const legend = hiddenParams
    .map((value, index) => `Hidden parameter ${index + 1}: ${value}`)
    .join('\n');
  return plainSkill(text, params) + (legend ? `\n\n${legend}` : '');
}
