# ADR 0001: Preserve the recovered frontend during backend foundation

Date: 2026-10-24. Status: accepted.

## Context

The recovered frontend is a Python-generated static site with 54 pages, plain JavaScript, local artwork/fonts and JSON inputs. It is not an existing Next.js app. Rewriting it while establishing domain models would introduce unnecessary coupling and obscure parity failures.

## Decision

Keep `demo-ui/` intact. Establish the pnpm workspace and `apps/api` beside it. Add `apps/web` and `apps/admin` incrementally when their API and authorization dependencies are ready. Reuse the current visual assets and route structure after provenance review. Do not carry the nested Git repository or Sites hosting identity into the new applications.

Keep local favorites and personal ranks browser-local. Separate editorial tier-list management from this feature. Import guides as drafts and catalog records with provenance; never synthesize missing character mechanics.

## Consequences

The static demo remains independently reviewable. Two rendering paths temporarily coexist. A later frontend integration decision must specify renderer, pagination, published-content loading, storage compatibility and route parity before retiring the Python generator.
