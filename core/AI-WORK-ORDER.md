# AI Work Order

Session: 2026-10-22 · Owner: @Sanjeev · Source of truth: *Platform Architecture Plan: Hub, Platform and Apps (V3.1)*

This file is for the next agent. Read it, then the plan, before changing anything. It covers all three new repos: `platform-hub`, `platform-core` and `spoke-template`.

## Decisions taken this session

| Decision | By | Effect |
| --- | --- | --- |
| Development and staging run on **GitHub + Railway** | Sanjeev | Railway environments hold **test data only**. Production regional cells stay as the plan describes (AWS, opened per country on its first customer). Railway has no India, Canada or Australia region, so it can never host production personal data for those countries. |
| Repos created first, ahead of the rest of Gate 0 | Sanjeev | Frames only. No code extracted yet. |
| Package scopes `@platform-hub/*`, `@platform-core/*`, `@spoke/*` | Claude (default) | Distinct scopes let CI enforce dependency direction across repos. Extracted `@expadio/*` packages are renamed during extraction. |
| Identity in dev uses the existing Clerk integration behind the identity adapter | Claude (default, pending plan update) | A deviation from plan rule 7 for **dev only**. Cognito replaces it in production through the same adapter. Record it in the plan's open decisions. |

## Done

- Created `johnniemarbles/platform-hub`, `platform-core`, `spoke-template` (private, by Sanjeev).
- First commit in each:
  - pnpm workspaces (`packages/*` libraries, `apps/*` deployables), `turbo.json`, strict `tsconfig.base.json` (matches expadio), `.nvmrc` 22, pnpm 10.15.0 pinned.
  - `architecture.config.json` + `scripts/architecture/check.ts`, which enforces:
    - Provider SDKs: hub only in `packages/adapters` and `apps/custody`; banned in core and apps.
    - Identity SDKs: core only in `packages/foundation/src/identity`; banned in the hub (sign-in never depends on it) and in apps.
    - Module isolation in core: a module depends only on `foundation`, `core-records`, `contracts`; libraries never depend on apps.
    - Layer direction: the hub never depends on `@platform-core/*` or `@spoke/*`; core uses only `@platform-hub/sdk|contracts`; apps use only the platform and hub SDK, UI and contracts.
    - Permission checks: flags role-name and hard-coded user-ID comparisons outside tests. Escape hatch for display-only code: `// arch-check: allow-role-name (<reason>)`.
    - Turbo wiring: `turbo.json` present; every workspace package has `typecheck` and `test` scripts.
  - CI (`.github/workflows/ci.yml`): install (frozen lockfile), architecture rules, checker tests, script typecheck, typecheck, test, build.
  - `CODEOWNERS`, `README.md` with layout and rules, `.gitignore` that blocks root-level secret and decrypt scripts.

## Proof

| Gate | Result | How to re-run |
| --- | --- | --- |
| Checker unit tests | 9/9 pass in each repo | `pnpm run test:architecture` |
| Architecture check on clean repos | OK, exit 0 | `pnpm run check:architecture` |
| Checker catches violations | Planted stripe dependency + import, module→module dependency and role-name check in platform-core: 4 violations, exit 1; removed afterwards | see "Negative test" below |
| Full local check | exit 0 in all three | `pnpm run check` |
| CI on GitHub | **unverified**: check the first run in the Actions tab of each repo | — |

Negative test (run in platform-core, then delete the two folders):

```bash
mkdir -p packages/crm/src packages/gtm
echo '{"name":"@platform-core/crm","scripts":{"typecheck":"tsc --noEmit","test":"node --test"},"dependencies":{"stripe":"^17"}}' > packages/crm/package.json
echo '{"name":"@platform-core/gtm","scripts":{"typecheck":"tsc --noEmit","test":"node --test"},"dependencies":{"@platform-core/crm":"workspace:*"}}' > packages/gtm/package.json
printf "import Stripe from 'stripe';\nif (user.role === 'admin') {}\n" > packages/crm/src/index.ts
pnpm run check:architecture   # expect 4 violations, exit 1
rm -rf packages/crm packages/gtm
```

## Known limits of the checker

- Static and regex-based. It cannot see dynamic `import(variable)` or tables read through raw SQL. "No module reads another module's tables" needs a database-level control (a schema per module plus grants) in Gate 1.
- The permission-check patterns are heuristics. A false positive is silenced with the comment above, and every use is reviewable in the PR.
- `scripts/architecture/` is copied into each repo. Change it in all three in one sitting, or publish it as a package once a fourth repo needs it.

## Remaining (in order)

### Finish Gate 0 audit (read-only)

1. Fresh pull of `expadio`, BEMP, the dentex repos and TRUXORATMS. Run each test suite and record pass/fail.
2. Inventory every expadio package against the move list. Known so far:
   - `credential-custody`, `provider-registry` and `apps/custody-service` exist.
   - The plan's migration list is partly wrong. 0040 = revocation attestations; 0041 = throttle windows, plane budgets, spend caps, webhook dead letters; 0042 = decision traces; 0043 = a non-disclosure constraint (no table); **0044 = `crm_accounts`/`crm_contacts`, which go to platform-core, not the hub**; 0032 = `credential_lease_events`. The connector credentials table's location is unverified.
   - 448 migration files with 58 duplicated numbers. Key the extraction on table names, not numbers.
   - No `turbo.json` in expadio. Identity is Clerk, not Cognito.
3. Remaining providers: Supabase, Cloudflare, Resend and Stripe (all connected now; read-only calls only). AWS MCP needs a reconnect in claude.ai Settings → Connectors.
4. Write the **Gate 0 Audit** document: inventory table, move list against reality, risks ranked, open questions. Add it to the claude.ai Project files.

### Security items to resolve before any extraction

- expadio root: `brute_force_decrypt.ts`, `decrypt_local*.{js,mjs}`, `encrypt_secret*.ts`, `get_raw_secret.sql`, `get_local_secret.sql` are tracked, and five of the scripts contain long encoded literals. Treat any key material as exposed: rotate the custody wrapping key, then purge these files from history **before** `git filter-repo`, so they never enter the new repos.
- Clerk `sk_test_…` hard-coded in `apps/platform-web/proxy.ts` (lines 65, 86) and `apps/brand-web/proxy.ts` (line 9). Rotate if it's a real instance key.

### Residency and infrastructure findings (Railway, all in `sfo`; buckets in `iad`)

- `pii-ca` (Canada-named) runs in California. Confirm whether it holds real personal data.
- expadio production: single replica per service, two Postgres instances, four overlapping comms-drain crons (one stuck `INITIALIZING` since 20 Oct, so duplicate sends are possible), and `forms-proxy` deployed from an unmerged feature branch. Railway volume backups are unverified.
- Retire candidates: `cooperative-victory` (empty), `dynamic-tenderness` (staged since May, never deployed).
- **Open question for Sanjeev:** which Railway projects hold real customer data? They count as production and go on the migration list.

### Gate 1 (only after the Gate 0 exit test passes)

1. Create a Railway **staging** project (test data only) for hub and core.
2. Extract with history (`git filter-repo`) from expadio, after the secret purge above:
   - to `platform-hub`: `credential-custody`, `provider-registry`, the integration half of `communication`, `apps/custody-service` → `apps/custody`; tables by name: `credential_lease_events`, `credential_revocation_attestations`, `communication_throttle_windows`, `communication_plane_budgets`, `communication_spend_caps`, `communication_webhook_dead_letters`, `communication_decision_traces` (+ `app_id`).
   - to `platform-core`: entity graph (hierarchy), `lead`, `party` (`crm_accounts`, `crm_contacts`), IAM, tenancy, setup state, communications screens and templates.
3. Foundation: identity adapter interface (Clerk dev implementation now, Cognito later), signed short-lived tokens between platform and hub, server-set database context, roles as data.
4. Acceptance tests from the plan, for the slices touched: cross-tenant, cross-app and cross-hierarchy denial; no key fallback; idempotent execution; webhook replay.

## Rollback

- The three repos hold only a frame commit. To undo: delete the repos on GitHub (Settings → Danger zone), or `git revert` the first commit. Nothing else references them yet.
- No changes were made to expadio, BEMP, TRUXORATMS, Railway, AWS or any provider account. Everything else in this session was read-only.
