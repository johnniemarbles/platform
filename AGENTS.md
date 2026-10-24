# Agent Instructions

Read `AI-WORK-ORDER.md` first before making any changes.

## Architectural Zones & Layering Rules
Every workspace package belongs to an architectural zone defined in `architecture.config.json`:
1. **`hub/` (`hub`)**: Only zone allowed to import external provider SDKs. Never depends on core, app-packs, or UI.
2. **`core/packages/` (foundation)**: Core platform plumbing (tenancy, IAM, DB context, authorization). May only depend on foundation and `@platform-hub/contracts`.
3. **`core/packages/` (modules)**: Industry-neutral business capability packages (CRM, scheduling, GTM). May depend on foundation and contracts. Never depend on another module (Plan rule 2).
4. **`core/app-packs/` (`core-app-packs`)**: App-owned server code and records. May use modules' public exports. Never depends on another app pack.
5. **`core/apps/` (`core-apps`)**: `platform-api`. Dispatches HTTP requests across active tenant apps.
6. **`core/ui/` (`core-ui`)**: Presentation only. No `fetch()`, no provider SDK, no runtime `@platform-core/*` imports.

## Commit Gate
Always run `pnpm run check` before every commit:
- Architecture guard (`check:architecture`)
- Architecture test suite (`test:architecture`)
- TypeScript validation (`typecheck`)
- Migration dry-run (`db:dryrun`)
- Package test suites (`test`)

## Migration Numbering Policy
- Core foundation fixes: free number in `0009–0039`.
- Extracted from expadio: keep original filename if free in core; otherwise renumber into `1000+` and put `-- extracted from expadio <original filename>` on line 1.
- Net-new module work: `1000+`.
- Hub: unchanged.
- App packs: `0001+` inside the pack directory (`core/app-packs/<slug>/migrations/`).
- The migration runner refuses to start if the same filename exists in both core and hub.
