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
  const known = new Set(["name", "url", "author", "why", "kind", "source", "added", "commit", "checks", "issue"]);
  for (const k of Object.keys(l)) if (!known.has(k)) e.push(`unknown field ${String(k).slice(0, 30)}`);
  return e;
}

export const sameRepo = (a, b) => String(a).toLowerCase().replace(/\/+$/, "") === String(b).toLowerCase().replace(/\/+$/, "");
