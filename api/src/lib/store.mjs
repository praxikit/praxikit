/**
 * Submissions in Cloudflare D1 (SQLite). Every query is a prepared statement with bound values;
 * nothing is ever built by joining strings. `db` is the D1 binding.
 */
const COLUMNS = ["repo_url", "repo_key", "name", "owner", "owner_type", "submitted_by", "submitted_by_id", "source", "kind_guess", "license", "commit_sha", "readme_url", "readme_excerpt", "why", "precheck", "precheck_status", "created_at"];

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
    async approve(id, { by, name, kind, text, at }) {
      const r = await db.prepare("UPDATE submissions SET status = 'approved', decided_by = ?, decided_at = ?, final_name = ?, final_kind = ?, final_text = ?, publish_state = 'dispatching', publish_note = '' WHERE id = ? AND status = 'pending'").bind(by, at, name, kind, text, id).run();
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
    async byUser(userId, limit = 20) { return (await db.prepare("SELECT * FROM submissions WHERE submitted_by_id = ? ORDER BY id DESC LIMIT ?").bind(userId, limit).all()).results ?? []; },
  };
}

/** The store for this request, or null when no database is bound yet. */
export const storeFor = (env) => env.STORE ?? (env.DB ? d1Store(env.DB) : null);
