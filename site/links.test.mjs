#!/usr/bin/env node
// Follows every internal link, image, script and stylesheet reference in the built site and checks it lands on a file that exists,
// and that every #anchor points at an id on the page it names. No dependencies. Run from the repo root: node site/links.test.mjs
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const out = mkdtempSync(join(tmpdir(), "praxikit-links-"));
execFileSync("node", [join(here, "build.mjs"), "--out", out], { stdio: "pipe" });
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(out);
const pages = files.filter((f) => f.endsWith(".html"));
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const htmlCache = new Map();
const htmlOf = (f) => { if (!htmlCache.has(f)) htmlCache.set(f, readFileSync(f, "utf8")); return htmlCache.get(f); };

// Paths the app (not the site) answers: they are real on the live address, so they are not files here.
const APP_PATHS = ["/auth", "/api", "/admin", "/collection", "/profile", "/settings", "/submit", "/account", "/healthz", "/assets"];
const isApp = (p) => APP_PATHS.some((x) => p === x || p.startsWith(x + "/") || p.startsWith(x + "?"));

let checked = 0;
for (const page of pages) {
  const html = htmlOf(page), pageRel = page.slice(out.length);
  if (pageRel.endsWith("app-shell.html")) continue;
  for (const m of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    const raw = m[2].replace(/&amp;/g, "&");
    if (!raw || /^(https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) {
      must(!/^javascript:/i.test(raw), `${pageRel}: a javascript: link`);
      continue;
    }
    checked++;
    const [pathAndQuery, hash] = raw.split("#");
    const path = pathAndQuery.split("?")[0];
    if (!path) { // same-page anchor
      if (hash) must(idsOf(html).has(hash), `${pageRel}: #${hash} points at nothing on the page`);
      continue;
    }
    if (path.startsWith("/")) { must(isApp(path) || existsSync(join(out, path)), `${pageRel}: ${raw} is a root link that is neither an app path nor a file`); continue; }
    let target = resolve(dirname(page), path);
    if (!target.startsWith(out + sep) && target !== out) { must(false, `${pageRel}: ${raw} leaves the site`); continue; }
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
    if (!existsSync(target)) { must(false, `${pageRel}: ${raw} does not exist`); continue; }
    if (hash && target.endsWith(".html")) must(idsOf(htmlOf(target)).has(hash), `${pageRel}: ${raw} - no #${hash} on that page`);
  }
}
must(checked > 200, `the checker looked at ${checked} references; expected a few hundred`);
rmSync(out, { recursive: true, force: true });

if (failures.length) { console.error([...new Set(failures)].map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log(`ok: ${checked} internal links, images, scripts and anchors across ${pages.length} pages all land on something real`);
