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
      const r = await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitted_by_id = ? AND created_at >= ?").bind(userId, iso).first();
      return Number(r?.n ?? 0);
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
    // ---- accounts and collections. A person's rows are only ever read or changed by their own id.
    async touchUser(id, login, at) {
      await db.prepare("INSERT INTO users (id, login, created_at, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET login = excluded.login, last_seen = excluded.last_seen").bind(id, login, at, at).run();
    },
    async getUser(id) { return (await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first()) ?? null; },
    async collectionOf(userId, limit = 500) { return (await db.prepare("SELECT item, label, added_at FROM collection WHERE user_id = ? ORDER BY added_at DESC LIMIT ?").bind(userId, limit).all()).results ?? []; },
    async collectionCount(userId) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM collection WHERE user_id = ?").bind(userId).first())?.n ?? 0); },
    async collectionSince(userId, iso) { return Number((await db.prepare("SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND added_at >= ?").bind(userId, iso).first())?.n ?? 0); },
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
      await db.prepare("DELETE FROM collection WHERE user_id = ?").bind(userId).run();
      await db.prepare("DELETE FROM submissions WHERE submitted_by_id = ? AND status = 'pending'").bind(userId).run();
      await db.prepare("UPDATE submissions SET submitted_by = 'deleted-account', submitted_by_id = 0 WHERE submitted_by_id = ?").bind(userId).run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    },
    async byUser(userId, limit = 20) { return (await db.prepare("SELECT * FROM submissions WHERE submitted_by_id = ? ORDER BY id DESC LIMIT ?").bind(userId, limit).all()).results ?? []; },
  };
}

/** The store for this request, or null when no database is bound yet. */
export const storeFor = (env) => env.STORE ?? (env.DB ? d1Store(env.DB) : null);
