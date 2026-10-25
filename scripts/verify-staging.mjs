import { pathToFileURL } from 'node:url';

export async function verifyStaging(input = process.env) {
  const api = new URL(input.STAGING_API_ORIGIN || ''),
    web = new URL(input.STAGING_WEB_ORIGIN || '');
  if ([api, web].some((u) => u.protocol !== 'https:' || u.origin !== u.href.replace(/\/$/, '')))
    throw new Error('Staging requires HTTPS origins without paths or credentials');
  const slug = input.STAGING_GAME_SLUG || 'stella-sora';
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid staging game slug');
  const checks = [];
  async function request(path, status, options = {}) {
    const response = await fetch(api.origin + path, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== status || !response.headers.get('x-request-id'))
      throw new Error('Unexpected status or missing request ID: ' + path);
    if (
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      !response.headers.has('strict-transport-security')
    )
      throw new Error('Missing security headers: ' + path);
    return response;
  }
  for (const path of [
    '/health/live',
    '/health/ready',
    `/api/v1/games/${slug}/characters?limit=1`,
    `/api/v1/games/${slug}/search?q=character`,
  ]) {
    const response = await request(path, 200);
    await response.body?.cancel();
    checks.push(path);
  }
  const anonymous = await request('/api/v1/admin/operations/metrics', 401);
  const error = await anonymous.json();
  if (
    error.error?.code !== 'UNAUTHENTICATED' ||
    anonymous.headers.get('cache-control') !== 'no-store'
  )
    throw new Error('Admin authorization/cache boundary failed');
  checks.push('anonymous-admin-denied');
  const challenge = await request('/api/v1/admin/auth/csrf', 200, {
    headers: { Origin: web.origin },
  });
  if (
    challenge.headers.get('access-control-allow-origin') !== web.origin ||
    challenge.headers.get('access-control-allow-credentials') !== 'true'
  )
    throw new Error('Allowed-origin CORS failed');
  const cookie = challenge.headers
    .getSetCookie()
    .find((value) => value.startsWith('atlas_login_csrf='));
  if (
    !cookie ||
    !/;\s*Secure(?:;|$)/i.test(cookie) ||
    !/;\s*HttpOnly(?:;|$)/i.test(cookie) ||
    !/;\s*SameSite=Strict(?:;|$)/i.test(cookie) ||
    !/;\s*Path=\/api\/v1\/admin(?:;|$)/i.test(cookie) ||
    /;\s*Domain=/i.test(cookie)
  )
    throw new Error('Unsafe challenge cookie');
  await challenge.body?.cancel();
  checks.push('allowed-cors-and-secure-cookie');
  const blocked = await fetch(api.origin + '/health/live', {
    headers: { Origin: 'https://untrusted.invalid' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  await blocked.body?.cancel();
  if (
    blocked.headers.get('access-control-allow-origin') === '*' ||
    blocked.headers.get('access-control-allow-origin') === 'https://untrusted.invalid'
  )
    throw new Error('Untrusted origin allowed');
  checks.push('untrusted-origin-blocked');
  for (const path of ['/docs', '/docs-json']) {
    const response = await request(path, 404);
    await response.body?.cancel();
  }
  checks.push('production-swagger-disabled');
  return { stagingVerification: 'passed', checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyStaging().then(
    (result) => console.log(JSON.stringify(result)),
    () => {
      console.error(
        'Staging verification failed. Check HTTPS, readiness, game data, CORS, cookies and production-mode documentation settings.',
      );
      process.exitCode = 1;
    },
  );
}
