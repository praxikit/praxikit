/**
 * The shape of an entry in site/listings.json, shared by the site build and the listing scripts.
 * Entries come from issue forms and workflow inputs, so every field is checked and length-limited.
 * (The site escapes them again when it renders; this is the first line of defence, not the only one.)
 */
export const KINDS = ["plugin", "skill", "agent", "hook", "mcp", "template", "adapter"];
export const SOURCES = ["community", "recommended"];
export const FOUND_IDS = ["shape", "licence", "secrets", "autorun", "network", "exec", "instructions", "odd", "size"];
export const CHECK_LABELS = ["no-flags-found", "checks-flagged", "checks-failed", "needs-manual-review"];

const GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_.-])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_.-])?$/;
const PLAIN = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);

/** Returns a list of problems; empty means the entry is acceptable. */
export function validateListing(l) {
  const e = [];
  if (!l || typeof l !== "object" || Array.isArray(l)) return ["entry is not an object"];
  if (!PLAIN(l.name, 80)) e.push("name must be 1 to 80 plain characters");
  if (typeof l.url !== "string" || !GITHUB.test(l.url) || l.url.includes("..")) e.push("url must be https://github.com/<owner>/<repo>");
  if (!PLAIN(l.author, 80)) e.push("author must be 1 to 80 plain characters");
  if (!PLAIN(l.why, 400)) e.push("why must be 1 to 400 plain characters");
  if (!KINDS.includes(l.kind)) e.push(`kind must be one of ${KINDS.join(", ")}`);
  if (!SOURCES.includes(l.source)) e.push(`source must be one of ${SOURCES.join(", ")}`);
  if (typeof l.added !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(l.added)) e.push("added must be YYYY-MM-DD");
  if (typeof l.commit !== "string" || !/^[0-9a-f]{40}$/.test(l.commit)) e.push("commit must be the 40-character commit that was reviewed");
  if (!CHECK_LABELS.includes(l.checks)) e.push(`checks must be one of ${CHECK_LABELS.join(", ")}`);
  if (l.issue !== undefined && !(Number.isInteger(l.issue) && l.issue > 0)) e.push("issue must be a positive integer");
  // a pick means the owner has used it, and says how in one line; without a pick there is no note
  if (l.pick !== undefined && l.pick !== true) e.push("pick, when present, must be true");
  if (l.pick === true && !PLAIN(l.note, 200)) e.push("a pick needs a note of 1 to 200 plain characters on how it is used");
  if (l.pick !== true && l.note !== undefined) e.push("note is only for picks");
  if (l.tags !== undefined && !(Array.isArray(l.tags) && l.tags.length >= 1 && l.tags.length <= 12 && l.tags.every((t) => typeof t === "string" && TAG.test(t)) && new Set(l.tags).size === l.tags.length)) e.push("tags must be 1 to 12 different lowercase words (letters, digits, hyphens; 2 to 24 characters)");
  if (l.found !== undefined) {
    const f = l.found;
    const okRow = (c) => c && typeof c === "object" && FOUND_IDS.includes(c.id) && ["pass", "flag", "fail"].includes(c.status) && typeof c.note === "string" && c.note.length <= 160 && !/[\u0000-\u001f<>]/.test(c.note);
    if (!(f && typeof f === "object" && Number.isInteger(f.files) && f.files >= 0 && f.files < 1e7 && Array.isArray(f.checks) && f.checks.length >= 1 && f.checks.length <= 12 && f.checks.every(okRow) && new Set(f.checks.map((c) => c.id)).size === f.checks.length)) e.push("found must list each check once, with its result and a short plain note");
  }
  const known = new Set(["name", "url", "author", "why", "kind", "source", "added", "commit", "checks", "issue", "pick", "note", "tags", "found"]);
  for (const k of Object.keys(l)) if (!known.has(k)) e.push(`unknown field ${String(k).slice(0, 30)}`);
  return e;
}

export const TAG = /^[a-z0-9][a-z0-9-]{1,23}$/;

/** Turns "Planning, model routing; SEO" into ["planning", "model-routing", "seo"]: lowercase, hyphens, 2 to 24 characters, no repeats, at most 12. */
export function parseTags(text, max = 12) {
  const seen = new Set(), out = [];
  for (const raw of String(text ?? "").split(/[,\n;]+/)) {
    const t = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
    if (TAG.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= max) break;
  }
  return out;
}

export const sameRepo = (a, b) => String(a).toLowerCase().replace(/\/+$/, "") === String(b).toLowerCase().replace(/\/+$/, "");

// ---- GitHub facts and the health score ----
/** A listed kit counts as new for this many days after it was listed. */
export const NEW_DAYS = 30;
export const isNew = (added, today) => {
  const a = Date.parse(`${added}T00:00:00Z`), t = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(t) && t >= a && (t - a) / 86400000 <= NEW_DAYS;
};

/** Facts about a repository, written by the daily job. Anything that does not look right is ignored. */
export function validMetric(m) {
  return !!m && typeof m === "object" && Number.isInteger(m.stars) && m.stars >= 0 && m.stars < 1e8
    && typeof m.licence === "string" && /^[A-Za-z0-9.+-]{1,40}$/.test(m.licence)
    && typeof m.pushed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.pushed) && Number.isFinite(Date.parse(`${m.pushed}T00:00:00Z`))
    && typeof m.archived === "boolean";
}

/** 64900 -> "64.9k", 1200000 -> "1.2M". */
export function fmtStars(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) { const k = n / 1000; return (k < 100 ? k.toFixed(1).replace(/\.0$/, "") : String(Math.round(k))) + "k"; }
  return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
}

/**
 * The health score: 0 to 100, from four things anyone can check. It says how well a kit is looked after, not how good it is.
 * Stars are shown next to it and are not part of it, so a careful new repository can score well.
 * Returns null when there are no facts about the repository yet.
 */
export function healthScore(l, m, drift, today) {
  if (!validMetric(m)) return null;
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${m.pushed}T00:00:00Z`)) / 86400000));
  const licence = m.licence === "none" ? [0, "No licence found on GitHub"] : m.licence === "NOASSERTION" ? [12, "Licence present but not a standard one"] : [25, `Licence: ${m.licence}`];
  const activity = m.archived ? [0, "The repository is archived"]
    : days <= 30 ? [30, "Updated in the last month"] : days <= 90 ? [24, "Updated in the last 3 months"] : days <= 180 ? [15, "Updated in the last 6 months"] : days <= 365 ? [6, "Updated in the last year"] : [0, "Not updated for over a year"];
  const scan = { "no-flags-found": [30, "Automatic checks found nothing"], "checks-flagged": [20, "Checks flagged things that a person read"], "needs-manual-review": [20, "Reviewed by hand"], "checks-failed": [6, "Automatic checks failed; accepted after a read"] }[l.checks] ?? [10, "Checked"];
  const stable = drift === "same" ? [15, "Unchanged since it was reviewed"] : drift === "newer" ? [12, "Newer commits, none touching files that run"] : (drift === "review" || drift === "changed") ? [6, "Files that run changed since it was reviewed"] : drift === "unreachable" ? [0, "Repository not reachable"] : [10, "Change check not run yet"];
  const parts = [{ name: "Licence", got: licence[0], max: 25, text: licence[1] }, { name: "Upkeep", got: activity[0], max: 30, text: activity[1] }, { name: "Checks", got: scan[0], max: 30, text: scan[1] }, { name: "Stability", got: stable[0], max: 15, text: stable[1] }];
  let score = parts.reduce((s, p) => s + p.got, 0);
  if (m.archived) score = Math.min(score, 20);
  return { score, label: score >= 80 ? "Healthy" : score >= 60 ? "Fair" : "Needs a look", level: score >= 80 ? "ok" : score >= 60 ? "fair" : "low", parts, days };
}
