# Architecture and MVP boundaries

Status: accepted foundation design, 2026-10-24; implementation follows the roadmap.

Use a NestJS TypeScript modular monolith with PostgreSQL and TypeORM migrations. Modules: auth, users, games, characters, guides, publishing, media and audit. Each module owns persistence access; other modules call its service interface. PostgreSQL remains authoritative. No Redis, queue, worker or microservices in MVP.

Public routes expose published content only. A publication points to an immutable revision; creating a newer draft does not replace the public revision. Publication and audit writes share a database transaction. Writes require expected revision numbers and return conflict errors instead of overwriting concurrent edits. Game patch versions and editorial revisions are separate.

Internal authentication uses expiring, rotated sessions in HttpOnly cookies. State-changing authenticated requests require CSRF protection. Every mutation requires server-side permissions. Phase 3 provides those protections for catalog writes; Phase 4 reuses them for guide CMS commands.

| Role | Responsibility |
| --- | --- |
| Anonymous | Read published catalog and guides |
| EDITOR | Create and edit drafts, submit for review; no approve/publish permission |
| REVIEWER | Review, approve or return drafts; no user administration |
| ADMIN | Manage users, catalog/media and publish/unpublish approved content |

Apply resource checks in addition to role permissions. Approval is tied to a specific revision and is invalidated by edits. Restoring an old revision creates a new draft; it does not bypass review. Bootstrap the first admin through an operational command with credentials supplied outside the repository.

MVP includes games/versions, character catalog, guide revisions and publishing, admin identity, media and audit, public REST contracts, migrations and CI. Equipment/builds, editorial tier lists, teams, advanced search and patch jobs are deferred. Existing personal ranks and favorites remain browser-local and need no public accounts.

Migration details and verified existing behavior: [frontend audit](frontend-audit.md). API draft: [conventions](api-conventions.md). Initial decision: [ADR 0001](adr/0001-preserve-static-export.md).

## Attribution policy

Preserve existing OFL files with distributed fonts. Record each imported asset's source URL, rights holder, license/permission where known and verification timestamp; unknown permission must remain unknown. A source URL alone is not redistribution permission. Avoid importing third-party guide prose. Existing original beginner guides can be staged as drafts for review. Do not claim imported data is official, tested or recently verified without evidence. Keep source attribution visible on public pages.
