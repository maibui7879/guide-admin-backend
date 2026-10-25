import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine((v) => /^postgres(ql)?:/.test(v)),
  DATABASE_SSL_INSECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_SECRET: z.string().min(32),
  SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
  SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(60).max(604800).default(28800),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  API_ORIGIN: z
    .url()
    .refine((v) => new URL(v).origin === v)
    .default('http://localhost:3000'),
  CORS_ORIGINS: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine(
      (v) =>
        (v.length === 1 && v[0] === '*') ||
        (v.length > 0 &&
          v.every((s) => {
            try {
              return new URL(s).origin === s;
            } catch {
              return false;
            }
          })),
    ),
  STORAGE_ENDPOINT: z.url(),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_REGION: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  REDIS_URL: z
    .url()
    .refine((v) => ['redis:', 'rediss:'].includes(new URL(v).protocol))
    .optional(),
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100000).default(300),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});
export type Environment = z.infer<typeof schema>;
export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid environment: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  if (result.data.DATABASE_SSL_INSECURE && result.data.NODE_ENV !== 'development') {
    throw new Error('Invalid environment: DATABASE_SSL_INSECURE requires development');
  }
  if (result.data.SESSION_IDLE_SECONDS > result.data.SESSION_ABSOLUTE_SECONDS)
    throw new Error('Invalid environment: session idle lifetime exceeds absolute lifetime');
  if (
    result.data.NODE_ENV === 'production' &&
    [result.data.API_ORIGIN, ...result.data.CORS_ORIGINS.filter((origin) => origin !== '*')].some(
      (v) => !v.startsWith('https://'),
    )
  )
    throw new Error('Invalid environment: production origins require HTTPS');
  if (result.data.NODE_ENV === 'production' && result.data.SESSION_SECRET.startsWith('replace-')) {
    throw new Error('Invalid environment: SESSION_SECRET placeholder');
  }
  if (result.data.NODE_ENV === 'production' && !result.data.STORAGE_ENDPOINT.startsWith('https://'))
    throw new Error('Invalid environment: production storage requires HTTPS');
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.REDIS_URL &&
    !result.data.REDIS_URL.startsWith('rediss://')
  )
    throw new Error('Invalid environment: production Redis requires TLS');
  return result.data;
}
