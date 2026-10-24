# CRM-Advanced Module Changelog

## 1.0.0 — 2026-10-24

### Added
- Generic CRM engine with Accounts, Contacts, Leads, Cases, and Agreements.
- Governed stage transition API (`POST /v1/crm/leads/:id/transition`).
- Atomic lead-to-customer conversion API (`POST /v1/crm/leads/:id/convert`) creating or promoting customer accounts, binding agreements, and opening delivery cases.
- Organization and subtree hierarchy isolation via `@platform-core/db-context` and closure model.
- Published `@platform-sdk/crm` client with comprehensive contract tests.

### Permissions
- `crm.account.read`: View customer accounts.
- `crm.account.write`: Create and update accounts.
- `crm.contact.read`: View contacts.
- `crm.contact.write`: Create and update contacts.
- `crm.lead.read`: View sales leads.
- `crm.lead.write`: Create and update sales leads.
- `crm.lead.transition`: Move leads through governed stages.
- `crm.lead.convert`: Convert won leads into customer accounts, agreements, and cases.
- `crm.case.read`: View customer cases.
- `crm.case.write`: Create and update cases.
- `crm.agreement.read`: View agreements.
- `crm.agreement.write`: Create and update agreements.

### Bundles
- `crm.staff`: Standard day-to-day sales pipeline operations.
- `crm.manager`: Full management including conversion, case creation, and customer agreements.
