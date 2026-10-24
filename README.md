# Platform Monorepo

Unified multi-tenant platform infrastructure and integration hub for industry applications.

- **`hub/`**: Integration hub for external provider SDKs (email, SMS, AI, storage, payments).
- **`core/packages/`**: Foundation packages (identity, tenancy, authorization, DB context) and shared business modules (scheduling, CRM, GTM, learning).
- **`core/apps/`**: Regional `platform-api` providing unified REST endpoints across activated tenant apps.
- **`core/app-packs/`**: App-owned server extensions and migrations loaded by `platform-api`.
- **`core/ui/`**: Presentation-only reusable UI component kits (`@platform-ui/*`).

For agent instructions and architectural rules, see [AGENTS.md](./AGENTS.md).
