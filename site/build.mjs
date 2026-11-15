#!/usr/bin/env node
/**
 * Builds the Praxikit catalog as static HTML. No dependencies.
 *
 *   node site/build.mjs [--root <repo dir>] [--out <dir>]
 *
 * Reads  <root>/kits/<name>/{kit.json,CHANGELOG.md,plugin/skills,plugin/agents}
 *        <root>/site/recommended.json
 * Writes <out>/index.html, 404.html, c/<collection>/index.html, k/<kit>/index.html, versions.json, style.css
 *
 * Every string that comes from a manifest or data file goes through esc(). Links are relative so the
 * site works at praxikit.github.io/praxikit/ and later at a custom domain with no change.
 * Our own inline scripts carry a data-site attribute so the test can prove no other script exists.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = arg("--root", join(here, ".."));
const OUT = arg("--out", join(ROOT, "site", "dist"));
const REPO = "https://github.com/praxikit/praxikit";
const HOME_URL = "https://praxikit.github.io/praxikit/";

const KIND_LABEL = { plugin: "Plugin", skill: "Skill", agent: "Agent", hook: "Hook", mcp: "MCP config", template: "Template", adapter: "Adapter" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// first sentence, capped, so long "Use when..." trigger text does not fill the page
const short = (s) => { const t = String(s ?? ""); const m = /^(.{20,200}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t.length > 200 ? t.slice(0, 197) + "..." : t; };
// escape first, then turn `code` spans into <code>; the only markup this adds is our own tag
const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const kindOf = (k) => KIND_LABEL[k.kind] ?? k.kind;
const dateOf = (head) => /(\d{4}-\d{2}-\d{2})/.exec(head ?? "")?.[1] ?? "";
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

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

// ---------- html pieces ----------
const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M9 8h9a5 5 0 0 1 0 10h-4v6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 24l4 0" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`;
const FAVICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b6b63"/><path d="M9 8h9a5 5 0 0 1 0 10h-4v6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

const THEME_BOOT = `try{var t=localStorage.getItem("praxikit-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
const SITE_JS = `
(function () {
  var root = document.documentElement;
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var code = b.parentElement.querySelector("code");
      copyText(code ? code.textContent : "", function (ok) {
        b.textContent = ok ? "Copied" : "Press Ctrl+C";
        b.classList.toggle("done", ok);
        setTimeout(function () { b.textContent = "Copy"; b.classList.remove("done"); }, 1600);
      });
    });
  });
  var tgl = document.getElementById("theme");
  if (tgl) tgl.addEventListener("click", function () {
    var cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    tgl.setAttribute("aria-pressed", String(next === "dark"));
    try { localStorage.setItem("praxikit-theme", next); } catch (e) {}
  });
  var q = document.getElementById("q"), grid = document.getElementById("kits");
  if (q && grid) {
    var cards = [].slice.call(grid.querySelectorAll("[data-card]"));
    var chips = [].slice.call(document.querySelectorAll("[data-chip]"));
    var count = document.getElementById("count"), none = document.getElementById("none");
    var active = "all";
    function apply() {
      var term = q.value.trim().toLowerCase(), shown = 0;
      cards.forEach(function (c) {
        var okChip = active === "all" || (" " + c.getAttribute("data-groups") + " ").indexOf(" " + active + " ") > -1;
        var okText = !term || c.getAttribute("data-text").indexOf(term) > -1;
        var on = okChip && okText; c.hidden = !on; if (on) shown++;
      });
      count.textContent = shown + (shown === 1 ? " kit" : " kits");
      none.hidden = shown !== 0;
    }
    q.addEventListener("input", apply);
    chips.forEach(function (ch) {
      ch.addEventListener("click", function () {
        active = ch.getAttribute("data-chip");
        chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o === ch)); });
        apply();
      });
    });
    var clear = document.getElementById("clear");
    if (clear) clear.addEventListener("click", function () { q.value = ""; active = "all"; chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o.getAttribute("data-chip") === "all")); }); apply(); q.focus(); });
    document.addEventListener("keydown", function (e) {
      var t = e.target && e.target.tagName;
      if (e.key === "/" && t !== "INPUT" && t !== "TEXTAREA") { e.preventDefault(); q.focus(); }
    });
    apply();
  }
})();
`;

const page = ({ title, depth, body, description, canonical }) => {
  const up = depth ? "../".repeat(depth) : "./";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Praxikit">
<meta name="twitter:card" content="summary">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="${up}style.css">
<script data-site>${THEME_BOOT}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap bar">
<a class="brand" href="${up}" aria-label="Praxikit home">${LOGO}<span>Praxikit</span></a>
<nav aria-label="Main"><a href="${up}#kits">Kits</a><a href="${up}#whats-new">What's new</a><a href="${up}#how">How it works</a><a href="${up}#recommended">Recommended</a><a class="gh" href="${esc(REPO)}" rel="noopener noreferrer">GitHub</a>
<button id="theme" class="icon-btn" type="button" aria-label="Toggle dark mode" aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" fill="currentColor"/></svg></button></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="foot"><div class="wrap foot-in"><div><strong>Praxikit</strong><p>Free, small, readable kits for AI agents. MIT licence.</p></div><div class="foot-links"><a href="${esc(REPO)}" rel="noopener noreferrer">Source</a><a href="${esc(REPO)}/issues/new" rel="noopener noreferrer">Suggest a kit</a><a href="${up}versions.json">versions.json</a></div></div></footer>
<script data-site>${SITE_JS}</script>
</body>
</html>
`;
};

const copyCmd = (c) => `<div class="cmd"><code>${esc(c)}</code><button type="button" data-copy>Copy</button></div>`;
const install = (cmds) => cmds.map(copyCmd).join("\n");
const badge = (k) => `<span class="badge kind">${esc(kindOf(k))}</span><span class="ver">v${esc(k.version)}</span>`;

function card(k, up) {
  const skills = k.adds.skills.length, agents = k.adds.agents.length;
  const bits = [skills ? plural(skills, "skill") : "", agents ? plural(agents, "agent") : ""].filter(Boolean).join(" · ");
  const latest = dateOf(k.changelog[0]?.head);
  const groups = [slug(kindOf(k)), ...k.collections.map(slug)].join(" ");
  const text = [k.name, k.promise, ...(k.tags ?? []), ...k.collections, kindOf(k)].join(" ").toLowerCase();
  return `<li class="card" data-card data-groups="${esc(groups)}" data-text="${esc(text)}">
<div class="card-top">${badge(k)}</div>
<h3><a class="name" href="${up}k/${esc(k.name)}/">${esc(k.name)}</a></h3>
<p class="promise">${esc(k.promise)}</p>
<div class="tags">${(k.tags ?? []).slice(0, 5).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
<div class="card-foot"><span>${esc(bits)}</span>${latest ? `<span>Updated ${esc(latest)}</span>` : ""}</div>
</li>`;
}

// with only a few kits, search and filters are noise; show each kit as a wide card with its install line
function featureCard(k) {
  const bits = [k.adds.skills.length ? plural(k.adds.skills.length, "skill") : "", k.adds.agents.length ? plural(k.adds.agents.length, "agent") : ""].filter(Boolean).join(" · ");
  const latest = dateOf(k.changelog[0]?.head);
  return `<li class="card feature" data-card data-groups="all" data-text="${esc(k.name.toLowerCase())}">
<div class="feature-main"><div class="card-top">${badge(k)}${latest ? `<span class="ver">Updated ${esc(latest)}</span>` : ""}</div>
<h3><a class="name" href="k/${esc(k.name)}/">${esc(k.name)}</a></h3>
<p class="promise">${esc(k.promise)}</p>
<div class="tags">${(k.tags ?? []).slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
<p class="muted">${esc(bits)}</p></div>
<div class="feature-side"><p class="label">Install (after adding the marketplace above)</p>${copyCmd(k.install[k.install.length - 1] ?? "")}<p><a class="btn ghost more" href="k/${esc(k.name)}/">Skills, limits and changelog</a></p></div>
</li>`;
}

function indexPage(kits, recs) {
  const cols = [...new Set(kits.flatMap((k) => k.collections))];
  const kinds = [...new Set(kits.map(kindOf))];
  const nSkills = kits.reduce((n, k) => n + k.adds.skills.length, 0);
  const nAgents = kits.reduce((n, k) => n + k.adds.agents.length, 0);
  const lastDate = kits.map((k) => dateOf(k.changelog[0]?.head)).filter(Boolean).sort().at(-1) ?? "";
  const many = kits.length >= 4;
  const chip = (id, label) => `<button type="button" class="chip" data-chip="${esc(id)}" aria-pressed="${id === "all"}">${esc(label)}</button>`;
  const chips = [chip("all", "All"), ...kinds.map((x) => chip(slug(x), x)), ...cols.map((c) => chip(slug(c), c))].join("");

  const feed = kits.flatMap((k) => k.changelog.slice(0, 2).map((e) => ({ k, e, date: dateOf(e.head) })))
    .sort((a, b) => b.date.localeCompare(a.date) || b.e.head.localeCompare(a.e.head)).slice(0, 6);
  const feedHtml = feed.map(({ k, e, date }) => `<li class="feed-item"><div class="feed-meta"><a href="k/${esc(k.name)}/">${esc(k.name)}</a><span class="ver">${esc(e.head.split(/\s+—\s+/)[0])}</span>${date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : ""}</div><p>${md(short(e.bullets[0] ?? ""))}</p></li>`).join("");

  const recHtml = recs.length
    ? `<ul class="recs">${recs.map((r) => `<li class="card"><div class="card-top"><span class="badge ext">${esc(r.category)}</span></div><h3><a class="name" href="${esc(r.url)}" rel="noopener noreferrer">${esc(r.name)}</a></h3><p class="by">by ${esc(r.author)}</p><p class="promise">${esc(r.why)}</p><p class="meta">Added ${esc(r.added)}</p></li>`).join("")}</ul>`
    : `<div class="empty"><p><strong>Nothing here yet.</strong> This shelf is for good work by other people that Praxikit did not make.</p><p><a class="btn ghost" href="${esc(REPO)}/issues/new" rel="noopener noreferrer">Recommend something</a></p></div>`;

  const body = `
<section class="hero"><div class="wrap hero-in">
<p class="eyebrow">Free · MIT · every kit versioned</p>
<h1>Practical kits for building with <span class="hl">AI agents</span>.</h1>
<p class="lead">Plugins, skills and templates that are small enough to read, versioned so updates reach you, and upfront about what they cannot do.</p>
<div class="start"><p class="label">1 · Add the marketplace in Claude Code</p>${install(["/plugin marketplace add praxikit/praxikit"])}<p class="label">2 · Install any kit from below, for example</p>${install([kits[0]?.install?.[1] ?? "/plugin install keel@praxikit"])}</div>
<ul class="stats" aria-label="Catalog at a glance"><li><strong>${kits.length}</strong><span>${kits.length === 1 ? "kit" : "kits"}</span></li><li><strong>${nSkills}</strong><span>skills</span></li><li><strong>${nAgents}</strong><span>agents</span></li>${lastDate ? `<li><strong>${esc(lastDate)}</strong><span>last release</span></li>` : ""}</ul>
</div></section>

<section id="kits" class="wrap sec"><div class="sec-head"><h2>Kits built by Praxikit</h2><p class="muted" id="count" aria-live="polite">${plural(kits.length, "kit")}</p></div>
${many ? `<div class="toolbar"><label class="search"><span class="vh">Search kits</span><input id="q" type="search" placeholder="Search kits  ( / )" autocomplete="off" spellcheck="false"></label><div class="chips" role="group" aria-label="Filter kits">${chips}</div></div>` : ""}
<ul class="cards${many ? "" : " few"}" id="kits-list">${kits.map((k) => (many ? card(k, "./") : featureCard(k))).join("") || ""}</ul>
${many ? `<div id="none" hidden class="empty"><p><strong>No kit matches.</strong></p><p><button id="clear" class="btn ghost" type="button">Clear filters</button> <a class="btn ghost" href="${esc(REPO)}/issues/new" rel="noopener noreferrer">Ask for one</a></p></div>` : ""}
${many ? "" : `<p class="muted soon">Need a different kit? <a href="${esc(REPO)}/issues/new" rel="noopener noreferrer">Ask for one</a>.</p>`}
${kits.length ? "" : '<p class="muted">No kits yet.</p>'}
</section>

<section id="whats-new" class="band"><div class="wrap sec"><h2>What's new</h2><p class="muted">Every release is tagged and has a changelog. This is the latest.</p><ul class="feed">${feedHtml || '<li class="muted">No releases yet.</li>'}</ul></div></section>

<section id="how" class="wrap sec"><h2>How it works</h2>
<ol class="steps">
<li><span class="num">1</span><h3>Add once</h3><p>Add the Praxikit marketplace to Claude Code. It is a Git repo; nothing runs until you install a kit.</p></li>
<li><span class="num">2</span><h3>Install what you need</h3><p>Pick a kit, copy its install line. Each kit page lists the skills, agents and hooks it adds, and its honest limits.</p></li>
<li><span class="num">3</span><h3>Update with versions</h3><p>Kits follow SemVer and keep a changelog. Run <code>/plugin marketplace update praxikit</code> and your install moves to the new version.</p></li>
</ol></section>

<section id="recommended" class="wrap sec"><h2>Recommended</h2>
<p class="note">Made by other people. Praxikit has not built or audited these; check anything before you install it.</p>${recHtml}</section>

<section class="cta"><div class="wrap cta-in"><div><h2>Built something useful?</h2><p>Praxikit lists small, readable, free kits. Tell us about yours or ask for one you need.</p></div><a class="btn" href="${esc(REPO)}/issues/new" rel="noopener noreferrer">Suggest a kit</a></div></section>`;
  return page({ title: "Praxikit — practical kits for AI agents", depth: 0, body, canonical: HOME_URL, description: "Praxikit: practical, free, versioned kits for building with AI agents — plugins, skills, MCP configs and templates." });
}

function collectionPage(c, kits) {
  const list = kits.filter((k) => k.collections.includes(c));
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../">All kits</a> / Collection</p><h1>${esc(c)}</h1><p class="lead">${plural(list.length, "kit")} in this collection.</p><ul class="cards">${list.map((k) => card(k, "../../")).join("")}</ul></div>`;
  return page({ title: `${c} — Praxikit`, depth: 2, body, description: `Praxikit kits in the ${c} collection.` });
}

function kitPage(k) {
  const tile = (s, label) => `<li class="tile"><span class="tile-kind">${label}</span><strong>${esc(label === "skill" && k.kind === "plugin" ? `/${k.name}:${s.name}` : s.name)}</strong><p>${esc(short(s.description))}</p></li>`;
  const adds = [];
  if (k.adds.skills.length) adds.push(`<h2>Skills it adds <span class="count">${k.adds.skills.length}</span></h2><ul class="tiles">${k.adds.skills.map((s) => tile(s, "skill")).join("")}</ul>`);
  if (k.adds.agents.length) adds.push(`<h2>Agents it adds <span class="count">${k.adds.agents.length}</span></h2><ul class="tiles">${k.adds.agents.map((s) => tile(s, "agent")).join("")}</ul>`);
  const log = k.changelog.map((e, i) => `<li class="log-item"><div class="log-head"><h3>${esc(e.head)}</h3>${i === 0 ? '<span class="badge kind">Latest</span>' : ""}</div><ul>${e.bullets.map((b) => `<li>${md(b)}</li>`).join("")}</ul></li>`).join("");
  const latest = dateOf(k.changelog[0]?.head);
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../">All kits</a> / ${esc(kindOf(k))}</p>
<h1>${esc(k.name)}</h1>
<p class="meta">${badge(k)}${latest ? `<span>Released ${esc(latest)}</span>` : ""}<span>${k.collections.map((c) => `<a href="../../c/${slug(c)}/">${esc(c)}</a>`).join(", ")}</span></p>
<p class="lead">${esc(k.promise)}</p>
<div class="two">
<div class="main-col">
${adds.join("\n")}
<h2>Honest limits</h2><ul class="limits">${k.limits.map((l) => `<li>${md(l)}</li>`).join("")}</ul>
<h2>Changelog</h2>${log ? `<ol class="log">${log}</ol>` : '<p class="muted">No changelog.</p>'}
</div>
<aside class="side"><div class="panel"><h2>Install</h2>${install(k.install)}<p class="muted">Update later:</p>${copyCmd("/plugin marketplace update praxikit")}<p class="muted">then <code>/reload-plugins</code>.</p>
<p class="side-links"><a class="btn ghost" href="${esc(REPO)}/tree/main/kits/${esc(k.name)}" rel="noopener noreferrer">Source on GitHub</a></p></div></aside>
</div></div>`;
  return page({ title: `${k.name} — Praxikit`, depth: 2, body, description: k.promise });
}

function notFoundPage() {
  const body = `<div class="wrap sec page-head"><h1>That page isn't here.</h1><p class="lead">It may have moved when a kit was renamed or removed.</p><p><a class="btn" href="${esc(HOME_URL)}">See all kits</a></p></div>`;
  return page({ title: "Not found — Praxikit", depth: 0, body, description: "Page not found." }).replace(/(href|src)="\.\//g, `$1="${HOME_URL}`);
}

// ---------- write ----------
const write = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

const kits = loadKits();
const recs = loadRecommended();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(join(here, "style.css"), join(OUT, "style.css"));
write("index.html", indexPage(kits, recs));
write("404.html", notFoundPage());
for (const c of new Set(kits.flatMap((k) => k.collections))) write(`c/${slug(c)}/index.html`, collectionPage(c, kits));
for (const k of kits) write(`k/${k.name}/index.html`, kitPage(k));
write("versions.json", JSON.stringify(Object.fromEntries(kits.map((k) => [k.name, { version: k.version, kind: k.kind }])), null, 2) + "\n");
write(".nojekyll", "");
console.log(`built ${kits.length} kit(s), ${recs.length} recommendation(s) -> ${OUT}`);
