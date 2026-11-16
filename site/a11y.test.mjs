#!/usr/bin/env node
// Accessibility checks on the built site: text contrast in both themes, and the structure of every page. No dependencies.
// Run from the repo root: node site/a11y.test.mjs
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

// ---- contrast, from the stylesheet's own tokens
const css = readFileSync(join(here, "style.css"), "utf8");
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const darkStart = css.indexOf(':root[data-theme="dark"]');
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf("}", darkStart))) };
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [text, background, what it is used for]
const PAIRS = [["fg", "bg", "body text"], ["fg", "card", "text on cards"], ["fg", "bg2", "text on tinted areas"], ["muted", "bg", "secondary text"], ["muted", "card", "secondary text on cards"], ["muted", "bg2", "secondary text on tinted areas"], ["muted", "code-bg", "tags"],
  ["accent", "bg", "links"], ["accent", "card", "links on cards"], ["accent", "accent-bg", "type badges"], ["accent-fg", "accent", "buttons"], ["warn", "warn-bg", "notices"], ["term-fg", "term", "code blocks"], ["bad", "bg", "errors"], ["bad", "card", "errors on cards"]];
for (const [name, theme] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, use] of PAIRS) {
    const r = ratio(theme[fg], theme[bg]);
    must(r >= 4.5, `${name}: ${use} (${fg} on ${bg}) has contrast ${r.toFixed(2)}, needs 4.5`);
  }
}

// ---- structure of every page
const out = mkdtempSync(join(tmpdir(), "praxikit-a11y-"));
execFileSync("node", [join(here, "build.mjs"), "--out", out], { stdio: "pipe" });
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(out).filter((f) => f.endsWith(".html") && !f.endsWith("app-shell.html"));
must(files.length > 5, "the site has pages to check");
for (const f of files) {
  const h = readFileSync(f, "utf8"), name = f.slice(out.length);
  must(/<html lang="en">/.test(h), `${name}: the page declares its language`);
  must(/<meta name="viewport"/.test(h) && /<title>[^<]+<\/title>/.test(h), `${name}: viewport and title are set`);
  const h1 = (h.match(/<h1[ >]/g) ?? []).length;
  must(h1 === 1, `${name}: exactly one h1, found ${h1}`);
  must(/<main id="main">/.test(h) && /<a class="skip" href="#main">/.test(h), `${name}: a main landmark and a skip link`);
  must((h.match(/<nav /g) ?? []).length >= 1 && /<header /.test(h) && /<footer /.test(h), `${name}: navigation, header and footer landmarks`);
  // every form control has a name
  for (const m of h.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    if (/type="(hidden|checkbox|radio)"/.test(tag)) continue;
    const id = /\sid="([^"]+)"/.exec(tag)?.[1];
    const named = /aria-label=/.test(tag) || (id && new RegExp(`<label[^>]*for="${id}"`).test(h));
    must(named, `${name}: an input has no label: ${tag.slice(0, 80)}`);
  }
  for (const m of h.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) must(/aria-label=|aria-labelledby=/.test(m[0].split(">")[0]) || m[1].replace(/<[^>]*>/g, "").trim().length > 0, `${name}: a button has no name`);
  for (const m of h.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) must(/aria-label=/.test(m[0].split(">")[0]) || m[1].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]*>/g, "").trim().length > 0, `${name}: a link has no name: ${m[0].slice(0, 90)}`);
  must(!/<img\b(?![^>]*\balt=)/.test(h), `${name}: every image has alt text`);
  must(!/target="_blank"(?![^>]*noopener)/.test(h), `${name}: no new-window link without noopener`);
  const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  must(new Set(ids).size === ids.length, `${name}: ids are unique`);
}
rmSync(out, { recursive: true, force: true });

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log(`ok: text contrast is at least 4.5:1 in light and dark (${PAIRS.length * 2} pairs), and ${files.length} pages have one h1, landmarks, a skip link and named controls`);
