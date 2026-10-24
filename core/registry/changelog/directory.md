# directory Changelog

## 1.0.0 (2026-10-24)

- Initial release of `@platform-core/directory` and `@platform-sdk/directory`.
- Industry-neutral directory listings (clinics, salons, properties).
- App-scoped and tenant-isolated listings with unique slug per tenant/app.
- Google Places and external provider deduplication/upsert via `externalProvider` and `externalRef`.
- Listing claim workflow (`PENDING` -> `CLAIMED`/`UNCLAIMED`).
- Time-bounded featured slot allocation and query.
- Migration `1001_directory.sql`.
