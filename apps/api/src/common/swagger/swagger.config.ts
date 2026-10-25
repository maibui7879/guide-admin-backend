import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createApiDocument(app: INestApplication) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Stella Atlas API')
      .setVersion('1.0.0')
      .setDescription(
        'Stella Atlas REST API. Public catalog, published guides and health endpoints allow anonymous reads. Admin endpoints require a database-backed HttpOnly session cookie and server-side permissions.\n\nCatalog responses use `{data}` or `{data, meta}`. Health responses use `{status}`. Errors use `{error: {code, message, requestId, details}}`. Only active games and published catalog records are public. Collection queries reject unknown fields. Pagination defaults to page 1 and limit 20 (maximum 100).\n\nAdmin login: GET `/api/v1/admin/auth/csrf`, keep its cookie, then POST `/api/v1/admin/auth/login` with JSON credentials and `X-CSRF-Token`. Every mutation requires an allowed `Origin`. Subsequent mutations use the CSRF token from the login/session response. Cookie storage is automatic in browsers; do not put session tokens in localStorage. Role changes revoke sessions. Auth/admin responses are no-store.\n\nEvery response carries `X-Request-Id`. Session expiry/rotation, RBAC, game grants and draft-only editor rules are enforced server-side. Guide CMS supports immutable revisions, review, approval, publish/unpublish, archive and restore. ADMIN/EDITOR/REVIEWER permissions and game grants apply. Authors cannot approve their own revision. Published snapshots remain visible while newer drafts change. Every CMS mutation requires expectedRevision equal to the latest content version (not the body snapshot number currentRevision). A stale token returns 409 CONFLICT. Admin previews and revision history are authenticated, no-store and noindex.',
      )
      .addServer('/', 'Current API origin')
      .addTag(
        'catalog',
        'Published games, patch versions and character records. Pagination is deterministic.',
      )
      .addTag(
        'health',
        'Service liveness and database readiness. Responses do not use the catalog data envelope.',
      )
      .addTag(
        'admin auth',
        'Login challenge, session lifecycle and logout. Cookies are Secure in production, HttpOnly and SameSite=Strict.',
      )
      .addTag('admin users', 'Staff creation, role assignments and scoped game access. ADMIN only.')
      .addTag(
        'admin catalog',
        'Protected catalog writes. Editors may only manage drafts in assigned active games.',
      )
      .addTag(
        'guides',
        'Published guide snapshots only; drafts and historical revisions are private.',
      )
      .addTag(
        'admin contents',
        'Game-scoped guide CMS, immutable history, review workflow, atomic publication and audit.',
      )
      .addTag(
        'teams',
        'Published canonical teams: one Main and two Supports, with all members published.',
      )
      .addTag(
        'admin teams',
        'Game-scoped team CRUD, optimistic concurrency and archive-based deletion.',
      )
      .addCookieAuth('atlas_session', { type: 'apiKey', in: 'cookie' }, 'atlasSession')
      .build(),
    { operationIdFactory: (_controller, method) => method },
  );
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/api/v1/admin/')) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = item[method];
      if (!operation) continue;
      for (const response of Object.values(operation.responses)) {
        if (!response || '$ref' in response) continue;
        response.headers = {
          ...response.headers,
          'X-Robots-Tag': {
            description: 'Admin and preview responses must not be indexed.',
            schema: { type: 'string', enum: ['noindex, nofollow'] },
          },
          'Cache-Control': {
            description: 'Admin responses are not cached.',
            schema: { type: 'string', enum: ['no-store'] },
          },
        };
      }
    }
  }
  return document;
}

export function configureSwagger(app: INestApplication, environment: string): void {
  if (environment === 'production') return;
  SwaggerModule.setup('docs', app, createApiDocument(app), {
    customSiteTitle: 'Stella Atlas API reference',
    jsonDocumentUrl: 'docs-json',
    yamlDocumentUrl: 'docs-yaml',
    swaggerOptions: {
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      deepLinking: true,
      persistAuthorization: false,
      withCredentials: true,
    },
  });
}
