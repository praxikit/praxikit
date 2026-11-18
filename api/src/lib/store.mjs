/**
 * Submissions in Cloudflare D1 (SQLite). Every query is a prepared statement with bound values;
 * nothing is ever built by joining strings. `db` is the D1 binding.
 */
const COLUMNS = ["repo_url", "repo_key", "name", "owner", "owner_type", "submitted_by", "submitted_by_id", "source", "kind_guess", "license", "commit_sha", "readme_url", "readme_excerpt", "why", "precheck", "precheck_status", "created_at", "topics"];

export function d1Store(db) {
  return {
    /** Adds a pending submission and returns its id. Throws Error("duplicate") if that repository is already pending. */
    async insert(s) {
      try {
        const r = await db.prepare(`INSERT INTO submissions (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`).bind(...COLUMNS.map((c) => s[c])).run();
        return Number(r.meta?.last_row_id);
      } catch (e) {
        if (/UNIQUE/i.test(String(e?.message))) throw new Error("duplicate");
        throw e;
      }
    },
    async countSince(userId, iso) {
      const rows = Number((await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitted_by_id = ? AND created_at >= ?").bind(userId, iso).first())?.n ?? 0);
      const events = Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'submission' AND created_at >= ?").bind(userId, iso).first())?.n ?? 0);
      return Math.max(rows, events);
    },
    async get(id) { return (await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first()) ?? null; },
    async pending(limit = 100) { return (await db.prepare("SELECT * FROM submissions WHERE status = 'pending' ORDER BY id DESC LIMIT ?").bind(limit).all()).results ?? []; },
    async recent(limit = 15) { return (await db.prepare("SELECT * FROM submissions WHERE status <> 'pending' ORDER BY id DESC LIMIT ?").bind(limit).all()).results ?? []; },
    /** Approving is one atomic step: it only succeeds while the submission is still pending. Returns true if it did. */
    async approve(id, { by, name, kind, text, at, pick = false, note = "", tags = "" }) {
      const r = await db.prepare("UPDATE submissions SET status = 'approved', decided_by = ?, decided_at = ?, final_name = ?, final_kind = ?, final_text = ?, final_pick = ?, final_note = ?, final_tags = ?, publish_state = 'dispatching', publish_note = '' WHERE id = ? AND status = 'pending'").bind(by, at, name, kind, text, pick ? 1 : 0, pick ? note : "", tags, id).run();
      return Number(r.meta?.changes) === 1;
    },
    async reject(id, { by, note, at }) {
      const r = await db.prepare("UPDATE submissions SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(by, at, note, id).run();
      return Number(r.meta?.changes) === 1;
    },
    async setCommit(id, sha) { await db.prepare("UPDATE submissions SET commit_sha = ? WHERE id = ? AND status = 'pending'").bind(sha, id).run(); },
    async setPublish(id, state, note = "") { await db.prepare("UPDATE submissions SET publish_state = ?, publish_note = ? WHERE id = ? AND status = 'approved'").bind(state, note, id).run(); },
    /** A blocked publish can be tried again; this flips it back and reports whether it was blocked. */
    async retry(id) {
      const r = await db.prepare("UPDATE submissions SET publish_state = 'dispatching', publish_note = '' WHERE id = ? AND status = 'approved' AND publish_state = 'blocked'").bind(id).run();
      return Number(r.meta?.changes) === 1;
    },
    /** Records where the full checks stand. Only a pending submission can be scanned. */
    async setScan(id, { state, label = "", commit = "", runUrl = "", at = "" }) {
      const r = await db.prepare("UPDATE submissions SET scan_state = ?, scan_label = ?, scan_commit = ?, scan_run_url = ?, scan_at = ? WHERE id = ? AND status = 'pending'").bind(state, label, commit, runUrl, at, id).run();
      return Number(r.meta?.changes) === 1;
    },
    async scanning(limit = 10) { return (await db.prepare("SELECT * FROM submissions WHERE status = 'pending' AND scan_state = 'running' ORDER BY id LIMIT ?").bind(limit).all()).results ?? []; },
    /** A publish that was blocked (for instance by a flagged scan) goes back to review so the checks can be read. */
    async reopen(id) {
      const r = await db.prepare("UPDATE submissions SET status = 'pending', publish_state = '', publish_note = '', decided_by = '', decided_at = '' WHERE id = ? AND status = 'approved' AND publish_state = 'blocked'").bind(id).run();
      return Number(r.meta?.changes) === 1;
    },
    async inFlight(limit = 10) { return (await db.prepare("SELECT * FROM submissions WHERE status = 'approved' AND publish_state IN ('dispatching','dispatched') ORDER BY id LIMIT ?").bind(limit).all()).results ?? []; },
    /** Records something a person did. Old records are tidied now and then: two days for most, thirty for strikes. */
    async record(userId, kind, at) {
      await db.prepare("INSERT INTO events (user_id, kind, created_at) VALUES (?, ?, ?)").bind(userId, kind, at).run();
      if (Math.random() < 0.02) {
        const t = Date.parse(at) || Date.now();
        await db.prepare("DELETE FROM events WHERE (kind NOT IN ('strike') AND created_at < ?) OR created_at < ?").bind(new Date(t - 2 * 86400_000).toISOString(), new Date(t - 30 * 86400_000).toISOString()).run();
      }
    },
    /** True if a maintainer hid or deleted something of this person's in the last thirty days: their next note or request is read first. */
    async hasRecentStrike(userId, at) { return (await this.eventsSince(userId, "strike", new Date((Date.parse(at) || Date.now()) - 30 * 86400_000).toISOString())) > 0; },
    /** True if this account was deleted in the last few hours: a copy of the sign-in on another device must not bring it back. */
    async recentlyDeleted(userId, at) { return (await this.eventsSince(userId, "deleted", new Date((Date.parse(at) || Date.now()) - 6 * 3600_000).toISOString())) > 0; },
    async eventsSince(userId, kind, iso) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = ? AND created_at >= ?").bind(userId, kind, iso).first())?.n ?? 0); },
    // ---- accounts and collections. A person's rows are only ever read or changed by their own id.
    async touchUser(id, login, at) {
      // a GitHub name can pass to someone else after a rename: the old holder's copy stops being a usable name
      await db.prepare("UPDATE users SET login = login || '~' || id WHERE login = ? COLLATE NOCASE AND id <> ?").bind(login, id).run();
      await db.prepare("INSERT INTO users (id, login, created_at, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET login = excluded.login, last_seen = excluded.last_seen").bind(id, login, at, at).run();
    },
    async getUser(id) { return (await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first()) ?? null; },
    async collectionOf(userId, limit = 500) { return (await db.prepare("SELECT item, label, added_at FROM collection WHERE user_id = ? ORDER BY added_at DESC LIMIT ?").bind(userId, limit).all()).results ?? []; },
    async collectionCount(userId) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM collection WHERE user_id = ?").bind(userId).first())?.n ?? 0); },
    async collectionSince(userId, iso) { return Math.max(Number((await db.prepare("SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND added_at >= ?").bind(userId, iso).first())?.n ?? 0), Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'save' AND created_at >= ?").bind(userId, iso).first())?.n ?? 0)); },
    async hasItem(userId, item) { return !!(await db.prepare("SELECT 1 AS x FROM collection WHERE user_id = ? AND item = ?").bind(userId, item).first()); },
    /** Saves an item, or changes its label if it is already saved (the original date stays). */
    async saveItem(userId, item, label, at) {
      await db.prepare("INSERT INTO collection (user_id, item, label, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET label = excluded.label").bind(userId, item, label, at).run();
    },
    async removeItem(userId, item) { await db.prepare("DELETE FROM collection WHERE user_id = ? AND item = ?").bind(userId, item).run(); },
    /**
     * Deletes the account: the collection and the user row go. Waiting submissions are withdrawn and deleted; decided ones stay as
     * the catalogue's own record, with the person's name and id removed.
     */
    async deleteAccount(userId) {
      const q = (sql, ...args) => db.prepare(sql).bind(...args);
      const statements = [
        q("DELETE FROM collection WHERE user_id = ?", userId),
        q("DELETE FROM votes WHERE user_id = ?", userId),
        q("DELETE FROM profiles WHERE user_id = ?", userId),
        q("DELETE FROM request_needs WHERE request_id IN (SELECT id FROM requests WHERE user_id = ?) OR user_id = ?", userId, userId),
        q("DELETE FROM requests WHERE user_id = ?", userId),
        q("DELETE FROM note_reports WHERE note_id IN (SELECT id FROM notes WHERE user_id = ?) OR user_id = ?", userId, userId),
        q("DELETE FROM notes WHERE user_id = ?", userId),
        q("DELETE FROM submissions WHERE submitted_by_id = ? AND status = 'pending'", userId),
        q("UPDATE submissions SET submitted_by = 'deleted-account', submitted_by_id = 0 WHERE submitted_by_id = ?", userId),
        q("INSERT INTO events (user_id, kind, created_at) VALUES (?, 'deleted', ?)", userId, new Date().toISOString()),
        q("DELETE FROM users WHERE id = ?", userId),
      ];
      // all or nothing where the database supports it
      if (typeof db.batch === "function") await db.batch(statements); else for (const st of statements) await st.run();
    },
    // ---- kit requests
    async requestsPublic(limit = 200) { return (await db.prepare("SELECT r.id AS id, CASE WHEN COALESCE(p.public, 1) = 1 THEN r.login ELSE '' END AS login, r.title AS title, r.body AS body, r.status AS status, r.solved_item AS solved_item, r.created_at AS created_at, (SELECT COUNT(*) FROM request_needs n WHERE n.request_id = r.id) AS needs FROM requests r LEFT JOIN profiles p ON p.user_id = r.user_id WHERE r.status IN ('open','solved') ORDER BY needs DESC, r.id DESC LIMIT ?").bind(limit).all()).results ?? []; },
    async myRequests(userId) { return (await db.prepare("SELECT id, title, body, status, created_at FROM requests WHERE user_id = ? AND status IN ('pending','hidden') ORDER BY id DESC LIMIT 20").bind(userId).all()).results ?? []; },
    async neededBy(userId) { return ((await db.prepare("SELECT request_id FROM request_needs WHERE user_id = ?").bind(userId).all()).results ?? []).map((r) => Number(r.request_id)); },
    async requestById(id) { return (await db.prepare("SELECT id, user_id, login, title, status, solved_item FROM requests WHERE id = ?").bind(id).first()) ?? null; },
    async requestsSince(userId, iso) { return Math.max(Number((await db.prepare("SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND created_at >= ?").bind(userId, iso).first())?.n ?? 0), Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'request' AND created_at >= ?").bind(userId, iso).first())?.n ?? 0)); },
    async hasShownRequest(userId) { return !!(await db.prepare("SELECT 1 AS x FROM requests WHERE user_id = ? AND status IN ('open','solved')").bind(userId).first()); },
    async needsSince(userId, iso) { return Math.max(Number((await db.prepare("SELECT COUNT(*) AS n FROM request_needs WHERE user_id = ? AND created_at >= ?").bind(userId, iso).first())?.n ?? 0), Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'need' AND created_at >= ?").bind(userId, iso).first())?.n ?? 0)); },
    /** Adds a request; the person asking counts as needing it. Returns its id. */
    async addRequest(userId, login, title, body, status, at) {
      const r = await db.prepare("INSERT INTO requests (user_id, login, title, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, login, title, body, status, at).run();
      const id = Number(r.meta?.last_row_id);
      await db.prepare("INSERT OR IGNORE INTO request_needs (request_id, user_id, created_at) VALUES (?, ?, ?)").bind(id, userId, at).run();
      return id;
    },
    /** "I need this too": press again to take it back. Only a request that is shown can be pressed. Returns { needed, needs } or null. */
    async toggleNeed(userId, id, at) {
      const r = await db.prepare("SELECT status FROM requests WHERE id = ?").bind(id).first();
      if (!r || !["open", "solved"].includes(r.status)) return null;
      const has = await db.prepare("SELECT 1 AS x FROM request_needs WHERE request_id = ? AND user_id = ?").bind(id, userId).first();
      if (has) await db.prepare("DELETE FROM request_needs WHERE request_id = ? AND user_id = ?").bind(id, userId).run();
      else await db.prepare("INSERT OR IGNORE INTO request_needs (request_id, user_id, created_at) VALUES (?, ?, ?)").bind(id, userId, at).run();
      return { needed: !has, needs: Number((await db.prepare("SELECT COUNT(*) AS n FROM request_needs WHERE request_id = ?").bind(id).first())?.n ?? 0) };
    },
    async deleteOwnRequest(userId, id) {
      const r = await db.prepare("SELECT id FROM requests WHERE id = ? AND user_id = ? AND status <> 'solved'").bind(id, userId).first();
      if (!r) return false;
      await db.prepare("DELETE FROM request_needs WHERE request_id = ?").bind(id).run();
      await db.prepare("DELETE FROM requests WHERE id = ?").bind(id).run();
      return true;
    },
    async requestsToReview(limit = 100) { return (await db.prepare("SELECT r.id AS id, r.login AS login, r.title AS title, r.body AS body, r.status AS status, (SELECT COUNT(*) FROM request_needs n WHERE n.request_id = r.id) AS needs FROM requests r WHERE r.status IN ('pending','open') ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id LIMIT ?").bind(limit).all()).results ?? []; },
    async requestsToReviewCount() { return Number((await db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").first())?.n ?? 0); },
    /** A maintainer's decision: show (open), hide, delete, or solve with the listed kit that answers it. */
    async decideRequest(id, action, item = "") {
      if (action === "hide" || action === "delete") { const r = await db.prepare("SELECT user_id FROM requests WHERE id = ?").bind(id).first(); if (r) await db.prepare("INSERT INTO events (user_id, kind, created_at) VALUES (?, 'strike', ?)").bind(r.user_id, new Date().toISOString()).run(); }
      if (action === "delete") { await db.prepare("DELETE FROM request_needs WHERE request_id = ?").bind(id).run(); await db.prepare("DELETE FROM requests WHERE id = ?").bind(id).run(); return true; }
      const map = { show: ["open", ""], hide: ["hidden", ""], solve: ["solved", item] };
      if (!map[action]) return false;
      const r = await db.prepare("UPDATE requests SET status = ?, solved_item = ? WHERE id = ?").bind(map[action][0], map[action][1], id).run();
      return Number(r.meta?.changes) === 1;
    },
    async requestsOf(userId) { return (await db.prepare("SELECT title, body, status, created_at FROM requests WHERE user_id = ?").bind(userId).all()).results ?? []; },
    async needsOf(userId) { return (await db.prepare("SELECT request_id, created_at FROM request_needs WHERE user_id = ?").bind(userId).all()).results ?? []; },
    // ---- contributor profiles. A profile is public only when its owner switched it on.
    async setPublic(userId, on, at) { await db.prepare("INSERT INTO profiles (user_id, public, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET public = excluded.public, updated_at = excluded.updated_at").bind(userId, on ? 1 : 0, at).run(); },
    async isPublic(userId) { return Number((await db.prepare("SELECT public FROM profiles WHERE user_id = ?").bind(userId).first())?.public ?? 1) === 1; },
    /** Every approved and published submission with the person behind it: the raw material for counting contributions. */
    async listedSubmissions() { return (await db.prepare("SELECT submitted_by_id AS id, repo_url, source FROM submissions WHERE status = 'approved' AND publish_state = 'listed' AND submitted_by_id > 0").all()).results ?? []; },
    async publicUsers() { return (await db.prepare("SELECT u.id AS id, u.login AS login FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE COALESCE(p.public, 1) = 1").all()).results ?? []; },
    async userByLogin(login) { return (await db.prepare("SELECT u.id AS id, u.login AS login, COALESCE(p.public, 1) AS public FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.login = ? COLLATE NOCASE").bind(login).first()) ?? null; },
    /** Who put this repository forward, if they chose to be credited. */
    async creditFor(repoUrl) { return (await db.prepare("SELECT u.id AS id, u.login AS login FROM submissions s JOIN users u ON u.id = s.submitted_by_id LEFT JOIN profiles p ON p.user_id = s.submitted_by_id WHERE COALESCE(p.public, 1) = 1 AND s.repo_url = ? COLLATE NOCASE AND s.status = 'approved' AND s.publish_state = 'listed' ORDER BY s.id DESC LIMIT 1").bind(repoUrl).first()) ?? null; },
    async pendingCountFor(userId) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitted_by_id = ? AND status = 'pending'").bind(userId).first())?.n ?? 0); },
    // ---- votes ("this helped me") and short notes
    async voteCounts() { return (await db.prepare("SELECT item, COUNT(*) AS n FROM votes GROUP BY item").all()).results ?? []; },
    async saveCounts() { return (await db.prepare("SELECT item, COUNT(*) AS n FROM collection GROUP BY item").all()).results ?? []; },
    async voteCountFor(item) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM votes WHERE item = ?").bind(item).first())?.n ?? 0); },
    async saveCountFor(item) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM collection WHERE item = ?").bind(item).first())?.n ?? 0); },
    async hasVote(userId, item) { return !!(await db.prepare("SELECT 1 AS x FROM votes WHERE user_id = ? AND item = ?").bind(userId, item).first()); },
    async addVote(userId, item, at) { await db.prepare("INSERT OR IGNORE INTO votes (user_id, item, created_at) VALUES (?, ?, ?)").bind(userId, item, at).run(); },
    async removeVote(userId, item) { await db.prepare("DELETE FROM votes WHERE user_id = ? AND item = ?").bind(userId, item).run(); },
    async votesSince(userId, iso) { return Math.max(Number((await db.prepare("SELECT COUNT(*) AS n FROM votes WHERE user_id = ? AND created_at >= ?").bind(userId, iso).first())?.n ?? 0), Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'vote' AND created_at >= ?").bind(userId, iso).first())?.n ?? 0)); },
    async approvedNotes(item, limit = 20) { return (await db.prepare("SELECT n.id AS id, n.user_id AS user_id, CASE WHEN COALESCE(p.public, 1) = 1 THEN n.login ELSE '' END AS login, n.text AS text, n.created_at AS created_at FROM notes n LEFT JOIN profiles p ON p.user_id = n.user_id WHERE n.item = ? AND n.status = 'approved' ORDER BY n.id DESC LIMIT ?").bind(item, limit).all()).results ?? []; },
    async myNote(userId, item) { return (await db.prepare("SELECT id, text, status, created_at FROM notes WHERE user_id = ? AND item = ?").bind(userId, item).first()) ?? null; },
    async hasApprovedNote(userId) { return !!(await db.prepare("SELECT 1 AS x FROM notes WHERE user_id = ? AND status = 'approved'").bind(userId).first()); },
    async notesSince(userId, iso) { return Math.max(Number((await db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND created_at >= ?").bind(userId, iso).first())?.n ?? 0), Number((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'note' AND created_at >= ?").bind(userId, iso).first())?.n ?? 0)); },
    /** One note per person per kit; writing again replaces it, goes back through review and clears old reports. */
    async saveNote(userId, login, item, text, status, at) {
      await db.prepare("INSERT INTO notes (user_id, login, item, text, status, reports, created_at) VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(user_id, item) DO UPDATE SET text = excluded.text, status = excluded.status, reports = 0, created_at = excluded.created_at, login = excluded.login").bind(userId, login, item, text, status, at).run();
      const row = await db.prepare("SELECT id FROM notes WHERE user_id = ? AND item = ?").bind(userId, item).first();
      if (row) await db.prepare("DELETE FROM note_reports WHERE note_id = ?").bind(row.id).run();
    },
    async deleteOwnNote(userId, item) {
      const row = await db.prepare("SELECT id FROM notes WHERE user_id = ? AND item = ?").bind(userId, item).first();
      if (!row) return false;
      await db.prepare("DELETE FROM note_reports WHERE note_id = ?").bind(row.id).run();
      await db.prepare("DELETE FROM notes WHERE id = ?").bind(row.id).run();
      return true;
    },
    /** Reports are one per person per note. Two different people hide a note until a maintainer looks. Returns the note's status, or "" if there is no such note. */
    async reportNote(id, userId, at) {
      const note = await db.prepare("SELECT id, user_id, status FROM notes WHERE id = ?").bind(id).first();
      if (!note || note.user_id === userId || note.status !== "approved") return note ? note.status : "";
      await db.prepare("INSERT OR IGNORE INTO note_reports (note_id, user_id, created_at) VALUES (?, ?, ?)").bind(id, userId, at).run();
      const n = Number((await db.prepare("SELECT COUNT(*) AS n FROM note_reports WHERE note_id = ?").bind(id).first())?.n ?? 0);
      await db.prepare("UPDATE notes SET reports = ? WHERE id = ?").bind(n, id).run();
      if (n >= 2) { await db.prepare("UPDATE notes SET status = 'hidden' WHERE id = ?").bind(id).run(); return "hidden-now"; }
      return "approved";
    },
    async notesToReview(limit = 50) { return (await db.prepare("SELECT id, login, item, text, status, reports, created_at FROM notes WHERE status = 'pending' OR (status = 'hidden' AND reports > 0) ORDER BY id LIMIT ?").bind(limit).all()).results ?? []; },
    async notesToReviewCount() { return Number((await db.prepare("SELECT COUNT(*) AS n FROM notes WHERE status = 'pending' OR (status = 'hidden' AND reports > 0)").first())?.n ?? 0); },
    async decideNote(id, action) {
      if (action === "hide" || action === "delete") { const n = await db.prepare("SELECT user_id FROM notes WHERE id = ?").bind(id).first(); if (n) await db.prepare("INSERT INTO events (user_id, kind, created_at) VALUES (?, 'strike', ?)").bind(n.user_id, new Date().toISOString()).run(); }
      if (action === "delete") { await db.prepare("DELETE FROM note_reports WHERE note_id = ?").bind(id).run(); await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run(); return true; }
      if (action === "approve") { await db.prepare("DELETE FROM note_reports WHERE note_id = ?").bind(id).run(); const r = await db.prepare("UPDATE notes SET status = 'approved', reports = 0 WHERE id = ?").bind(id).run(); return Number(r.meta?.changes) === 1; }
      if (action === "hide") { const r = await db.prepare("UPDATE notes SET status = 'hidden' WHERE id = ?").bind(id).run(); return Number(r.meta?.changes) === 1; }
      return false;
    },
    async notesOf(userId) { return (await db.prepare("SELECT item, text, status, created_at FROM notes WHERE user_id = ?").bind(userId).all()).results ?? []; },
    async votesOf(userId) { return (await db.prepare("SELECT item, created_at FROM votes WHERE user_id = ?").bind(userId).all()).results ?? []; },
    async byUser(userId, limit = 20) { return (await db.prepare("SELECT * FROM submissions WHERE submitted_by_id = ? ORDER BY id DESC LIMIT ?").bind(userId, limit).all()).results ?? []; },
  };
}

/** The store for this request, or null when no database is bound yet. */
export const storeFor = (env) => env.STORE ?? (env.DB ? d1Store(env.DB) : null);
