# Code structure and commit checks

The NestJS API is a modular monolith. Each feature owns its controllers, services,
DTOs, entity schemas and Swagger examples. Module files register dependencies;
controllers handle HTTP input/output; services handle application rules and database
operations. Keep dependencies explicit through Nest dependency injection.

```text
apps/api/src/
  app.module.ts                 Application composition
  main.ts                       HTTP startup
  cli/                          Seed, migration checks, bootstrap and OpenAPI export
  common/
    dto/                        Shared pagination
    http/                       HTTP setup and exception filter
    swagger/                    Shared response schemas and documentation setup
    validation/                 Shared request schema parsing
  config/                       Environment validation
  database/                     Connection, lifecycle, fixtures and migrations
  modules/
    health/                     Liveness and readiness
    auth/
      controllers/              Authentication and staff administration
      decorators/               Public/session/permission metadata
      dto/                      Authentication and staff request/response schemas
      entities/                 Identity entity schemas
      guards/                   Session and permission enforcement
      security/                 Password hashing
      services/                 Authentication, sessions and staff rules
      swagger/                  Shared authentication documentation decorators
    catalog/
      controllers/              Public reads and protected catalog writes
      dto/                      Query, response and write schemas
      entities/                 Catalog entity schemas
      services/                 Catalog queries and transactional writes
      swagger/                  Catalog documentation examples
    guides/
      controllers/              Staff CMS and public publications
      domain/                   Workflow, editor schema and safe renderer
      dto/                      CMS and public guide contracts
      entities/                 Content, revisions, relations and publication
      services/                 Scoped access, reads and transactional commands
      swagger/                  CMS command documentation
    audit/                      Transaction-bound append-only content audit
    teams/
      controllers/              Public reads and scoped staff CRUD
      domain/                   Lineup and concurrency validation
      dto/                      Team write/read contracts and queries
      entities/                 Stable team identity and member slots
      services/                 Transactional writes, access and public visibility
```

Tests remain under `apps/api/test/unit` and `apps/api/test/e2e`. CLI scripts use the
same services as HTTP handlers. Use the root package scripts instead of referencing
internal TypeScript paths directly. Database migrations retain their original names
and order.

## Before each commit

`pnpm install` runs `prepare` to enable Husky. Installation is skipped on CI and
production installs. Git runs `.husky/pre-commit`, which executes:

1. lint-staged: Prettier formats supported staged files; ESLint fixes staged API
   TypeScript. Successful changes are automatically added back to the index.
2. ESLint checks all API source and tests.
3. Jest runs the complete unit suite, without a database connection.

Any failed step blocks the commit. lint-staged manages partially staged files and
restores its changes when a staged task fails. On a repository without an initial
commit it cannot create a backup stash; review the first commit carefully.

Run `pnpm precommit` to execute the same checks manually. It uses local Node binaries,
so the hook does not require a globally installed pnpm. Git/IDE commits need Node.js
24.7+ available on PATH.

Formatting covers API TypeScript/configuration and root tooling files. Generated
OpenAPI, the preserved demo export, lockfile and environment secrets are excluded.
E2E remains a separate `pnpm test:e2e` command because it requires PostgreSQL; CI runs
both test suites, formatting, lint, type checks and build validation.
