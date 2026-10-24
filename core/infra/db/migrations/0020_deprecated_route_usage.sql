BEGIN;
-- Usage tracking for deprecated major-version routes.
-- Aggregated daily by (app_id, route, day). No tenant data, so no RLS.
CREATE TABLE IF NOT EXISTS platform.deprecated_route_usage (
  app_id   text NOT NULL,
  route    text NOT NULL,
  day      date NOT NULL,
  calls    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, route, day)
);
COMMIT;
