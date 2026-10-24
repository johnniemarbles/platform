-- extracted from expadio 0058_crm_case_attributes_schema_version.sql at b2c2811d
BEGIN;

-- Industry Pack schema versioning — tie a case's stored attributes to the schema
-- revision that validated them.
--
-- migration 0057 gave a case a JSONB `attributes` bag whose shape is the active
-- pack's caseSchema. A pack evolves: DENTEX v1's urgency options become v2's.
-- Without recording which schema version produced a value bag, historical cases
-- get silently reinterpreted under the new field set. This column stamps the
-- CaseSchema.version that validated each case's attributes at write time.
--
-- Nullable: the neutral engine has no schema (version 0), stored as NULL — a
-- case with no pack data carries no schema version. Display-only in spirit:
-- canonical columns, authorization and RLS are untouched.

ALTER TABLE platform.crm_cases
  ADD COLUMN IF NOT EXISTS attributes_schema_version integer;

COMMIT;
