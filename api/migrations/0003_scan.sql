-- Phase 3b: the full checks run before a decision. Run ONCE on a database that has migration 0002:
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0003_scan.sql
-- (A database created from the current schema.sql already has these columns; do not run this on it.)
ALTER TABLE submissions ADD COLUMN scan_state TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN scan_label TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN scan_commit TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN scan_run_url TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN scan_at TEXT NOT NULL DEFAULT '';
