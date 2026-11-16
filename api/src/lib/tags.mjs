/** Tag rules, the same as site/listings.mjs (a test checks they agree). */
export const TAG = /^[a-z0-9][a-z0-9-]{1,23}$/;

export function parseTags(text, max = 12) {
  const seen = new Set(), out = [];
  for (const raw of String(text ?? "").split(/[,\n;]+/)) {
    const t = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
    if (TAG.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= max) break;
  }
  return out;
}
