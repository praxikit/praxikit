-- Public contributor profiles. Safe to run more than once (IF NOT EXISTS).
-- Run ONCE on the live database after pulling (or from Actions: migrate):
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0008_profiles.sql
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY,
  public INTEGER NOT NULL DEFAULT 0,     -- 1 once the person chose to be credited and listed as a contributor; never set for them
  updated_at TEXT NOT NULL
);
