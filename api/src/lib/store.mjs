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
    async byUser(userId, limit = 20) { return (await db.prepare("SELECT * FROM submissions WHERE submitted_by_id = ? ORDER BY id DESC LIMIT ?").bind(userId, limit).all()).results ?? []; },
  };
}

/** The store for this request, or null when no database is bound yet. */
export const storeFor = (env) => env.STORE ?? (env.DB ? d1Store(env.DB) : null);
