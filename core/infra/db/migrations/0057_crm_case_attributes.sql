-- extracted from expadio 0057_crm_case_attributes.sql at b2c2811d
BEGIN;

-- Industry Pack case data — a JSONB bag of pack-declared domain fields on a case.
--
-- The Industry Pack reskins the neutral engine; until now it changed only
-- display text. This lets a pack configure *data*: DENTEX's Treatment carries a
-- tooth, a procedure code and an urgency that a generic case does not. The pack
-- declares the field set (@expadio/industry-packs caseSchema); the route
-- validates and stores the values here.
--
-- Display-only in spirit: canonical columns, authorization and RLS are
-- untouched, and the neutral engine simply stores an empty object. The column
-- lives on crm_cases, already tenant-isolated by its RLS policy, so reads and
-- writes stay scoped to the caller's tenant.

ALTER TABLE platform.crm_cases
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
