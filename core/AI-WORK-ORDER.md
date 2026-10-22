# AI Work Order

Session: 2026-10-22 · Owner: @Sanjeev · Source of truth: *Platform Architecture Plan: Hub, Platform and Apps (V3.1)*

Cross-repo work order for `platform-hub`, `platform-core` and `spoke-template`.
Read this first, then the plan.

## Gates

| Gate | Status | Exit |
| --- | --- | --- |
| 0 Audit | ✅ **passed** | `docs/gate-0-audit.md` + Project doc |
| 1 Foundation and security | ✅ **passed** | this document, "Gate 1" below |
| 2 Hub core | 🟡 **substantial progress — hub-api live locally, awaiting Railway recovery to go staging-live** | this document, "Gate 2" |
| 3 Shared modules | ⏳ | CRM, scheduling, GTM, LMS, tasks/forms, communications core-side |
| 4 First app migration + payments | ⏳ | Dentex first; Insurance second |
| 5 Regional rollout | ⏳ | per country |

## Decisions

| Decision | By | Effect |
| --- | --- | --- |
| GitHub + Railway for dev; Railway staging holds **test data only** | Sanjeev | Residency rules apply from the first real-customer tenant; India/Canada/UK/AU cells open per country on first customer |
| Platform apps: Dentex, Tress-Lounge (new), Realtors (new), Insurance | Sanjeev | BEMP and TRUXORATMS stay off |
| `johnniemarbles/insurance` = our internal build; `PII` isolated and untouched | Sanjeev | Mirrored 866 commits + 137 branches to `insurance`; nothing in this session can reach `PII` |
| **Drop Clerk entirely.** Dev identity verifies HS256 in-process | Sanjeev | No Clerk cost, no sk_test to rotate; Cognito plugs into the same `IdentityVerifier` interface for production |
| Default first app to migrate: Dentex | Claude | Cheapest adapter swap (Supabase + Google GenAI). Overridable |
| HS256 for scope tokens in dev; Ed25519 for prod | Claude | Both now in `@platform-hub/contracts`; prod lets the hub hold only the public verify key |
| Attribution for commits: Claude Opus 4.7 | runtime | Already applied to Gate 1 and Gate 2 commits |

## Gate 1 — shipped

### `platform-hub` (merge from frame + extraction)
- Extracted with history: `aws-sigv4` (12 tests), `credential-custody` (29).
- Migrations 0001, 0032, 0040–0043 copied in.
- `packages/contracts` — `ScopeToken`, `verifyScopeToken`, `enforceScope`, typed `RefusalCode`. 14 tests.
- `packages/enforcement` — `executeIdempotent`, webhook signature + replay check, sign-in-outage structural test. 10 tests.
- `infra/db/migrations/0100_gate1_connector_grants.sql`:
  - `platform.connector_grants` — per-app grant table (no silent fallback).
  - `platform.set_request_context(...)` — LOCAL GUCs, roll back at commit, hub-only setter.
  - `platform.app_may_use_connector(...)` — the one check the hub makes before touching a credential.

### `platform-core`
- Extracted with history: `entity`, `tenancy`, `tenancy-persistence`, `authorization`, `authorization-persistence`, `iam`, `party`, `relationship`, `audit`, `observability`, `business-config`, `domain-events`.
- Migration 0044 (CRM) carried over to the correct side.
- `packages/iam-dev` — HS256 `IdentityVerifier`, refuses `NODE_ENV=production`. Replaces Clerk. 10 tests.
- `packages/db-context` — parameterised SQL for `set_request_context`, shape-checks the context. 5 tests.
- `architecture.config.json` — each extracted foundation package allowed to depend on its siblings; modules at Gate 3 stay strict.

### Acceptance tests covered

| Plan test | Covered by |
| --- | --- |
| Tenant A reads Tenant B → denied | `scope-token.test.ts` |
| App A uses a credential it was not granted → denied | `scope-token.test.ts` + grant check (0100) |
| User reaches location outside hierarchy scope → denied | `scope-token.test.ts` |
| No AI key / budget left → typed refusal, no fallback | `scope-token.test.ts` + grant check |
| A payment/message sent twice → one execution | `idempotency.test.ts` |
| A provider webhook replayed/spoofed → refused | `webhook-replay.test.ts` |
| Hub outage → sign-in codes still delivered | `sign-in-outage.test.ts` + import-graph |

Pending (Gate 2+):
- AI stream disconnects mid-way → usage and reservation reconciled (needs `ai-gateway`)
- Deletion / credential revocation through every layer (needs more hub-api routes)
- Region outage / failed migration (Gate 5)

## Gate 2 — shipped so far

### Migration dry-run
- `tools/db-dryrun` with `@electric-sql/pglite`. Applies every hub migration in order against an ephemeral Postgres, then proves `app_may_use_connector` across 7 ownership × credential-class combinations and that `set_request_context` GUCs roll back at commit. **3 tests pass**.

### Ed25519 scope tokens
- `signScopeTokenEd25519` / `verifyScopeTokenEd25519` in `@platform-hub/contracts`.
- Same `enforceScope` downstream. HS256 is for dev; prod uses the asymmetric variant so the hub holds only the public verify key.
- Non-Ed25519 keys refused at construction. **4 new tests (18 total in contracts)**.

### `apps/hub-api` (new)
- Pipeline: `authorization: Bearer <token>` → `verifyScopeToken` (HS256 or EdDSA) → `enforceScope` → `withRequestContext` (opens tx, sets GUCs, rolls back on error) → handler → JSON response.
- Routes: `GET /health` (no auth), `GET /v1/_debug/whoami` (echoes claims and server-side GUCs so operators and tests confirm the whole pipeline is live).
- Postgres via `pg` in prod; PGlite shim for tests.
- Migration runner (`scripts/migrate.ts`) with checksum table so re-runs are idempotent.
- **7 integration tests** pass end-to-end on PGlite: health, happy path, missing bearer, bad signature, expired token, cross-request GUC isolation, 404 for unknown routes.

### Extractions
- `apps/custody-service` → `apps/custody` with history. Package renamed `@expadio/custody-service` → `@platform-hub/custody`. One `@expadio/ai-gateway` import replaced with a local `llm-providers.ts` stub (mirrors expadio's catalog). **8 tests pass**.
- `packages/provider-registry` extracted with history, renamed `@platform-hub/provider-registry`. The one file with cross-layer deps (`persisted-credential-lease-authorizer.ts`) was deliberately dropped; a scope-token-based implementation of the `CredentialLeaseAuthorizer` interface lands at Gate 2.5. **30 tests pass**.

### Railway staging (project live, deploy pending)
- Project **`platform-staging`** at `fb1af35e-6f88-4eb8-8319-72784132995d`, environment `staging`, region `sfo`.
- Postgres (ssl:18) service deployed successfully.
- `hub-api` service wired to `johnniemarbles/platform-hub` main.
  - Env vars: `DATABASE_URL=${{postgres.DATABASE_URL}}`, `HUB_API_PORT=${{PORT}}`, `NODE_ENV=staging`, `SCOPE_TOKEN_ALGORITHM=HS256`, `SCOPE_TOKEN_HS256_SECRET=<32-byte random>`.
- Build config: `railway.json` + `nixpacks.toml` run `pnpm install --frozen-lockfile`, then `pnpm --filter @platform-hub/hub-api start` (migrates then serves). Healthcheck on `/health`.
- **Three hub-api deployments stacked `QUEUED`** at the time of writing; Railway control plane was in a worldwide outage. Railway will build the latest commit (`0169a3d`) and skip the earlier ones when it recovers.

### Totals

- **platform-hub**: 8 packages/apps + 1 tool, **127 tests pass**, architecture check OK.
- **platform-core**: 14 packages, **166 tests pass**, architecture check OK.

## Remaining Gate 2

- [ ] Confirm Railway deploy green. Pull build logs if it fails; curl `/health`; generate a scope token and hit `/v1/_debug/whoami`.
- [ ] Publish `@platform-hub/contracts` to GitHub Packages so `platform-core` can `signScopeToken` from the same shape.
- [ ] Extract `ai-gateway`, `voice-gateway`, `storage`, `agent-runtime`, `usage-metering` into `platform-hub`.
- [ ] Cognito sibling of `iam-dev` in `platform-core` (needs AWS reconnect).
- [ ] A worker queue (transactional outbox + dead-letter). The migrations are already in; the runtime lands here.
- [ ] A scope-token-based `CredentialLeaseAuthorizer` (replaces the dropped file).
- [ ] Add `revoke-credential` + `delete-request` routes to hub-api; covers two remaining plan acceptance tests.

## Known limits / technical debt

- **No cross-repo workspace deps.** Platform-core's future signer will depend on `@platform-hub/contracts` via GitHub Packages (next Gate 2 item).
- **In-memory stores** for idempotency and webhook replay — the Postgres-backed stores land with the worker queue.
- **The dropped `persisted-credential-lease-authorizer.ts`.** Interface preserved; replacement implementation pending.
- **`forms-proxy`** in `expadio` production runs from an unmerged `claude/cloudflare-brand-domain-autoconfigure` branch. Unrelated to the extraction; fix in expadio.
- The expadio decrypt scripts (`brute_force_decrypt.ts` and friends) are still in expadio's working tree. Not a key leak (confirmed), but noise. Minor cleanup PR to expadio when convenient.

## Rollback

- **platform-hub main**: `git log --oneline` to the last pre-Gate-2 commit (`863e681`) and revert forward. Each extraction is its own merge commit, so individual rollback is clean.
- **platform-core main**: unchanged in this Gate 2 slice.
- **Railway `platform-staging`**: delete the project in Railway dashboard, or `curl` the GraphQL `projectDelete` mutation. Nothing else depends on it.
- **No changes to `expadio`.** Filter-repo work was on disposable copies.
- **No changes to `PII`.** Isolation intact.

## Next session

Pick up at: Railway deploy verification, then publish `@platform-hub/contracts`, then the remaining hub packages. Dentex preparation starts whenever Gate 2 is "done".
