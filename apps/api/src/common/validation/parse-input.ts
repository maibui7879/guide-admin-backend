import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BadRequestException('Invalid input');
  return parsed.data;
}
