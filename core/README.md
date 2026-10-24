# platform-core

The platform foundation and the shared business modules, in one Turborepo.

Part of the shared platform described in **Platform Architecture Plan: Hub, Platform and Apps (V3.1)**, the source of truth for this repo. Four repo kinds: `platform-hub`, `platform-core`, `spoke-template`, and one repo per industry app. Dependencies run one way: apps use the platform and the hub; the platform uses the hub; the hub depends on neither.

## Layout

```text
platform-core/            pnpm workspaces + turbo.json
  packages/               libraries (never deployed on their own)
    foundation/           identity adapter, tenancy, hierarchy, roles, residency
    core-records/         people, companies, relationships, consent, timeline
    crm/  scheduling/  gtm/  lms/  tasks-forms/  communications/
    contracts/            JSON Schema per module, semver versioned
    ui/                   design tokens + each module's embeddable components
    sdk/                  typed client apps use
  apps/                   things that deploy
    platform-api/         loads every module; one service per region
    jobs/                 background work per region
```

Packages are named `@platform-core/<name>`. Packages are added when they are needed, never ahead of demand.

## Rules enforced here

1. `packages/` holds libraries, `apps/` holds what deploys. A library never depends on an app.
2. A module may depend only on `foundation`, `core-records` and `contracts`, never on another module. CI fails otherwise.
3. No module reads another module's tables. Modules talk through versioned contracts and events written to a transactional outbox, consumed durably with deduplication.
4. A feature becomes a module only when a second app needs it and it makes sense without knowing the industry.
5. Roles are data: code checks permission keys, never role names or user IDs. CI flags role-name comparisons.
6. No provider SDKs here. Outside providers are reached only through `@platform-hub/sdk`. Identity SDKs are allowed only in `packages/foundation/src/identity`.
7. Database context (tenant, app, hierarchy scope) is set server-side from the verified token, never from the client.

The rules live in `architecture.config.json` and are checked by `scripts/architecture/check.ts` on every pull request.

## Commands

```bash
corepack enable
pnpm install
pnpm run check                 # architecture rules, their tests, typecheck, tests
pnpm run check:architecture    # layer rules only
pnpm turbo dev --filter=<package>
```

Requires Node 22 or later and pnpm 10.15 (pinned through `packageManager`).

## Environments

Development and staging run on Railway with **test data only**. Production regional cells (India, Canada, US, UK, Australia) follow the plan's residency rules and are opened when a country's first customer signs.
