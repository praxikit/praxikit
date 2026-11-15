-- Phase 3: what happens after a maintainer decides. Run ONCE on a database created with the phase 2 schema:
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0002_publish.sql
-- (A database created from the current schema.sql already has these columns; do not run this on it.)
ALTER TABLE submissions ADD COLUMN publish_state TEXT NOT NULL DEFAULT '';   -- '', dispatching, dispatched, listed, blocked
ALTER TABLE submissions ADD COLUMN publish_note TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN final_name TEXT NOT NULL DEFAULT '';      -- what the maintainer confirmed at approval
ALTER TABLE submissions ADD COLUMN final_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN final_text TEXT NOT NULL DEFAULT '';
