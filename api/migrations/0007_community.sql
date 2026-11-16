-- Votes and short notes on kits. Safe to run more than once (every statement is IF NOT EXISTS).
-- Run ONCE on the live database after pulling:
--   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0007_community.sql
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
