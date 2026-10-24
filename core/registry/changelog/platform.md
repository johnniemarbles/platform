# Platform Foundation Module Changelog

## 1.0.0 — 2026-10-24

### Added
- Core platform caller context resolution (`GET /v1/me`).
- Permission catalog and bundle registry synchronization.
- Tenant administration APIs (`/v1/admin/*`).
- Published `@platform-sdk/platform` client with contract tests.

### Permissions
- `me.read`: Read current identity, tenant, and membership permissions context.
- `admin.role.read`: View roles, permission catalog, and member roles.
- `admin.role.manage`: Manage custom roles, bundles, and overrides.
- `admin.member.search`: Search members within the tenant.
- `admin.member.assign`: Grant and revoke role assignments within authority.
- Bundle `platform.member`: `me.read`.
- Bundle `platform.admin`: `admin.role.read`, `admin.role.manage`, `admin.member.search`, `admin.member.assign`.
