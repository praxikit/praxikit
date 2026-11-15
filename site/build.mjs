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
import { execFileSync } from "node:child_process";
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
function listHooks(dir) {
  const f = join(dir, "plugin", "hooks", "hooks.json");
  if (!existsSync(f)) return [];
  let j; try { j = readJson(f); } catch { return []; }
  const out = [];
  for (const [event, groups] of Object.entries(j.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) {
    const script = (h.args ?? []).map((a) => String(a).split("/").pop()).find((a) => /\.(mjs|js|sh|py)$/.test(a)) ?? String(h.command ?? "");
    out.push({ event, matcher: g.matcher ?? "", script });
  }
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
      return { ...k, changelog: existsSync(cl) ? parseChangelog(readFileSync(cl, "utf8")) : [], adds: listAdds(dir), hooks: listHooks(dir) };
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

// ---------- build-time facts: commit, trust checks ----------
function commitInfo() {
  const sha = process.env.GITHUB_SHA || (() => { try { return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } })();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}
const SHA = commitInfo();
const BUILT = new Date().toISOString().slice(0, 10);
const NET = /\bfetch\s*\(|node:https?|node:net|node:dgram|node:child_process|XMLHttpRequest|WebSocket/;
function scriptFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scriptFiles(join(dir, e.name)) : /\.(mjs|js)$/.test(e.name) ? [join(dir, e.name)] : []));
}
/** Checks computed from the files at build time. A failing check is shown as failing, never hidden. */
function trustChecks(k) {
  const dir = join(ROOT, "kits", k.name);
  const out = [];
  const need = ["name", "kind", "collections", "tags", "version", "promise", "install", "limits"];
  const missing = need.filter((f) => k[f] === undefined || k[f] === "" || (Array.isArray(k[f]) && !k[f].length && f !== "tags"));
  out.push({ ok: !missing.length, text: missing.length ? `Manifest is missing: ${missing.join(", ")}` : "Manifest has every required field" });
  out.push({ ok: k.changelog.some((e) => e.head.split(/\s+/)[0] === k.version), text: `Changelog has an entry for v${k.version}` });
  if (k.kind === "plugin") {
    const pj = join(dir, "plugin", ".claude-plugin", "plugin.json");
    let pv = null; try { pv = readJson(pj).version; } catch { /* missing */ }
    out.push({ ok: pv === k.version, text: pv === k.version ? "Plugin manifest version matches the kit version" : `Plugin manifest version (${pv ?? "missing"}) does not match v${k.version}` });
    const files = scriptFiles(join(dir, "plugin", "scripts"));
    const bad = files.filter((f) => NET.test(readFileSync(f, "utf8")));
    out.push({ ok: !bad.length, text: files.length ? (bad.length ? `Network or process code found in ${bad.length} of ${files.length} scripts` : `${plural(files.length, "script")} scanned: no network or child-process code`) : "No scripts to scan" });
  }
  const lic = join(ROOT, "LICENSE");
  out.push({ ok: existsSync(lic) && /MIT License/.test(readFileSync(lic, "utf8")), text: "MIT licence file at the repository root" });
  const tdir = join(dir, "tests");
  const tests = existsSync(tdir) ? readdirSync(tdir).filter((f) => /\.test\.m?js$/.test(f)).length : 0;
  out.push({ ok: tests > 0, text: tests ? `${plural(tests, "test file")} in the kit; CI runs them on every push` : "No test files" });
  return out;
}

// ---------- html pieces ----------
const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="6" fill="var(--accent)"/><path d="M9 8h9a5 5 0 0 1 0 10h-4v6" fill="none" stroke="var(--accent-fg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FAVICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b6b63"/><path d="M9 8h9a5 5 0 0 1 0 10h-4v6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
const ISSUE = (t) => `${REPO}/issues/new?template=${t}`;

const THEME_BOOT = `try{var t=localStorage.getItem("praxikit-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
// No regular expressions in here: this is a template literal, where backslashes would be eaten.
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
  document.querySelectorAll("[data-tabs]").forEach(function (box) {
    var tabs = [].slice.call(box.querySelectorAll("[role=tab]")), panels = [].slice.call(box.querySelectorAll("[role=tabpanel]"));
    function show(i) {
      tabs.forEach(function (t, j) { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; });
      panels.forEach(function (p, j) { p.hidden = i !== j; });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { show(i); });
      t.addEventListener("keydown", function (e) {
        var n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
        if (n < 0) return; n = (n + tabs.length) % tabs.length; show(n); tabs[n].focus(); e.preventDefault();
      });
    });
    box.querySelector("[role=tablist]").hidden = false;
    show(0);
  });
  document.querySelectorAll("[data-checker]").forEach(function (box) {
    var data; try { data = JSON.parse(box.getAttribute("data-checker")); } catch (e) { return; }
    var kitSel = box.querySelector("[data-ck-kit]"), verSel = box.querySelector("[data-ck-ver]"), out = box.querySelector("[data-ck-out]"), upd = box.querySelector("[data-ck-update]");
    var paste = box.querySelector("[data-ck-paste]"), pasteMsg = box.querySelector("[data-ck-pastemsg]");
    function kitName() { return kitSel ? kitSel.value : box.getAttribute("data-kit"); }
    function kit() { return data[kitName()]; }
    function line(parent, tag, text, cls) { var e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; parent.appendChild(e); return e; }
    function fill() {
      var k = kit(); verSel.textContent = "";
      line(verSel, "option", "Choose your version").value = "";
      if (!k) return;
      k.versions.forEach(function (v) { line(verSel, "option", "v" + v.v + (v.date ? " (" + v.date + ")" : "")).value = v.v; });
      line(verSel, "option", "Older, or I don't know").value = "older";
      render();
    }
    function render() {
      out.textContent = ""; upd.hidden = true;
      var k = kit(); if (!k || !verSel.value) { out.hidden = true; return; }
      out.hidden = false;
      var idx = verSel.value === "older" ? k.versions.length : k.versions.findIndex(function (v) { return v.v === verSel.value; });
      if (idx === 0) { line(out, "p", "Up to date: v" + k.versions[0].v + " is the latest.", "ck-ok"); return; }
      line(out, "p", "v" + k.versions[0].v + " is available" + (idx < k.versions.length ? ", you have v" + verSel.value + ". " + idx + (idx === 1 ? " release" : " releases") + " since:" : ". Everything since the first release:"), "ck-new");
      k.versions.slice(0, idx).forEach(function (v) {
        line(out, "h4", "v" + v.v + (v.date ? "  " + v.date : ""));
        var ul = document.createElement("ul"); v.notes.forEach(function (n) { line(ul, "li", n); }); out.appendChild(ul);
      });
      upd.hidden = false;
    }
    // "claude plugin list" prints "<name>@<marketplace>" then "Version: x.y.z"; find it without a regular expression
    function versionIn(text, name) {
      var at = text.indexOf(name + "@"); if (at < 0) return "";
      var vi = text.indexOf("Version:", at); if (vi < 0) return "";
      var rest = text.slice(vi + 8).trim(), v = "";
      for (var i = 0; i < rest.length; i++) { var c = rest.charAt(i); if ((c >= "0" && c <= "9") || c === ".") v += c; else break; }
      return v;
    }
    function fromPaste() {
      var text = paste.value; pasteMsg.textContent = "";
      if (!text.trim()) return;
      var names = Object.keys(data), hit = "", ver = "";
      for (var i = 0; i < names.length; i++) { var v = versionIn(text, names[i]); if (v) { hit = names[i]; ver = v; break; } }
      if (!hit) { pasteMsg.textContent = "Could not find a Praxikit kit in that text."; return; }
      if (kitSel) kitSel.value = hit;
      fill();
      var known = data[hit].versions.some(function (x) { return x.v === ver; });
      verSel.value = known ? ver : "older";
      pasteMsg.textContent = known ? "Found " + hit + " v" + ver + "." : "Found " + hit + " v" + ver + ", which is not in this changelog, so showing everything.";
      render();
    }
    if (kitSel) kitSel.addEventListener("change", fill);
    verSel.addEventListener("change", render);
    if (paste) paste.addEventListener("input", fromPaste);
    fill();
    // a link such as ?kit=keel&v=0.5.0 (printed by /keel:status) fills the form
    try {
      var qs = new URLSearchParams(location.search), qk = qs.get("kit"), qv = qs.get("v");
      if (qk && data[qk] && (!box.getAttribute("data-kit") || box.getAttribute("data-kit") === qk)) {
        if (kitSel) kitSel.value = qk;
        fill();
        verSel.value = qv && data[qk].versions.some(function (x) { return x.v === qv; }) ? qv : "older";
        render();
      }
    } catch (e) {}
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
${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<link rel="alternate" type="application/atom+xml" title="Praxikit releases" href="${up}feed.xml">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="${up}style.css">
<script data-site>${THEME_BOOT}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap bar">
<a class="brand" href="${up}" aria-label="Praxikit home">${LOGO}<span>Praxikit</span></a>
<nav aria-label="Main"><a href="${up}#kits">Kits</a><a href="${up}#updates">Updates</a><a href="${up}#recommended">Recommended</a><a href="${up}#submit">Submit</a><a href="${esc(REPO)}" rel="noopener noreferrer">GitHub</a>
<button id="theme" class="icon-btn" type="button" aria-label="Toggle dark mode" aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" fill="currentColor"/></svg></button></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="foot"><div class="wrap foot-in"><div><strong>Praxikit</strong><p>Kits for AI coding agents. MIT licence.</p></div><div class="foot-links"><a href="${esc(REPO)}" rel="noopener noreferrer">Source</a><a href="${up}feed.xml">Release feed</a><a href="${up}versions.json">versions.json</a><a href="${esc(ISSUE("suggest-kit.yml"))}" rel="noopener noreferrer">Submit a kit</a></div></div></footer>
<script data-site>${SITE_JS}</script>
</body>
</html>
`;
};

const copyCmd = (c) => `<div class="cmd"><code>${esc(c)}</code><button type="button" data-copy>Copy</button></div>`;
const install = (cmds) => cmds.map(copyCmd).join("\n");
// version history for the "am I up to date" checker; newest first, as in the changelog
const historyOf = (k) => k.changelog.map((e) => ({ v: e.head.split(/\s+/)[0], date: dateOf(e.head), notes: e.bullets.map((b) => b.replace(/`/g, "")) })).filter((h) => /^\d+\.\d+\.\d+$/.test(h.v));
const checkerData = (kits) => Object.fromEntries(kits.map((k) => [k.name, { versions: historyOf(k) }]).filter(([, v]) => v.versions.length));
function checker(kits, only) {
  const data = checkerData(kits);
  const names = Object.keys(data);
  if (!names.length || (only && !data[only])) return "";
  const kitSelect = only ? "" : `<label class="ck-field"><span>Kit</span><select data-ck-kit>${names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select></label>`;
  return `<div class="checker" data-checker="${esc(JSON.stringify(data))}"${only ? ` data-kit="${esc(only)}"` : ""}>
<details class="ck-paste"><summary>Fill this in for me</summary>
<p class="muted">A web page cannot see what is installed on your machine, so paste the output of <code>claude plugin list</code> and the version is picked for you. The text stays in your browser.</p>
<textarea data-ck-paste rows="4" spellcheck="false" aria-label="Output of claude plugin list" placeholder="keel@praxikit&#10;  Version: 0.5.0"></textarea>
<p class="muted" data-ck-pastemsg aria-live="polite"></p></details>
<div class="ck-row">${kitSelect}<label class="ck-field"><span>Version you have</span><select data-ck-ver></select></label></div>
<div class="ck-out" data-ck-out hidden aria-live="polite"></div>
<div data-ck-update hidden><p class="muted">Update with:</p>${copyCmd("/plugin marketplace update praxikit")}<p class="muted">then <code>/reload-plugins</code>.</p></div>
</div>`;
}
const badge = (k) => `<span class="kind">${esc(kindOf(k))}</span><span class="ver">v${esc(k.version)}</span>`;

function card(k, up) {
  const skills = k.adds.skills.length, agents = k.adds.agents.length;
  const bits = [skills ? plural(skills, "skill") : "", agents ? plural(agents, "agent") : ""].filter(Boolean).join(", ");
  const latest = dateOf(k.changelog[0]?.head);
  const groups = [slug(kindOf(k)), ...k.collections.map(slug)].join(" ");
  const text = [k.name, k.promise, ...(k.tags ?? []), ...k.collections, kindOf(k)].join(" ").toLowerCase();
  return `<li class="card" data-card data-groups="${esc(groups)}" data-text="${esc(text)}">
<div class="meta-line">${badge(k)}</div>
<h3><a class="name" href="${up}k/${esc(k.name)}/">${esc(k.name)}</a></h3>
<p class="promise">${esc(k.promise)}</p>
<div class="card-foot"><span>${esc(bits)}</span>${latest ? `<span>Updated ${esc(latest)}</span>` : ""}</div>
</li>`;
}

// with only a few kits, search and filters are noise; show each kit as a wide row with its install line
function featureCard(k) {
  const bits = [k.adds.skills.length ? plural(k.adds.skills.length, "skill") : "", k.adds.agents.length ? plural(k.adds.agents.length, "agent") : ""].filter(Boolean).join(", ");
  const latest = dateOf(k.changelog[0]?.head);
  const checks = trustChecks(k), passed = checks.filter((c) => c.ok).length;
  return `<li class="card feature" data-card data-groups="all" data-text="${esc(k.name.toLowerCase())}">
<div class="feature-main"><div class="meta-line">${badge(k)}${latest ? `<span class="ver">updated ${esc(latest)}</span>` : ""}</div>
<h3><a class="name" href="k/${esc(k.name)}/">${esc(k.name)}</a></h3>
<p class="promise">${esc(k.promise)}</p>
<p class="muted">${esc(bits)} · <a href="k/${esc(k.name)}/#trust">${passed} of ${checks.length} build checks pass</a> · <a href="k/${esc(k.name)}/#access">what it reads and sends</a></p></div>
<div class="feature-side"><p class="label">Install, after adding the marketplace</p>${copyCmd(k.install[k.install.length - 1] ?? "")}<p><a class="more" href="k/${esc(k.name)}/">Skills, access and changelog</a></p></div>
</li>`;
}

function releaseFeed(kits) {
  return kits.flatMap((k) => k.changelog.map((e) => ({ k, e, date: dateOf(e.head), v: e.head.split(/\s+/)[0] })))
    .filter((r) => /^\d+\.\d+\.\d+$/.test(r.v))
    .sort((a, b) => b.date.localeCompare(a.date) || b.v.localeCompare(a.v, undefined, { numeric: true }));
}

function atomFeed(kits) {
  const items = releaseFeed(kits);
  const updated = items[0]?.date ? `${items[0].date}T00:00:00Z` : `${BUILT}T00:00:00Z`;
  const entry = ({ k, e, date, v }) => `<entry>
<id>tag:praxikit.github.io,${date || BUILT}:${esc(k.name)}-${esc(v)}</id>
<title>${esc(k.name)} ${esc(v)}</title>
<updated>${date || BUILT}T00:00:00Z</updated>
<link rel="alternate" href="${esc(HOME_URL)}k/${esc(k.name)}/"/>
<summary type="text">${esc(e.bullets.map((b) => b.replace(/`/g, "")).join("\n"))}</summary>
</entry>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>tag:praxikit.github.io,2026:releases</id>
<title>Praxikit releases</title>
<subtitle>New versions of Praxikit kits, from their changelogs.</subtitle>
<updated>${updated}</updated>
<link rel="self" href="${esc(HOME_URL)}feed.xml"/>
<link rel="alternate" href="${esc(HOME_URL)}"/>
${items.slice(0, 30).map(entry).join("\n")}
</feed>
`;
}

function indexPage(kits, recs) {
  const cols = [...new Set(kits.flatMap((k) => k.collections))];
  const kinds = [...new Set(kits.map(kindOf))];
  const many = kits.length >= 4;
  const chip = (id, label) => `<button type="button" class="chip" data-chip="${esc(id)}" aria-pressed="${id === "all"}">${esc(label)}</button>`;
  const chips = [chip("all", "All"), ...kinds.map((x) => chip(slug(x), x)), ...cols.map((c) => chip(slug(c), c))].join("");

  const feed = releaseFeed(kits).slice(0, 5);
  const feedHtml = feed.map(({ k, e, date, v }) => `<li><div class="feed-meta"><a href="k/${esc(k.name)}/">${esc(k.name)} ${esc(v)}</a>${date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : ""}</div><p>${md(short(e.bullets[0] ?? ""))}</p></li>`).join("");

  const recHtml = recs.length
    ? `<ul class="recs">${recs.map((r) => `<li class="card"><div class="meta-line"><span class="kind ext">${esc(r.category)}</span><span class="ver">added ${esc(r.added)}</span></div><h3><a class="name" href="${esc(r.url)}" rel="noopener noreferrer">${esc(r.name)}</a></h3><p class="muted">by ${esc(r.author)}</p><p class="promise">${esc(r.why)}</p></li>`).join("")}</ul>`
    : `<p class="muted">Nothing listed yet. <a href="${esc(ISSUE("recommend.yml"))}" rel="noopener noreferrer">Recommend something</a> you have used and would vouch for.</p>`;

  const demoKit = kits.find((k) => k.preview?.length >= 2);
  const demo = demoKit ? `<figure class="demo"><figcaption>What ${esc(demoKit.name)} prints in Claude Code</figcaption>${demoKit.preview.slice(0, 2).map((p) => `<pre><code>${esc(p.body)}</code></pre>`).join("")}<p class="muted">${esc(demoKit.preview[1].note ?? "")}</p></figure>` : "";
  const first = kits[0];
  const firstDate = dateOf(first?.changelog[0]?.head);

  const body = `
<section class="hero"><div class="wrap hero-in">
<div class="hero-text">
<h1>Small, readable kits for AI coding agents.</h1>
<p class="lead">Plugins, skills and templates for Claude Code, and the same method for Cursor and Codex. Each kit is versioned, has a changelog, and says what it reads, writes and sends.</p>
<ol class="steps"><li><span class="label">Add the marketplace once, in Claude Code</span>${install(["/plugin marketplace add praxikit/praxikit"])}</li>
<li><span class="label">Then install a kit, for example</span>${install([first?.install?.[first.install.length - 1] ?? "/plugin install keel@praxikit"])}</li></ol>
${first ? `<p class="muted">${esc(first.name)} v${esc(first.version)}${firstDate ? `, released ${esc(firstDate)}` : ""}. MIT licence.</p>` : ""}
</div>
${demo}
</div></section>

<section id="kits" class="wrap sec"><div class="sec-head"><h2>Kits</h2><p class="muted" id="count" aria-live="polite">${plural(kits.length, "kit")}</p></div>
${many ? `<div class="toolbar"><label class="search"><span class="vh">Search kits</span><input id="q" type="search" placeholder="Search kits  ( / )" autocomplete="off" spellcheck="false"></label><div class="chips" role="group" aria-label="Filter kits">${chips}</div></div>` : ""}
<ul class="cards${many ? "" : " few"}" id="kits-list">${kits.map((k) => (many ? card(k, "./") : featureCard(k))).join("") || ""}</ul>
${many ? `<div id="none" hidden class="empty"><p><strong>No kit matches.</strong> <button id="clear" class="linklike" type="button">Clear filters</button></p></div>` : ""}
${kits.length ? "" : '<p class="muted">No kits yet.</p>'}
</section>

<section id="updates" class="wrap sec"><h2>Updates</h2>
<div class="updates">
<div><h3>Am I up to date?</h3><p class="muted">Pick the version you have to see only what changed since. Or run <code>/keel:status</code>, which prints a link that fills this in.</p>${checker(kits) || '<p class="muted">No versioned kits yet.</p>'}</div>
<div><h3>Latest releases</h3><ul class="feed">${feedHtml || '<li class="muted">No releases yet.</li>'}</ul><p><a href="feed.xml">Subscribe with the release feed</a> (Atom, works in any feed reader).</p></div>
</div></section>

<section id="recommended" class="wrap sec"><h2>Recommended</h2>
<p class="note">Made by other people. Praxikit did not build these and does not promise they are safe; read the source before installing anything.</p>${recHtml}</section>

<section id="submit" class="wrap sec"><h2>Submit a kit</h2>
<div class="submit">
<div><h3>You built one</h3><p>Describe it, link the repository and say what it reads, writes and sends. Free to submit.</p><p><a class="btn" href="${esc(ISSUE("suggest-kit.yml"))}" rel="noopener noreferrer">Open the submission form</a></p></div>
<div><h3>You use someone else's</h3><p>Recommend a kit you have used and would vouch for, and say why.</p><p><a class="btn ghost" href="${esc(ISSUE("recommend.yml"))}" rel="noopener noreferrer">Open the recommendation form</a></p></div>
</div>
<p class="muted">Both forms open a GitHub issue, so you need a free GitHub account. An automatic check reads the repository without running it and comments what it found, then a person reads every submission before anything is listed. Nothing is listed for payment.</p></section>

<section class="wrap sec faq"><h2>Questions</h2>
<details><summary>What happens when I install a kit?</summary><p>Claude Code copies the kit's files and registers its skills, agents and hooks. Each kit page lists the hooks it runs and what it reads, writes and sends, and the source is in the repository if you want to read it first.</p></details>
<details><summary>How do updates reach me?</summary><p>Run <code>/plugin marketplace update praxikit</code>, then <code>/reload-plugins</code>. Kits use semantic versions and keep a changelog; the checker above shows what changed since yours.</p></details>
<details><summary>What happens after I submit a kit?</summary><p>A bot reads the public repository at the commit you linked, without running or installing anything, and comments on your issue: licence, secret-like strings, code that runs automatically, network access, binaries and hidden instructions. It reports what it found and never says a kit is safe. A person then reads the source and decides; a listing is pinned to the commit they reviewed.</p></details>
<details><summary>What do the build checks on a kit page mean?</summary><p>They are computed from the files when the site is built: the manifest is complete, the changelog matches the version, the scripts contain no network code. They show the kit is consistent. They are not a security audit.</p></details>
</section>`;
  return page({ title: "Praxikit — kits for AI coding agents", depth: 0, body, canonical: HOME_URL, description: "Versioned, readable kits for AI coding agents: plugins, skills and templates, each with a changelog and a list of what it reads, writes and sends." });
}

function collectionPage(c, kits) {
  const list = kits.filter((k) => k.collections.includes(c));
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../">All kits</a> / Collection</p><h1>${esc(c)}</h1><p class="lead">${plural(list.length, "kit")} in this collection.</p><ul class="cards">${list.map((k) => card(k, "../../")).join("")}</ul></div>`;
  return page({ title: `${c} — Praxikit`, depth: 2, body, description: `Praxikit kits in the ${c} collection.` });
}

function installBlock(k) {
  const tools = k.installBy?.length ? k.installBy : [{ tool: "Claude Code", steps: k.install }];
  if (tools.length === 1) return `<div>${install(tools[0].steps)}${tools[0].note ? `<p class="muted">${esc(tools[0].note)}</p>` : ""}</div>`;
  const id = (i) => `tab-${slug(k.name)}-${i}`;
  return `<div data-tabs><div role="tablist" aria-label="Install for" class="tablist" hidden>${tools.map((t, i) => `<button type="button" role="tab" id="${id(i)}" aria-controls="${id(i)}-p" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(t.tool)}</button>`).join("")}</div>
${tools.map((t, i) => `<div role="tabpanel" id="${id(i)}-p" aria-labelledby="${id(i)}"><p class="tool-name">${esc(t.tool)}</p>${install(t.steps)}${t.note ? `<p class="muted">${esc(t.note)}</p>` : ""}</div>`).join("")}</div>`;
}

function accessBlock(k) {
  const parts = [];
  if (k.hooks?.length) parts.push(`<h3>Runs automatically</h3><ul class="access">${k.hooks.map((h) => `<li><code>${esc(h.event)}</code>${h.matcher ? ` on <code>${esc(h.matcher)}</code>` : ""} runs <code>${esc(h.script)}</code></li>`).join("")}</ul><p class="muted">Listed from the kit's <code>hooks.json</code>, so it matches what is installed.</p>`);
  if (k.access) {
    parts.push(`<h3>Reads</h3><ul class="access">${k.access.reads.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
    parts.push(`<h3>Writes</h3><ul class="access">${k.access.writes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
    parts.push(`<h3>Network</h3><p>${esc(k.access.network)}</p><p class="muted">Reads, writes and network are declared by the kit's author. Read the source before you rely on them.</p>`);
  }
  return parts.length ? `<section id="access"><h2>What it does on your machine</h2>${parts.join("")}</section>` : "";
}

function trustBlock(k) {
  const checks = trustChecks(k);
  const short7 = SHA ? SHA.slice(0, 7) : "";
  const where = SHA ? `commit <a href="${esc(REPO)}/commit/${esc(SHA)}" rel="noopener noreferrer"><code>${esc(short7)}</code></a>, <a href="${esc(REPO)}/commit/${esc(SHA)}/checks" rel="noopener noreferrer">CI results for it</a>` : "a build outside CI, so no commit is shown";
  return `<section id="trust"><h2>Build checks</h2>
<ul class="checks">${checks.map((c) => `<li class="${c.ok ? "pass" : "fail"}"><span class="mark" aria-hidden="true">${c.ok ? "✓" : "✗"}</span><span><span class="vh">${c.ok ? "Passed: " : "Failed: "}</span>${esc(c.text)}</span></li>`).join("")}</ul>
<p class="muted">Computed from the files at ${where}, built ${esc(BUILT)}. These show the kit is consistent. They are not a security audit and do not mean the kit is safe.</p></section>`;
}

function previewBlock(k) {
  if (!k.preview?.length) return "";
  return `<section><h2>What you'll see</h2><div class="previews">${k.preview.map((p) => `<figure class="preview"><figcaption><strong>${esc(p.title)}</strong>${p.note ? `<span class="muted">${esc(p.note)}</span>` : ""}</figcaption><pre><code>${esc(p.body)}</code></pre></figure>`).join("")}</div></section>`;
}

function kitPage(k) {
  const tile = (s, label) => `<li class="tile"><span class="tile-kind">${label}</span><strong>${esc(label === "skill" && k.kind === "plugin" ? `/${k.name}:${s.name}` : s.name)}</strong><p>${esc(short(s.description))}</p></li>`;
  const adds = [];
  if (k.adds.skills.length) adds.push(`<section><h2>Skills <span class="count">${k.adds.skills.length}</span></h2><ul class="tiles">${k.adds.skills.map((s) => tile(s, "skill")).join("")}</ul></section>`);
  if (k.adds.agents.length) adds.push(`<section><h2>Agents <span class="count">${k.adds.agents.length}</span></h2><ul class="tiles">${k.adds.agents.map((s) => tile(s, "agent")).join("")}</ul></section>`);
  const log = k.changelog.map((e, i) => `<li class="log-item"><div class="log-head"><h3>${esc(e.head)}</h3>${i === 0 ? '<span class="kind">Latest</span>' : ""}</div><ul>${e.bullets.map((b) => `<li>${md(b)}</li>`).join("")}</ul></li>`).join("");
  const latest = dateOf(k.changelog[0]?.head);
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../">All kits</a> / ${esc(kindOf(k))}</p>
<h1>${esc(k.name)}</h1>
<p class="meta-line">${badge(k)}${latest ? `<span>released ${esc(latest)}</span>` : ""}<span>${k.collections.map((c) => `<a href="../../c/${slug(c)}/">${esc(c)}</a>`).join(", ")}</span></p>
<p class="lead">${esc(k.promise)}</p>
<div class="two">
<div class="main-col">
${previewBlock(k)}
${adds.join("\n")}
${accessBlock(k)}
${trustBlock(k)}
<section><h2>Honest limits</h2><ul class="limits">${k.limits.map((l) => `<li>${md(l)}</li>`).join("")}</ul></section>
<section><h2>Changelog</h2>${log ? `<ol class="log">${log}</ol>` : '<p class="muted">No changelog.</p>'}</section>
</div>
<aside class="side"><div class="panel"><h2>Install</h2>${installBlock(k)}<p class="muted">Update later (Claude Code):</p>${copyCmd("/plugin marketplace update praxikit")}<p class="muted">then <code>/reload-plugins</code>.</p>
${checker([k], k.name) ? `<h2 class="ck-title">Am I up to date?</h2>${checker([k], k.name)}` : ""}
<p class="side-links"><a href="${esc(REPO)}/tree/main/kits/${esc(k.name)}" rel="noopener noreferrer">Source on GitHub</a></p></div></aside>
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
write("feed.xml", atomFeed(kits));
for (const c of new Set(kits.flatMap((k) => k.collections))) write(`c/${slug(c)}/index.html`, collectionPage(c, kits));
for (const k of kits) write(`k/${k.name}/index.html`, kitPage(k));
write("versions.json", JSON.stringify(Object.fromEntries(kits.map((k) => [k.name, { version: k.version, kind: k.kind }])), null, 2) + "\n");
write(".nojekyll", "");
console.log(`built ${kits.length} kit(s), ${recs.length} recommendation(s) -> ${OUT}`);
