import { parseEnvironment } from '../../src/config/env';
export const fixture = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://atlas:password@localhost:5432/atlas',
  SESSION_SECRET: 'a'.repeat(40),
  CORS_ORIGINS: 'http://localhost:3001',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'test',
  STORAGE_REGION: 'auto',
  STORAGE_ACCESS_KEY: 'test',
  STORAGE_SECRET_KEY: 'test',
  LOG_LEVEL: 'silent',
};
describe('environment boundary', () => {
  it('parses typed configuration', () => {
    expect(parseEnvironment(fixture).PORT).toBe(3000);
  });
  it('defaults to certificate verification', () => {
    expect(parseEnvironment(fixture).DATABASE_SSL_INSECURE).toBe(false);
  });
  it.each(['test', 'production'])('rejects insecure TLS in %s', (NODE_ENV) => {
    expect(() => parseEnvironment({ ...fixture, NODE_ENV, DATABASE_SSL_INSECURE: 'true' })).toThrow(
      'DATABASE_SSL_INSECURE requires development',
    );
  });
  it('allows the explicit development override', () => {
    expect(
      parseEnvironment({ ...fixture, NODE_ENV: 'development', DATABASE_SSL_INSECURE: 'true' })
        .DATABASE_SSL_INSECURE,
    ).toBe(true);
  });
  it.each([
    { PORT: '0' },
    { DATABASE_URL: 'https://example.com' },
    { SESSION_SECRET: 'short' },
    { CORS_ORIGINS: '*,https://example.com' },
  ])('rejects unsafe configuration %j', (invalid) => {
    expect(() => parseEnvironment({ ...fixture, ...invalid })).toThrow('Invalid environment');
  });
  it('does not leak configuration values', () => {
    expect(() => parseEnvironment({ ...fixture, DATABASE_URL: 'secret-value' })).toThrow(
      'Invalid environment: DATABASE_URL',
    );
  });
  it('allows explicitly configured wildcard CORS in production while retaining HTTPS for API origin', () => {
    const env = {
      ...fixture,
      NODE_ENV: 'production',
      API_ORIGIN: 'https://api.example.com',
      CORS_ORIGINS: '*',
      STORAGE_ENDPOINT: 'https://storage.example.com',
    };
    expect(parseEnvironment(env).CORS_ORIGINS).toEqual(['*']);
    expect(() => parseEnvironment({ ...env, API_ORIGIN: 'http://localhost:3000' })).toThrow(
      'production origins require HTTPS',
    );
  });
});
