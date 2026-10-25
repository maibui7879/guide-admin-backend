import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyStaging } from './verify-staging.mjs';

const environment = {
  STAGING_API_ORIGIN: 'https://api.staging.example.com',
  STAGING_WEB_ORIGIN: 'https://staging.example.com',
};
function fixture({ insecureCookie = false, publicAdmin = false, publicDocs = false } = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    const headers = new Headers({
      'x-request-id': 'fixture',
      'x-content-type-options': 'nosniff',
      'strict-transport-security': 'max-age=31536000',
    });
    let status = 200,
      body = { data: [] };
    if (path === '/api/v1/admin/operations/metrics' && !publicAdmin) {
      status = 401;
      body = { error: { code: 'UNAUTHENTICATED' } };
      headers.set('cache-control', 'no-store');
    }
    if (path === '/api/v1/admin/auth/csrf') {
      headers.set('access-control-allow-origin', options.headers.Origin);
      headers.set('access-control-allow-credentials', 'true');
      headers.set(
        'set-cookie',
        `atlas_login_csrf=synthetic; Path=/api/v1/admin; HttpOnly; SameSite=Strict${insecureCookie ? '' : '; Secure'}`,
      );
    }
    if (path.startsWith('/docs') && !publicDocs) status = 404;
    return new Response(JSON.stringify(body), { status, headers });
  };
}
for (const [name, options] of [
  ['secure staging', {}],
  ['insecure cookie', { insecureCookie: true }],
  ['public admin', { publicAdmin: true }],
  ['public docs', { publicDocs: true }],
]) {
  test(name, async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = fixture(options);
    try {
      if (name === 'secure staging')
        assert.equal((await verifyStaging(environment)).stagingVerification, 'passed');
      else await assert.rejects(verifyStaging(environment));
    } finally {
      globalThis.fetch = previous;
    }
  });
}
test('rejects HTTP and credential-bearing origins before contacting staging', async () => {
  await assert.rejects(
    verifyStaging({ ...environment, STAGING_API_ORIGIN: 'http://api.staging.example.com' }),
  );
  await assert.rejects(
    verifyStaging({
      ...environment,
      STAGING_API_ORIGIN: 'https://user:secret@api.staging.example.com',
    }),
  );
});
