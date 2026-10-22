# AI Work Order

Session: 2026-10-22 · Owner: @Sanjeev · Source of truth: *Platform Architecture Plan: Hub, Platform and Apps (V3.1)*

Cross-repo work order for `platform-hub`, `platform-core` and `spoke-template`.
Read this first, then the plan.

## Gates

| Gate | Status | Exit |
| --- | --- | --- |
| 0 Audit | ✅ **passed** | `docs/gate-0-audit.md` + Project doc |
| 1 Foundation and security | 🟡 **substantially complete; Railway staging pending apps to deploy** | this document |
| 2 Hub core | ⏳ | hub-api, worker queue, Cognito identity adapter, published contracts |
| 3 Shared modules | ⏳ | CRM, scheduling, GTM, LMS, tasks/forms, communications core-side |
| 4 First app migration + payments | ⏳ | Dentex first; Insurance second |
| 5 Regional rollout | ⏳ | per country |

## Decisions this session

| Decision | By | Effect |
| --- | --- | --- |
| GitHub + Railway for dev; Railway staging holds **test data only** | Sanjeev | Residency rules apply from the first real-customer tenant; India/Canada/UK/AU cells open per country on first customer |
| Platform apps: Dentex, Tress-Lounge (new), Realtors (new), Insurance | Sanjeev | BEMP and TRUXORATMS stay off |
| `johnniemarbles/insurance` = our internal build; `PII` isolated and untouched | Sanjeev | Mirrored 866 commits + 137 branches to `insurance`; nothing in this session can reach `PII` |
| **Drop Clerk entirely.** Dev identity verifies HS256 in-process | Sanjeev | No Clerk cost, no sk_test to rotate; Cognito plugs into the same `IdentityVerifier` interface for production |
| Default first app to migrate: Dentex | Claude | Cheapest adapter swap (Supabase + Google GenAI). Overridable |
| HS256 for scope tokens in Gate 1; Ed25519 at Gate 2 | Claude | Dev shares the secret both sides; prod lets the hub hold only the public verify key |

## Gate 1 — what shipped

### `platform-hub`
- Extracted from `expadio` with history (`git filter-repo`, 38 commits preserved):
  - `packages/aws-sigv4` — 12 tests
  - `packages/credential-custody` — 29 tests
  - `infra/db/migrations/0001`, `0032`, `0040`, `0041`, `0042`, `0043`
- `packages/contracts` — `ScopeToken`, `verifyScopeToken`, `enforceScope`, typed `RefusalCode`. 14 tests cover the first five plan acceptance criteria (cross-tenant, cross-app, out-of-hierarchy, no-key-fallback, grant-not-held).
- `packages/enforcement` — `executeIdempotent` (acceptance: double payment → one execution), webhook signature + replay check (acceptance: webhook replayed or spoofed → refused), sign-in independence structural test (acceptance: hub outage → sign-in still works). 10 tests.
- `infra/db/migrations/0100_gate1_connector_grants.sql`:
  - `platform.connector_grants` — per-app grant table; **no silent fallback**.
  - `platform.set_request_context(tenant, app, hierarchy, credential_class, grant)` — server-set GUCs, `is_local=true` so they roll back at commit and never leak across pooled connections.
  - `platform.app_may_use_connector(...)` — the one check the hub calls before touching a credential.
- Totals: **4 packages, 65 tests, 0 failures.** `pnpm run check` exits 0.

### `platform-core`
- Extracted from `expadio` with history (62 commits preserved):
  - `audit`, `authorization`, `authorization-persistence`, `business-config`, `domain-events`, `entity`, `iam`, `observability`, `party`, `relationship`, `tenancy`, `tenancy-persistence`
  - `infra/db/migrations/0044_crm_party.sql` (plan-corrected location)
- `packages/iam-dev` — in-process HS256 `IdentityVerifier`. Refuses construction when `NODE_ENV=production`. 10 tests. Replaces Clerk.
- `packages/db-context` — `setRequestContextSql(ctx)` produces the exact parameterised call to the hub-side setter; `assertServerContext` refuses malformed contexts at the type boundary. 5 tests.
- `architecture.config.json` — extended: all extracted foundation packages are allowed to depend on each other; modules at Gate 3 fall through to the strict `moduleAllowedDeps` (foundation + core-records + contracts only).
- Totals: **14 packages, 166 tests, 0 failures.** `pnpm run check` exits 0.

### Combined
- Acceptance tests from plan §Acceptance tests, covered:

  | Test | Covered by |
  | --- | --- |
  | Tenant A reads Tenant B → denied | `scope-token.test.ts` |
  | App A uses a Tenant A credential it was not granted → denied | `scope-token.test.ts` + `0100` grant check |
  | User reaches a location outside their hierarchy scope → denied | `scope-token.test.ts` |
  | No AI key / no budget left → typed refusal, no platform-key fallback | `scope-token.test.ts` + grant check |
  | A payment or message request sent twice → one execution | `idempotency.test.ts` |
  | A provider webhook replayed or spoofed → no duplicate or unauthorised change | `webhook-replay.test.ts` |
  | The hub's messaging fails → sign-in codes still delivered | `sign-in-outage.test.ts` + import-graph proof |

  Not yet covered (need running apps):
  - AI stream disconnects mid-way → usage and reservation reconciled (Gate 2 with `ai-gateway`)
  - Deletion request / credential revocation carried through every layer (Gate 2)
  - Region outage / failed migration — rollback (Gate 5)

## Known limits / technical debt

- **HS256 only.** Signer and verifier share a secret. Upgrade to Ed25519 at Gate 2 so the hub holds only a public verify key.
- **No cross-repo workspace deps.** Platform-core's future signer will depend on `@platform-hub/contracts`. Publish via GitHub Packages at Gate 2.
- **In-memory stores** for idempotency and webhook replay are correct in a single process; the Postgres-backed stores ship with `hub-api` at Gate 2 (uses a unique index on `(tenant_id, operation, key)` to serialise concurrent writers).
- **`0100_gate1_connector_grants.sql` is not run anywhere yet** — platform-staging doesn't exist yet. Dry-run at Gate 2 start via `hub-api`'s migration runner on an ephemeral Postgres.
- **`forms-proxy`** in `expadio` production still runs from an unmerged `claude/cloudflare-brand-domain-autoconfigure` branch. Unrelated to the extraction; fix in expadio.

## Remaining Gate 1 — Railway staging

**Blocked on first app to deploy.** Both repos are libraries + migrations today, nothing to run as a service. The staging project opens with `hub-api` at Gate 2.

Shape when it does:
- Railway project `platform-staging` (test data only).
- Services: `hub-api`, `platform-api`, Postgres, Redis.
- Region: `sfo`. Dev only.

## Rollback

- **`platform-hub`**: `git revert bb466f6..HEAD` undoes the extraction and new packages. The commit range covers both the frame merge and all new packages.
- **`platform-core`**: `git revert b3165f5..HEAD` similarly.
- **No changes to `expadio`.** The filter-repo extraction worked on a disposable copy. Nothing on the expadio production path or Railway deployments was touched.
- **No changes to `PII`.** Its mirror into `insurance` is from a prior turn; isolation remains.

## Next

Say the word for Gate 2. First pulls at Gate 2:
1. Dry-run migrations 0001 → 0043 → 0044 → 0100 against an ephemeral Postgres.
2. `apps/hub-api` extracted from `expadio`'s custody-service + a thin router that enforces `verifyScopeToken` → `enforceScope` → `app_may_use_connector` on every call.
3. Extract `provider-registry` after inverting its dependency on `@expadio/authorization` and `@expadio/tenancy` (plan rule 3: hub never depends on core — those checks become inline scope-token checks).
4. Publish `@platform-hub/contracts` via GitHub Packages; platform-core depends on it.
5. Spin up Railway staging.
6. Cognito `IdentityVerifier` sibling of `iam-dev` for production.
