-- Praxikit admin app: submissions waiting for, or past, a maintainer's decision.
-- Apply with:  npx wrangler d1 execute praxikit-admin --remote --file=schema.sql
-- Safe to run again: every statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_url TEXT NOT NULL,
  repo_key TEXT NOT NULL,                -- lowercase owner/repo, used to refuse duplicates
  name TEXT NOT NULL,
  owner TEXT NOT NULL,                   -- the repository's owner on GitHub: "created by"
  owner_type TEXT NOT NULL,              -- User or Organization
  submitted_by TEXT NOT NULL,            -- the signed-in GitHub login
  submitted_by_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('community','recommended')),  -- decided by GitHub identity, not by the form
  kind_guess TEXT NOT NULL DEFAULT '',   -- a guess from file names; a maintainer confirms
  license TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL,              -- the commit that was looked at
  readme_url TEXT NOT NULL DEFAULT '',
  readme_excerpt TEXT NOT NULL DEFAULT '',  -- plain text, never rendered as markup
  why TEXT NOT NULL DEFAULT '',          -- optional note from the submitter, max 200 characters
  precheck TEXT NOT NULL,                -- JSON: [{title,status,note}]
  precheck_status TEXT NOT NULL CHECK (precheck_status IN ('pass','flag','fail')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  created_at TEXT NOT NULL,
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  publish_state TEXT NOT NULL DEFAULT '',   -- '', dispatching, dispatched, listed, blocked (phase 3)
  publish_note TEXT NOT NULL DEFAULT '',
  final_name TEXT NOT NULL DEFAULT '',      -- what the maintainer confirmed at approval
  final_kind TEXT NOT NULL DEFAULT '',
  final_text TEXT NOT NULL DEFAULT '',
  scan_state TEXT NOT NULL DEFAULT '',      -- '', running, done, failed: the full checks run before a decision (phase 3b)
  scan_label TEXT NOT NULL DEFAULT '',      -- no-flags-found, checks-flagged, checks-failed or needs-manual-review
  scan_commit TEXT NOT NULL DEFAULT '',     -- the first 12 characters of the commit the checks ran on
  scan_run_url TEXT NOT NULL DEFAULT '',    -- where the full report is
  scan_at TEXT NOT NULL DEFAULT '',
  final_pick INTEGER NOT NULL DEFAULT 0,    -- 1 when the maintainer ticked "I use this" at approval
  final_note TEXT NOT NULL DEFAULT '',      -- how they use it, one line, shown on the card for a pick
  topics TEXT NOT NULL DEFAULT '',          -- the repository's GitHub topics, cleaned, comma-separated: the starting tags
  final_tags TEXT NOT NULL DEFAULT ''       -- the tags the maintainer confirmed at approval, comma-separated
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_repo ON submissions (repo_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS by_user_time ON submissions (submitted_by_id, created_at);
CREATE INDEX IF NOT EXISTS by_status ON submissions (status, created_at);

-- Accounts and collections (migration 0006). Private to each person; nothing in the app shows one person's collection to another.
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

-- Helped-me votes and short notes (migration 0007).
CREATE TABLE IF NOT EXISTS votes (
  user_id INTEGER NOT NULL,
  item TEXT NOT NULL,                    -- the same item key as a collection: "k/keel/" or a listed repository link
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item)
);
CREATE INDEX IF NOT EXISTS votes_by_item ON votes (item);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  login TEXT NOT NULL,                   -- shown next to the note
  item TEXT NOT NULL,
  text TEXT NOT NULL,                    -- plain text, 10 to 240 characters, no links
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  reports INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, item)                 -- one note per person per kit; writing again replaces it
);
CREATE INDEX IF NOT EXISTS notes_by_item ON notes (item, status);
CREATE TABLE IF NOT EXISTS note_reports (
  note_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, user_id)
);

-- Contributor profiles (migration 0008): public only when the person says so.
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY,
  public INTEGER NOT NULL DEFAULT 1,     -- 1 = name shown (also what no row means); 0 = the person chose to hide it
  updated_at TEXT NOT NULL
);

-- Kit requests (migration 0009): people ask for a kit, others press "I need this too".
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

-- Hardening (migration 0010): an event log for limits and moderation strikes, and indexes for the public reads.
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
