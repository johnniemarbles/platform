# Module Change Policy

All module changes in the platform monorepo must follow semantic versioning rules enforced by CI.

| Change | Version bump | Notes |
|---|---|---|
| New route; new optional request field; new response field; new enum value only in responses | minor | Old clients unaffected |
| New permission key in a bundle | minor | `autoGrant` decided per E.1 rules; recorded in the changelog |
| Bug fix with identical contract | patch | |
| Remove or rename a route, field, or permission key; make an optional request field required; tighten validation; change meaning of a field or state | **major** | Old major keeps running side by side until sunset |
| New database migration | minor (or major if it removes/renames a column a route exposes) | Two-step for destructive changes (operating decision 2) |
| Remove a bundle key | **major** | Never in a minor |

## Changelogs
Every module maintained in `core/registry/modules.json` has a changelog at `core/registry/changelog/<module>.md`. Each version section must follow the format:

```markdown
## <version> — <YYYY-MM-DD>

### Added
- Plain language summary of new capabilities

### Changed
- Details of contract modifications

### Deprecated
- Features marked for future removal

### Removed
- Features removed (major only)

### Permissions
- Permission changes or additions
```
