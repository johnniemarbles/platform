# AI Work Order

Session: 2026-10-22 to 2026-10-23 · Owner: @Sanjeev · Source of truth: *Platform Architecture Plan: Hub, Platform and Apps (V3.1)*

Cross-repo work order for `platform-hub`, `platform-core` and `spoke-template`.
Read this first, then the plan.

## Gates

| Gate | Status | Exit |
| --- | --- | --- |
| 0 Audit | ✅ **passed** | `docs/gate-0-audit.md` |
| 1 Foundation and security | ✅ **passed** | "Gate 1" below |
| 2 Hub core | ✅ **passed** | "Gate 2" below, verified live on Railway staging |
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

## Gate 1 — shipped

### `platform-hub`
- Extracted with history: `aws-sigv4` (12), `credential-custody` (29).
- Migrations 0001, 0032, 0040–0043 copied in.
- `packages/contracts` — ScopeToken (HS256), verifyScopeToken, enforceScope, RefusalCode. 14 tests.
- `packages/enforcement` — executeIdempotent, webhook signature + replay, sign-in-outage structural test. 10 tests.
- `infra/db/migrations/0100_gate1_connector_grants.sql`:
  - `platform.connector_grants` — per-app grant (no silent fallback).
  - `platform.set_request_context(...)` — LOCAL GUCs, roll back at commit.
  - `platform.app_may_use_connector(...)` — the one check before any credential.

### `platform-core`
- Extracted with history: `entity`, `tenancy`, `tenancy-persistence`, `authorization`, `authorization-persistence`, `iam`, `party`, `relationship`, `audit`, `observability`, `business-config`, `domain-events`.
- Migration 0044 (CRM) carried over to the correct side.
- `packages/iam-dev` — HS256 `IdentityVerifier`, refuses NODE_ENV=production. Replaces Clerk. 10 tests.
- `packages/db-context` — parameterised SQL for `set_request_context`, shape-checks the context. 5 tests.
- `architecture.config.json` recognises extracted foundation packages; modules at Gate 3 stay strict.

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

## Gate 2 — shipped

### Migration dry-run
- `tools/db-dryrun` with `@electric-sql/pglite`. Applies every hub migration in order against an ephemeral Postgres, then proves `app_may_use_connector` across 7 ownership × credential-class combinations and that `set_request_context` GUCs roll back at commit. 3 tests.

### Ed25519 scope tokens
- `signScopeTokenEd25519` / `verifyScopeTokenEd25519` in `@platform-hub/contracts`. Same enforceScope downstream. Prod uses asymmetric, dev HS256. 4 new tests (18 total in contracts).

### `apps/hub-api` (new)
- Pipeline: `authorization: Bearer <token>` → `verifyScopeToken` (HS256 or EdDSA) → `enforceScope` → `withRequestContext` (opens tx, sets GUCs via `platform.set_request_context`, rolls back on error) → handler → JSON response.
- Routes: `GET /health` (no auth), `GET /v1/_debug/whoami` (echoes claims and server-side GUCs).
- `pg` in prod via connection pool; PGlite shim for tests. Transactions serialised in PGlite so parallel tests don't tangle.
- Migration runner (`scripts/migrate.ts`) with checksum table so re-runs are idempotent and divergent SQL is refused.
- 7 integration tests pass end-to-end on PGlite.

### Extractions (all with git-filter-repo history preserved)
- `apps/custody-service` → `apps/custody` (8 tests). `@expadio/ai-gateway` import replaced with real ai-gateway after batch 2 landed.
- `packages/provider-registry` (30 tests). Cross-layer `persisted-credential-lease-authorizer.ts` dropped. Replaced by:
- `packages/provider-registry/src/scope-token-authorizer.ts` — a scope-token-based `CredentialLeaseAuthorizer` (8 new tests, 38 total in provider-registry). The hub never runs the full authorization policy itself; the verified claims plus `platform.app_may_use_connector(...)` are the authority.
- `packages/{ai-gateway, voice-gateway, storage, usage-metering}` extracted together (119 commits of history). `application-boundary.test.ts` dropped (asserted a layout from expadio).

### Railway staging — live on `fb1ae29`

Verified end-to-end on **2026-10-23** against the staging URL `hub-api-staging-a227.up.railway.app`:

- `GET /health` → `{"ok":true,"traceId":"8f1d2dc7-429b-4a68-ba0e-fb323204954d"}`
- `GET /v1/_debug/whoami` with a user-side HS256-signed token for `tenantId=1111...`, `appId=app_dentex`, `permissions=[debug.whoami]`:
  ```json
  {"ok":true,"traceId":"a78dc585-527c-4544-ba1b-d872c314ea5d","result":{
    "claims":{"sub":"usr_42","tenantId":"1111...","appId":"app_dentex","permissions":["debug.whoami"],"credentialClass":"platform-operational"},
    "serverContext":{"tenant":"1111...","app":"app_dentex","credentialClass":"platform-operational","grant":null}
  }}
  ```
  `serverContext` is what Postgres sees INSIDE the handler's transaction, read via `platform.current_tenant_id()` / `current_app_id()` etc. The server-set GUCs match the token's claims — the pipeline is correct.

Infrastructure as shipped:
- Project `platform-staging` (`fb1af35e-6f88-4eb8-8319-72784132995d`), environment `staging`, region `sfo`.
- `postgres` service, PG 18.6, 5 GB volume at `/var/lib/postgresql/data`, `PGDATA=/var/lib/postgresql/data/pgdata`.
- `hub-api` service wired to `johnniemarbles/platform-hub` main; auto-deploys on push.
- Env: `DATABASE_URL=${{postgres.DATABASE_URL}}`, `PORT` set by Railway, `NODE_ENV=staging`, `SCOPE_TOKEN_ALGORITHM=HS256`, `SCOPE_TOKEN_HS256_SECRET` (random 32 bytes).
- Build with Railpack (Node 22, pnpm 10.15, root `start` script delegates to the hub-api workspace).
- Migrations applied on first boot: `0000_hub_core_stubs → 0032 → 0040 → 0041 → 0042 → 0043 → 0100`.

### Totals

- **platform-hub**: 13 packages/apps + 1 tool, **274 tests pass**, architecture check OK, live on Railway staging.
- **platform-core**: 14 packages, **166 tests pass**, architecture check OK.

### Fix log (Gate 2 bring-up)
- `fb1ae29`: use Railway `PORT` env var directly (older `${{PORT}}` indirection yielded `:0`).
- `86d0563`: added `0000_hub_core_stubs.sql` so hub-only deploys get `platform.tenants` (owned by core).
- `d488c8c`: root `start` script because Railway picked Railpack and ignored `railway.json`'s startCommand.
- postgres: added `PGDATA=/var/lib/postgresql/data/pgdata` so the Railway ssl:18 image found its mount; attached a 5 GB volume.

## Remaining work before Gate 3 starts (optional, can defer)

- [x] Publish `@platform-hub/contracts` configuration + workflow (`contracts-v0.1.1` tagged; pending GitHub PAT/org resolution for publish scope).
- [x] `apps/hub-api` routes beyond `_debug/whoami`: `credential.revoke`, `v1/credentials` (list by tenant+app), Postgres-backed idempotency store (replaces in-memory). (shipped in `5d137db`)
- [x] Communication **split** extraction from `expadio/packages/communication`: 34 hub-side files (twilio-*, resend-*, voice-*, dispatch, queue-worker, provider-adapter*, webhook-ingestion, plane, throttle, spine, …). (shipped in `12a6f11`)
- [x] Gate 3 batch 1: modules extracted into `platform-core` (`scheduling`, `lead`, `lead-identity`, `gtm`, `learning`) with 100% tests passing. (shipped in `dc01f17`)
- [x] Dentex-v2 scaffolded from `spoke-template` in `johnniemarbles/dentex-v2`, Vite SPA ported, `@dentex/domain` created, architecture checks & tests passing. (shipped in `35b82ce`)
- [x] Cognito `IdentityVerifier` sibling of `iam-dev` implemented in `@platform-core/iam-cognito`. (shipped in `a4ec5c1`)
- [ ] Extract `agent-runtime` — depends on business-config, entity, postgres-runtime, voice-gateway. Needs cross-repo contracts first.

## Known limits / technical debt

- No cross-repo workspace deps yet. Platform-core will consume `@platform-hub/contracts` via GitHub Packages (open item above).
- In-memory idempotency/webhook-replay stores; Postgres-backed versions ship with the hub-api worker queue.
- `forms-proxy` in expadio production runs from an unmerged branch. Expadio-side; unrelated to this work.

## Rollback

- **platform-hub main**: `fb1ae29` is Gate 2's final commit; `revert` back to `863e681` to unwind Gate 2.
- **platform-core main**: last touched at `2d5acc5` (AI-WORK-ORDER update at end of Gate 1).
- **Railway `platform-staging`**: delete in the Railway dashboard.
- **No changes to `expadio`**. Filter-repo was on disposable copies.
- **No changes to `PII`**. Isolation intact.

## Gate 3 — plan

Pull core modules from expadio into `platform-core/packages/`:
1. `scheduling`, `gtm`, `learning` (LMS), `lead`, `lead-identity`, `lead-capture` — modules in the plan.
2. `knowledge`, `context-engine`, `data-orchestrator`, `governed-actions`, `access-control`, `access-runtime`, `capabilities`, `capability-persistence` — foundation items that depend on hub via `@platform-hub/sdk` once cross-repo is in place.
3. `postgres-runtime` — carefully. It's 167 files touching 27 workspace packages. Expect to drop or defer parts that pull in modules we don't want yet.
4. Communication **core half** (templates, consent, suppression, content-policy, conversation, decision-trace, html-sanitizer).

Enforce the strict module rule in architecture.config.json: modules may depend only on foundation, core-records, contracts.

## Gate 4 — plan

**First app: Dentex** (confirmed Gate 0).
1. Create `johnniemarbles/dentex-v2` from `spoke-template`.
2. Replace the Supabase client with hub-SDK + platform-core-SDK calls.
3. Carry over the Vite SPA UI from `johnniemarbles/dentex` wholesale.
4. First real end-to-end: a signed-in dentist can book a visit (scheduling module), the hub sends a confirmation (communication, via the real Twilio adapter), payment is handled through Stripe (billing).
