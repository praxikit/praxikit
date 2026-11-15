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
  final_note TEXT NOT NULL DEFAULT ''       -- how they use it, one line, shown on the card for a pick
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_repo ON submissions (repo_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS by_user_time ON submissions (submitted_by_id, created_at);
CREATE INDEX IF NOT EXISTS by_status ON submissions (status, created_at);
