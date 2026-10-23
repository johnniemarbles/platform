BEGIN;

-- Scheduling / Bookings foundation (ADR-018).
-- Tenant-scoped and RLS-forced: isolation is enforced at the data layer
-- via platform.current_tenant_id().

CREATE TABLE IF NOT EXISTS platform.bookings (
  booking_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  app_id           text NOT NULL CHECK (btrim(app_id) <> ''),
  patient_name     text NOT NULL CHECK (char_length(patient_name) BETWEEN 1 AND 200),
  patient_email    text NOT NULL CHECK (char_length(patient_email) BETWEEN 3 AND 255),
  patient_phone    text,
  service_key      text NOT NULL DEFAULT 'general-checkup',
  chair_id         text NOT NULL DEFAULT 'chair-1',
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
  chief_complaint  text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS bookings_tenant_idx ON platform.bookings(tenant_id, status, starts_at);

ALTER TABLE platform.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY bookings_tenant_isolation ON platform.bookings
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
