export const GUIDE_CATEGORIES = [
  'character',
  'team',
  'boss',
  'general',
  'beginner',
  'combat',
  'progression',
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];
