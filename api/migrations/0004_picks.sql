-- "My picks": the maintainer can say they use a kit, with a one-line note. Run ONCE on a database that has migration 0003:
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0004_picks.sql
-- (A database created from the current schema.sql already has these columns; do not run this on it.)
ALTER TABLE submissions ADD COLUMN final_pick INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN final_note TEXT NOT NULL DEFAULT '';
