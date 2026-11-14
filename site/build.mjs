#!/usr/bin/env node
/**
 * Builds the praxikit catalog as static HTML. No dependencies.
 *
 *   node site/build.mjs [--root <repo dir>] [--out <dir>]
 *
 * Reads  <root>/kits/<name>/{kit.json,CHANGELOG.md,plugin/skills,plugin/agents}
 *        <root>/site/recommended.json
 * Writes <out>/index.html, c/<collection>/index.html, k/<kit>/index.html, versions.json, style.css
 *
 * Every string that comes from a manifest or data file goes through esc(). Links are relative so the
 * site works at praxikit.github.io/praxikit/ and later at a custom domain with no change.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = arg("--root", join(here, ".."));
const OUT = arg("--out", join(ROOT, "site", "dist"));
const REPO = "https://github.com/praxikit/praxikit";

const KIND_LABEL = { plugin: "Plugin", skill: "Skill", agent: "Agent", hook: "Hook", mcp: "MCP config", template: "Template", adapter: "Adapter" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// first sentence, capped, so long "Use when..." trigger text does not fill the page
const short = (s) => { const t = String(s ?? ""); const m = /^(.{20,200}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t.length > 200 ? t.slice(0, 197) + "..." : t; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------- load ----------
function frontmatter(file) {
  const t = readFileSync(file, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
  const get = (k) => (m ? (new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1])?.[1] ?? "").trim() : "");
  return { name: get("name"), description: get("description") };
}
function listAdds(dir) {
  const out = { skills: [], agents: [] };
  const sk = join(dir, "plugin", "skills"), ag = join(dir, "plugin", "agents");
  if (existsSync(sk)) for (const d of readdirSync(sk, { withFileTypes: true })) {
    const f = join(sk, d.name, "SKILL.md");
    if (d.isDirectory() && existsSync(f)) out.skills.push(frontmatter(f));
  }
  if (existsSync(ag)) for (const f of readdirSync(ag).filter((x) => x.endsWith(".md"))) out.agents.push(frontmatter(join(ag, f)));
  return out;
}
function parseChangelog(text) {
  const entries = [];
  for (const block of text.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split("\n");
    const bullets = rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
    entries.push({ head: head.trim(), bullets });
  }
  return entries;
}
function loadKits() {
  const kitsDir = join(ROOT, "kits");
  if (!existsSync(kitsDir)) return [];
  return readdirSync(kitsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(kitsDir, d.name, "kit.json")))
    .map((d) => {
      const dir = join(kitsDir, d.name);
      const k = readJson(join(dir, "kit.json"));
      const cl = join(dir, "CHANGELOG.md");
      return { ...k, changelog: existsSync(cl) ? parseChangelog(readFileSync(cl, "utf8")) : [], adds: listAdds(dir) };
    }).sort((a, b) => a.name.localeCompare(b.name));
}
function loadRecommended() {
  const f = join(ROOT, "site", "recommended.json");
  if (!existsSync(f)) return [];
  const items = readJson(f);
  for (const r of items) {
    if (!/^https:\/\//.test(r.url ?? "")) throw new Error(`recommended: url must start with https:// (${r.name})`);
    for (const k of ["name", "author", "why", "category", "added"]) if (!r[k]) throw new Error(`recommended: ${r.name ?? "entry"} is missing ${k}`);
  }
  return items;
}

// ---------- html ----------
const page = ({ title, depth, body, description }) => {
  const up = depth ? "../".repeat(depth) : "./";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="${up}">praxikit</a><nav><a href="${up}#built">Kits</a><a href="${up}#recommended">Recommended</a><a href="${esc(REPO)}" rel="noopener noreferrer">GitHub</a></nav></div></header>
<main class="wrap">
${body}
</main>
<footer class="wrap foot">Free, small, readable. MIT licence. <a href="${esc(REPO)}" rel="noopener noreferrer">Source</a></footer>
<script>
document.querySelectorAll("[data-copy]").forEach(function (b) {
  b.addEventListener("click", function () {
    var t = b.previousElementSibling.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); });
  });
});
</script>
</body>
</html>
`;
};
const install = (cmds) => cmds.map((c) => `<div class="cmd"><code>${esc(c)}</code><button type="button" data-copy>Copy</button></div>`).join("\n");
const badge = (k) => `<span class="badge">${esc(KIND_LABEL[k.kind] ?? k.kind)}</span> <span class="ver">v${esc(k.version)}</span>`;
const card = (k, up) => `<li class="card"><a class="name" href="${up}k/${esc(k.name)}/">${esc(k.name)}</a> ${badge(k)}<p>${esc(k.promise)}</p></li>`;

function indexPage(kits, recs) {
  const cols = [...new Set(kits.flatMap((k) => k.collections))];
  const sections = cols.map((c) => `<section><h3><a href="c/${slug(c)}/">${esc(c)}</a></h3><ul class="cards">${kits.filter((k) => k.collections.includes(c)).map((k) => card(k, "./")).join("")}</ul></section>`).join("\n");
  const kinds = [...new Set(kits.map((k) => k.kind))].map((x) => `${esc(KIND_LABEL[x] ?? x)}`).join(" · ");
  const recHtml = recs.length
    ? `<ul class="recs">${recs.map((r) => `<li><a href="${esc(r.url)}" rel="noopener noreferrer">${esc(r.name)}</a> <span class="badge ext">${esc(r.category)}</span> <span class="by">by ${esc(r.author)}</span><p>${esc(r.why)}</p><p class="meta">Added ${esc(r.added)}</p></li>`).join("")}</ul>`
    : `<p class="muted">Nothing here yet. This will list things praxikit did not make but recommends.</p>`;
  const body = `
<section class="hero"><h1>Practical kits for building with AI agents.</h1>
<p class="lead">Small, readable, free. Each kit has a version, a changelog and honest limits.</p>
<div class="start"><p class="label">Start with the marketplace</p>${install(["/plugin marketplace add praxikit/praxikit"])}</div></section>
<section id="built"><h2>Built by praxikit</h2>${kinds ? `<p class="muted">${kinds}</p>` : ""}${sections || '<p class="muted">No kits yet.</p>'}</section>
<section id="recommended"><h2>Recommended</h2>
<p class="note">Made by other people. Not built, audited or endorsed beyond the reason given; check anything before you install it.</p>${recHtml}</section>`;
  return page({ title: "praxikit — practical kits for AI agents", depth: 0, body, description: "Practical kits for building with AI agents: plugins, skills, MCP configs and templates, versioned." });
}

function collectionPage(c, kits) {
  const list = kits.filter((k) => k.collections.includes(c));
  const body = `<p class="crumb"><a href="../../">All kits</a></p><h1>${esc(c)}</h1><ul class="cards">${list.map((k) => card(k, "../../")).join("")}</ul>`;
  return page({ title: `${c} — praxikit`, depth: 2, body, description: `praxikit kits in the ${c} collection.` });
}

function kitPage(k) {
  const adds = [];
  if (k.adds.skills.length) adds.push(`<h2>Skills it adds</h2><dl>${k.adds.skills.map((s) => `<dt>${esc(s.name)}</dt><dd>${esc(short(s.description))}</dd>`).join("")}</dl>`);
  if (k.adds.agents.length) adds.push(`<h2>Agents it adds</h2><dl>${k.adds.agents.map((s) => `<dt>${esc(s.name)}</dt><dd>${esc(short(s.description))}</dd>`).join("")}</dl>`);
  const log = k.changelog.map((e) => `<h3>${esc(e.head)}</h3><ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`).join("");
  const body = `<p class="crumb"><a href="../../">All kits</a></p>
<h1>${esc(k.name)}</h1><p class="meta">${badge(k)} · ${k.collections.map((c) => `<a href="../../c/${slug(c)}/">${esc(c)}</a>`).join(", ")}</p>
<p class="lead">${esc(k.promise)}</p>
<h2>Install</h2>${install(k.install)}
<p class="muted">Update later with <code>/plugin marketplace update praxikit</code>, then <code>/reload-plugins</code>.</p>
${adds.join("\n")}
<h2>Honest limits</h2><ul>${k.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<h2>Changelog</h2>${log || '<p class="muted">No changelog.</p>'}
<p><a href="${esc(REPO)}/tree/main/kits/${esc(k.name)}" rel="noopener noreferrer">Source on GitHub</a></p>`;
  return page({ title: `${k.name} — praxikit`, depth: 2, body, description: k.promise });
}

// ---------- write ----------
const write = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

const kits = loadKits();
const recs = loadRecommended();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(join(here, "style.css"), join(OUT, "style.css"));
write("index.html", indexPage(kits, recs));
for (const c of new Set(kits.flatMap((k) => k.collections))) write(`c/${slug(c)}/index.html`, collectionPage(c, kits));
for (const k of kits) write(`k/${k.name}/index.html`, kitPage(k));
write("versions.json", JSON.stringify(Object.fromEntries(kits.map((k) => [k.name, { version: k.version, kind: k.kind }])), null, 2) + "\n");
write(".nojekyll", "");
console.log(`built ${kits.length} kit(s), ${recs.length} recommendation(s) -> ${OUT}`);
