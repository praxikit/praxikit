-- Accounts and private collections. Safe to run more than once (every statement is IF NOT EXISTS).
-- Run ONCE on the live database after pulling:
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0006_accounts.sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                -- the GitHub user id: all we keep to recognise a person
  login TEXT NOT NULL,                   -- the GitHub username at the last sign-in
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection (
  user_id INTEGER NOT NULL,
  item TEXT NOT NULL,                    -- a kit page path ("k/keel/") or a listed repository link; checked against the live catalogue when saved
  label TEXT NOT NULL DEFAULT '',        -- the person's own group name, up to 24 characters
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item)
);
CREATE INDEX IF NOT EXISTS collection_by_time ON collection (user_id, added_at);
