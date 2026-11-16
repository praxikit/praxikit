-- Tags: a submission remembers the repository's GitHub topics, and the approval records the tags that were chosen.
-- Run ONCE on a database that has migration 0004:
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0005_tags.sql
-- (A database created from the current schema.sql already has these columns; do not run this on it.)
ALTER TABLE submissions ADD COLUMN topics TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN final_tags TEXT NOT NULL DEFAULT '';
