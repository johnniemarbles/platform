-- extracted from expadio 0156_crm_lead_contact_fields.sql at b2c2811d
BEGIN;

-- Extend crm_leads with contact-identity fields for manually entered leads.
--
-- Previously, manual leads only captured a title and financial fields.
-- Brand operators need to record the prospect's name, email, phone, and
-- the interest type they enquired about — the same information a lead
-- would submit through a hosted form.
--
-- contact_name, contact_email, contact_phone: the individual who made
--   the enquiry. Nullable for historical rows and programmatic leads that
--   attach a crm_contact via contact_id instead.
-- enquiry_interest_type / enquiry_opportunity_type: the commercial interest
--   the prospect expressed. Kept separate from the schema-level
--   interest_type on lead_management_configurations; this is the prospect's
--   self-declared interest recorded at lead creation time.
-- raw_payload: already exists as jsonb; this migration does not change it.

ALTER TABLE platform.crm_leads
  ADD COLUMN IF NOT EXISTS contact_name text CHECK (contact_name IS NULL OR char_length(btrim(contact_name)) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS contact_email text CHECK (contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN IF NOT EXISTS contact_phone text CHECK (contact_phone IS NULL OR char_length(btrim(contact_phone)) BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS enquiry_interest_type text CHECK (enquiry_interest_type IS NULL OR enquiry_interest_type IN (
    'FRANCHISEE', 'MASTER_FRANCHISEE', 'DISTRIBUTOR', 'AFFILIATE', 'LICENSEE', 'AGENT'
  )),
  ADD COLUMN IF NOT EXISTS enquiry_opportunity_type text CHECK (enquiry_opportunity_type IS NULL OR enquiry_opportunity_type IN (
    'SINGLE_UNIT', 'MULTI_UNIT', 'AREA_DEVELOPMENT', 'CONVERSION', 'RESALE',
    'EXCLUSIVE_DISTRIBUTOR', 'NON_EXCLUSIVE_DISTRIBUTOR', 'MASTER_DISTRIBUTOR', 'SUB_DISTRIBUTOR'
  ));

COMMENT ON COLUMN platform.crm_leads.contact_name IS
  'Prospect full name as entered at lead creation. Nullable for programmatic leads that link via contact_id.';
COMMENT ON COLUMN platform.crm_leads.contact_email IS
  'Prospect email address. Nullable.';
COMMENT ON COLUMN platform.crm_leads.contact_phone IS
  'Prospect phone number. Nullable. Not validated beyond length; international formats vary.';
COMMENT ON COLUMN platform.crm_leads.enquiry_interest_type IS
  'The commercial interest type the prospect expressed (e.g. FRANCHISEE). Separate from lead_management_configurations.interest_type which governs the capture schema.';
COMMENT ON COLUMN platform.crm_leads.enquiry_opportunity_type IS
  'Narrows enquiry_interest_type (e.g. SINGLE_UNIT for a FRANCHISEE enquiry). Optional.';

COMMIT;
