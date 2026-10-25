export const sampleGame = {
  id: '19b0a236-8f5a-423e-8d45-a8279db3ed85',
  slug: 'stella-sora',
  name: 'Stella Sora',
  metadata: {},
};
export const sampleCharacter = {
  id: '03d6b90a-69ca-43bb-80a4-5dbff11b8e78',
  slug: 'allie',
  name: 'Allie',
  element: 'Aqua',
  rarity: 5,
  role: 'Vanguard',
  portraitUrl: '/assets/allie-portrait.webp',
};
export const sampleProfile = {
  ...sampleCharacter,
  imageUrl: '/assets/allie.webp',
  voice: null,
  mechanicsSchemaVersion: 1,
  mechanics: { attackType: 'Melee' },
  aliases: [],
  stats: [],
  skills: [],
  talents: [],
  potentials: [],
  sources: [
    {
      url: 'https://www.kaiden.gg/stella-sora/characters/allie/',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    },
  ],
};

export function pageExamples(item: unknown) {
  return {
    populated: {
      summary: 'Illustrative one-record result',
      value: { data: [item], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } },
    },
    empty: {
      summary: 'No published records match',
      value: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    },
    beyondLastPage: {
      summary: 'Requested page is beyond the last page',
      value: { data: [], meta: { page: 2, limit: 20, total: 1, totalPages: 1 } },
    },
  };
}
