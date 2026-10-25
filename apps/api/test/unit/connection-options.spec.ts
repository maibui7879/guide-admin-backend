import { connectionOptions } from '../../src/database/connection-options';

describe('database TLS override', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:password@localhost/db?sslmode=require&application_name=atlas',
    NODE_ENV: 'development' as const,
    DATABASE_SSL_INSECURE: false,
  };
  it('preserves default TLS settings', () => {
    expect(connectionOptions(base)).toEqual({ url: base.DATABASE_URL });
  });
  it('keeps TLS enabled but removes URL overrides in development', () => {
    const result = connectionOptions({ ...base, DATABASE_SSL_INSECURE: true });
    expect(result.ssl).toEqual({ rejectUnauthorized: false });
    expect(new URL(result.url).searchParams.has('sslmode')).toBe(false);
    expect(new URL(result.url).searchParams.get('application_name')).toBe('atlas');
  });
  it('refuses insecure TLS outside development', () => {
    expect(() =>
      connectionOptions({ ...base, NODE_ENV: 'production', DATABASE_SSL_INSECURE: true }),
    ).toThrow();
  });
  it('forces certificate verification in production even when URL SSL parameters request otherwise', () => {
    const result = connectionOptions({
      ...base,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@localhost/db?sslmode=disable',
    });
    expect(result.ssl).toEqual({ rejectUnauthorized: true });
    expect(new URL(result.url).searchParams.has('sslmode')).toBe(false);
  });
});
