/**
 * The shape of an entry in site/listings.json, shared by the site build and the listing scripts.
 * Entries come from issue forms and workflow inputs, so every field is checked and length-limited.
 * (The site escapes them again when it renders; this is the first line of defence, not the only one.)
 */
export const KINDS = ["plugin", "skill", "agent", "hook", "mcp", "template", "adapter"];
export const SOURCES = ["community", "recommended"];
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
  const known = new Set(["name", "url", "author", "why", "kind", "source", "added", "commit", "checks", "issue", "pick", "note", "tags"]);
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
