import type { Environment } from '../config/env';

type DatabaseEnvironment = Pick<Environment, 'DATABASE_URL' | 'DATABASE_SSL_INSECURE' | 'NODE_ENV'>;

export function connectionOptions(env: DatabaseEnvironment) {
  if (!env.DATABASE_SSL_INSECURE && env.NODE_ENV !== 'production') return { url: env.DATABASE_URL };
  if (env.DATABASE_SSL_INSECURE && env.NODE_ENV !== 'development')
    throw new Error('Insecure database TLS requires development');
  const url = new URL(env.DATABASE_URL);
  // pg URL SSL parameters override the explicit ssl object; remove them for this dev override.
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
    url.searchParams.delete(key);
  }
  return { url: url.toString(), ssl: { rejectUnauthorized: !env.DATABASE_SSL_INSECURE } };
}
