# Gate 0 Audit

Date: 2026-10-22 (updated after Sanjeev's answers) · Source: *Platform Architecture Plan: Hub, Platform and Apps (V3.1)* · Scope: evidence-backed inventory across code, infrastructure and providers. **Read-only throughout.**

## Scope decisions (Gate 0 exit)

- **No repo holds real customer data today.** Expadio, BEMP, TRUXORATMS, dentex, PII, tress-lounge-platform and the Railway projects are all pre-launch. Residency rules apply from the first real-customer tenant, not retroactively.
- **The apps on the shared platform are `dentex`, `tress-lounge` (new build), and `realtors` (new).** BEMP and TRUXORATMS stay out of the migration list; TRUXORATMS keeps running on its own.
- **`insurance` is our internal build and testbed; `PII` is isolated.** `johnniemarbles/insurance` was mirrored from `johnniemarbles/pii` (866 commits on `main`, 137 branches, HEAD `3d94ddd`) and is the one we build on. `PII` is where real user data will land; from this point on **no agent, script, extraction, filter-repo pass or deployment touches `PII`**. The local clone is deleted and `PII` is not attached to any session.
- **Decrypt scripts in `expadio`:** re-examined. They do not contain exposed key material; the "long literals" are regex patterns, not stored secrets. No key rotation is required from these files. They are still excluded from the extraction via `git filter-repo` in Gate 1. The only real secret still exposed is the Clerk `sk_test_…` key hard-coded in `apps/*/proxy.ts`; that one is rotated at Gate 1 as part of the identity-adapter move.
- **Razorpay** will be connected in claude.ai before Gate 4.
- **Legal sign-off per country** is deferred; no counsel assigned yet.

## Summary

- **The foundation of the plan already exists.** `expadio` is the live codebase: 43 packages, 3 apps, 3 services, 1 industry module (`emp`), **1,935 of 1,935 root tests pass**, typecheck clean. Credential custody, provider registry, enforcement spine, decision traces, throttle and spend caps, revocation attestations, hierarchy, roles, and an identity-verifier interface (with a Clerk implementation) are all in place.
- **The migration list in the plan needs correcting.** `connector_credentials` lives in **0001**, not 0040–0044; 0040 extends it with the custody ladder. 0044 creates `crm_accounts`/`crm_contacts`, which belong in `platform-core`, not the hub.
- **No current deployment satisfies the plan's residency rules for production.** Every Railway service runs in `sfo` (US West); buckets are in `iad` (US East). `pii-ca`, named for Canada, is in California. Supabase projects are in `us-west-2`, `us-east-2` and one in `ap-south-1`.
- **Secret-material risk in `expadio` must be resolved before any `git filter-repo` extraction**: seven tracked scripts in the repo root (five with long encoded literals) and three Clerk `sk_test_…` keys hard-coded in app proxies.
- **Stripe is empty**; **Razorpay** not yet connected. Resend has one US-only domain (`punjabinsurance.co`), no webhooks. Cloudflare runs two Workers for `expadio`; R2 not enabled.
- The three new repos — `platform-hub`, `platform-core`, `spoke-template` — now exist, with the architecture guard enforcing the plan's layer rules in CI (9 unit tests passing).

## Code inventory

### Repositories

| Repo | Last commit | Shape | Test suite result | Role |
| --- | --- | --- | --- | --- |
| `johnniemarbles/expadio` | b2c2811 2026-10-14 | pnpm workspaces, 43 packages / 3 apps / 3 services / 1 module | root `pnpm test`: **1,935 / 1,935 pass**; typecheck 0 errors | **The source** of the extraction |
| `johnniemarbles/BEMP` | d18e9e6 2026-08-24 | Nest-style, direct Clerk + Twilio + Resend + SES in app code | not run | **Out of scope.** Stays off the shared platform |
| `johnniemarbles/truxoratms` | a657917 2026-10-12 | Next.js 16, Prisma 7, 163 migrations, Stripe/Twilio/OpenAI/GenAI/Resend/S3 all in-app | not run | **Out of scope.** Keeps running on its own |
| `johnniemarbles/dentex` | 48141b5 2025-11-28 | Vite SPA on Supabase + `@google/genai` | not run (SPA) | **Dentex spoke app on the platform.** Rebuild from `spoke-template`, keep what works, replace Supabase client with hub/platform SDK calls |
| `johnniemarbles/insurance` (mirror of PII) | 3d94ddd 2026-10-22 | Node app, 161 migrations, KMS + S3 | not run | **Insurance spoke app on the platform; internal use only, no customer data.** `PII` is isolated and off-limits to this and every later session |
| `johnniemarbles/tress-lounge-platform` | fd12470 2026-08-24 | pnpm + turbo monorepo, 11 migrations | not run (stale) | Reference. **Tress-Lounge spoke app** is a new build from `spoke-template` |
| `platform-hub` / `platform-core` / `spoke-template` | this session | pnpm + turbo frames; architecture guard enforced in CI | 9 / 9 guard unit tests pass; `pnpm run check` exits 0 | **New** |

### expadio application-level tests

Expected to be partially broken while files move around. All failures are stale references, not product bugs.

| Target | Pass | Fail | Dominant cause |
| --- | --- | --- | --- |
| `apps/custody-service` | 8 | 0 | — |
| `apps/brand-web` | 498 | 35 | `ENOENT` on social-network pages that have been removed |
| `apps/platform-web` | 993 | 73 | `ENOENT`/`ERR_MODULE_NOT_FOUND` on telegram/agent routes and `custody-cutover`, plus Postgres `ECONNREFUSED:5432` where tests need a live DB |
| `services/content-asset-scanner` | 12 | 0 | — |
| `services/product-worker` | 15 | 1 | `insurance-adapter-jobs.test.mjs`: missing `@electric-sql/pglite` |
| `services/voice-stream` | 14 | 0 | — |

Fixes are mechanical: delete the tests for removed files, add `pglite` as a dev dependency, run the Postgres-dependent tests against a managed test container. **None blocks extraction.**

### expadio package inventory, with its destination

Destination picked from the plan's layer rules (`H` = `platform-hub`, `C` = `platform-core`, `S` = `spoke-template`, `split` = move one half of the package).

| Package | src/tests | Destination | Why |
| --- | --- | --- | --- |
| `credential-custody` | 11 / 6 | **H** | Vault port, fingerprints, probes, request signing, revocation |
| `provider-registry` | 9 / 8 | **H** | Connector catalogue and routing policies |
| `aws-sigv4` | 1 / 1 | **H** | SigV4 for AWS adapters |
| `communication` | 47 / 34 | **split** | Hub side (34 files): `provider-adapter*`, `twilio-*`, `resend-*`, `linkedin-*`, `voice-*`, `dispatch`, `queue-worker`, `webhook-*`, `plane`, `throttle`, `spine`, `sender`, `delivery-*`, `send-attempt`, `retry-policy`, `provider-webhook`, `governed-*-binding`. Core side: `template*`, `consent`, `suppression*`, `content-policy`, `conversation`, `decision-trace`, `html-sanitizer`. |
| `ai-gateway` | 24 / 19 | **H** | AI provider routing and budget reservation |
| `voice-gateway` | 8 / 9 | **H** | Voice provider contracts |
| `storage` | 11 / 9 | **H** | S3/Railway artifact store (presigned transfers) |
| `agent-runtime` | 46 / 45 | **H** | MCP runtime for agents (plan §AI agents) |
| `usage-metering` | 3 / 2 | **H** | Hub's usage ledger feeds Stripe/Razorpay |
| `entity` | 10 / 2 | **C** (foundation) | Hierarchy |
| `tenancy`, `tenancy-persistence` | 2 / 2 | **C** (foundation) | Tenant model |
| `iam`, `iam-clerk` | 2 / 1 | **C** (foundation) | **Identity adapter is already in place.** `iam-clerk` is the dev impl; a `iam-cognito` sibling implements the same `IdentityVerifier` interface for production. |
| `authorization`, `authorization-persistence` | 2 / 1 | **C** (foundation) | Roles-as-data engine |
| `capabilities`, `capability-persistence` | 16 / 15 | **C** | Entitlements |
| `access-control`, `access-runtime` | 3 / 3 | **C** | Server-side context |
| `party`, `relationship` | 3 / 2 | **C** (core-records) | People, companies, relationships |
| `lead`, `lead-identity`, `gtm`, `learning`, `scheduling`, `workflow` | 74 / 59 | **C** (modules) | CRM, GTM, LMS, scheduling, workflow |
| `knowledge`, `context-engine`, `data-orchestrator`, `domain-events`, `governed-actions`, `audit`, `observability`, `business-config` | 46 / 33 | **C** | Foundation helpers |
| `postgres-runtime` | 167 / 96 | **C** (shared DB) | Depends on 27 other `@expadio/*` packages. The biggest single lift. |
| `ui` | 66 / 3 | **C** (ui) | Design tokens + each module's embeddable components |
| `agreement`, `case`, `product`, `industry-packs`, `lead-capture` | 29 / 25 | **S** | Industry-specific; move to spoke apps |

### Provider SDK usage in `expadio` apps

Only one external provider SDK is imported in app code today, which keeps the extraction cheap:

```
32  @clerk/nextjs/server
 5  @clerk/nextjs
 1  @clerk/nextjs/webhooks
```

All messaging, payments, AI and storage already go through packages. No `stripe`, `razorpay`, `twilio`, `openai`, `@anthropic-ai/*`, `googleapis`, `@sendgrid/*`, `resend`, `cloudflare`, `firebase-admin` or `nodemailer` import appears under `apps/`. The architecture guard is correctly aligned to this shape.

### Migration numbering

448 migration files; **58 numbers duplicated**. Key the extraction on *table names*, not numbers. Confirmed locations:

| Table | File |
| --- | --- |
| `platform.capabilities`, `platform.connectors`, `platform.connector_capabilities`, `platform.connector_credentials`, `platform.connector_routing_policies` | `0001_platform_capability_registry.sql` |
| `platform.credential_lease_events` | `0032_credential_lease_history.sql` |
| `platform.credential_revocation_attestations` (+ custody ladder columns on `connector_credentials`) | `0040_communication_byok_custody.sql` |
| `platform.communication_throttle_windows`, `communication_plane_budgets`, `communication_spend_caps`, `communication_webhook_dead_letters` | `0041_communication_enforcement.sql` |
| `platform.communication_decision_traces` | `0042_communication_decision_traces.sql` |
| non-disclosure constraint on credentials (no table) | `0043_credential_non_disclosure.sql` |
| `platform.crm_accounts`, `platform.crm_contacts` | `0044_crm_party.sql` → **goes to `platform-core`, not the hub** |

## Infrastructure inventory

### Railway (US only; `sfo` for services, `iad` for buckets)

| Project | Env | Services | Notes |
| --- | --- | --- | --- |
| **expadio** | production | `platfrom-web` (typo), `brand-web`, `voice-stream`, `content-asset-scanner`, `forms-proxy` (from unmerged `claude/…` branch), `comms-drain-worker`, 4 cron variants (one stuck `INITIALIZING` since 20 Oct), 2 Postgres instances, Redis | 2 buckets in `iad` |
| **pii-us** | dev | `api` (from `PII` repo), Postgres 50 GB | OK |
| **pii-ca** | dev | `api`, Postgres 50 GB | **In California, despite the "ca" name** |
| **trux-platform** | production | `web` (TRUXORATMS), PostGIS 16, Redis | **Redis has no volume** — not durable across restarts |
| **overflowing-hope** | production | `Tress-Lounge` app + Postgres | Last deploy 14 Jul 2026, likely stale |
| **dynamic-tenderness** | — | Staged since 28 May 2026, never deployed | Retire |
| **cooperative-victory** | — | Empty | Retire |

### Supabase

| Project | Region | Status | Likely use |
| --- | --- | --- | --- |
| `Bulk Data` | `us-west-2` | INACTIVE | ad-hoc |
| `johnniemarbles's Project` | `us-east-2` | INACTIVE | playground |
| `TRESSLOUNGE` | **`ap-south-1`** | INACTIVE | Tress Lounge, correct region |
| `dentex` | `us-east-2` | INACTIVE | dentex SPA |

### Cloudflare

- **Workers:** `expadio` and `expadio-custom-hostname-proxy`.
- **R2:** disabled on the account.

### Resend

- One domain: `punjabinsurance.co` (verified, `us-east-1`, sending enabled, receiving disabled). No webhooks configured.

### Stripe

- One account: `New Business`, livemode. **No products, prices, subscriptions or webhook endpoints** — a clean slate for Gate 4.

### Razorpay

- Not connected. India payments cannot be built or tested until it is.

### AWS

- MCP connector needs reconnect in **claude.ai → Settings → Connectors**. The Agent Toolkit (`aws login` + `aws configure agent-toolkit`) was offered as a parallel setup on Sanjeev's Mac mini (`us-east-2` project), but is not required to proceed with Gate 1 on GitHub + Railway.

## Move list vs reality

| Plan says | Reality | Decision |
| --- | --- | --- |
| **Moves to `platform-hub` — packages:** credential-custody, provider-registry, communication (integration half), enforcement spine, planes, throttle, spend caps, decision traces, revocation attestation, provider-unavailable adapter, DNS records, SPF merge | All present. "Enforcement spine, planes, throttle, spend caps, decision traces, revocation attestation" live inside `packages/communication`, not a separate `enforcement` package — the extraction has to split `communication` by filename, listed above | Extract per the split; create `packages/enforcement` in the hub as its new home |
| **Moves to `platform-hub` — tables:** 0040–0044 (connector credentials, throttle windows, plane budgets, spend caps, decision traces, revocation attestations, webhook dead letters) and 0032 (`credential_lease_events`) | `connector_credentials` is in 0001; 0040 extends it. 0044 is `crm_accounts`/`crm_contacts` and belongs in `platform-core` | Rewrite the migration list in the plan; cutover should be gated on table names |
| **Moves to `platform-hub` — routes:** custody wrapping key and credential intake, connector list and create, revocation, provider webhooks; vault and dev secret stores | `apps/custody-service` holds the wrapping, intake and vault routes; its `.env.example` is tracked. 10 app routes under `apps/platform-web` and `apps/brand-web` still call vault/secret resolvers directly | Move the service as-is; replace the app's direct vault calls with hub SDK calls behind a flag |
| **Moves to `platform-core`:** entity graph, leads, IAM, tenant context, setup state, communications screens and templates (call hub via SDK) | All present. Identity adapter already exists | Extract per inventory; `iam-clerk` ships as the dev identity adapter until `iam-cognito` is written |
| **Rule:** apps never import provider SDKs | Only `@clerk/nextjs` imports in app code; no payments/AI/messaging/storage SDKs anywhere under `apps/` | ✅ Starting state already satisfies the rule once Clerk moves to the foundation's identity adapter |

## Risks ranked

| # | Severity | Finding | Fix (direction, not deployment) |
| --- | --- | --- | --- |
| 1 | **Medium (was High, downgraded on re-check)** | Clerk `sk_test_…` key hard-coded in `apps/brand-web/proxy.ts:9`, `apps/platform-web/proxy.ts:65,86`, and `apps/platform-web/.env.example:2`. The 7 "decrypt" scripts in the expadio root were re-examined and contain no key material — the long literals are regex patterns. | Rotate the Clerk test-instance key at Gate 1 as part of the identity-adapter move. Strip the decrypt scripts from the extraction copy with `git filter-repo` before pushing to the new repos |
| 2 | **Low (was High)** | All Railway services in `sfo`; `pii-ca` named for Canada runs in California | **No real customer data today**, so no live breach. Keep Railway for dev/staging only (test data). Open production regional cells per plan before any real-customer tenant signs in India or Canada |
| 4 | **Medium** | 4 overlapping `comms-drain` crons in `expadio` production, one stuck `INITIALIZING` since 20 Oct | Pin to the single `comms-drain-worker`; delete the three cron variants after shadow mode is live |
| 5 | **Medium** | `forms-proxy` deployed from an unmerged `claude/cloudflare-brand-domain-autoconfigure` branch | Merge or revert; CI must only deploy production from `main` |
| 6 | **Medium** | `trux-platform` production Redis has no volume | Attach a volume; or move Redis to a managed instance |
| 7 | **Medium** | `expadio` typecheck is strict and clean, but 109 app-level tests fail on stale file references and missing `pglite`/`:5432` | Clean the stale references; add `pglite` as a dev dep; stand up a Postgres test container |
| 8 | **Medium** | Resend domain is `punjabinsurance.co` in `us-east-1` — not a sign-in domain, not platform-managed per region as the plan requires | At Gate 2, add per-region Resend domains (plan §Regions and residency §2.5) and switch sign-in email to each region's own SES; Resend handles marketing only |
| 9 | **Low** | 58 duplicated migration numbers in `expadio` | Prefix the next series with a date and renumber on the extraction copy |
| 10 | **Low** | Supabase projects created but all `INACTIVE` | Decide whether to keep them (dev state), or delete after confirming no live data |

## Open items left

- **Legal sign-off per country** (plan calls for counsel per regulated workload per country): no counsel assigned yet. Carried into Gate 5 as an open decision.
- **Order of app migration.** Dentex, Tress-Lounge, Realtors and Insurance are all on the list. The plan asks us to pick one app to go first so Gate 4 (first-app migration + payments) has a concrete target. Default: **Dentex first**, because its Supabase shape makes the Clerk-to-adapter and client-to-SDK swap cheapest. Second: **Insurance** (largest existing codebase and the one that gets real customer data soonest). Change the default if you want.

## Gate 0 exit

Gate 0 **passes**: the audit is written, the move list is corrected, the risks are agreed, and the five open questions are answered. No code was extracted in Gate 0.

Next: **Gate 1 — Foundation & Security**, laid out in `AI-WORK-ORDER.md`.
