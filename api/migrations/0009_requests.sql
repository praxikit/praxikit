-- Kit requests and "I need this too". Safe to run more than once (IF NOT EXISTS).
-- Run ONCE on the live database after pulling (or from Actions: migrate).
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  login TEXT NOT NULL,                   -- shown next to the request
  title TEXT NOT NULL,                   -- "What do you need?", 8 to 100 characters, plain text, no links
  body TEXT NOT NULL DEFAULT '',         -- optional detail, up to 500 characters
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','open','hidden','solved')),
  solved_item TEXT NOT NULL DEFAULT '',  -- the listed kit that solves it, set by a maintainer
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_by_status ON requests (status, created_at);
CREATE TABLE IF NOT EXISTS request_needs (
  request_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, user_id)
);
