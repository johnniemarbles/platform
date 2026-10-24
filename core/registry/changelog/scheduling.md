# Scheduling Module Changelog

## 0.1.0 — 2026-10-24

### Added
- Initial appointment scheduling engine (`POST /v1/bookings`, `GET /v1/bookings`).
- Published `@platform-sdk/scheduling` client with contract tests.

### Permissions
- `bookings.create`: Create new appointments.
- `bookings.read`: View existing appointments.
- Bundle `scheduling.staff` with `autoGrant: true`.
