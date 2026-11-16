-- Event log for rate limits and strikes, plus indexes. Safe to run more than once (IF NOT EXISTS).
-- Run ONCE on the live database after pulling (or from Actions: migrate).
CREATE TABLE IF NOT EXISTS events (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- submission, save, vote, note, request, need, report, strike, deleted
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_lookup ON events (user_id, kind, created_at);
-- lookups that no longer scan whole tables
CREATE INDEX IF NOT EXISTS collection_by_item ON collection (item);
CREATE INDEX IF NOT EXISTS submissions_repo_nocase ON submissions (repo_url COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS users_login_unique ON users (login COLLATE NOCASE);
