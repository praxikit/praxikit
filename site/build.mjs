#!/usr/bin/env node
/**
 * Builds the Praxikit catalog as static HTML. No dependencies.
 *
 *   node site/build.mjs [--root <repo dir>] [--out <dir>]
 *
 * Reads  <root>/kits/<name>/{kit.json,CHANGELOG.md,plugin/skills,plugin/agents}
 *        <root>/site/listings.json, site/drift.json
 * Writes <out>/index.html, 404.html, c/<collection>/index.html, k/<kit>/index.html, versions.json, style.css
 *
 * Every string that comes from a manifest or data file goes through esc(). Links are relative so the
 * site lives at one address, set in site/config.json.
 * Our own inline scripts carry a data-site attribute so the test can prove no other script exists.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { validateListing } from "./listings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = arg("--root", join(here, ".."));
const OUT = arg("--out", join(ROOT, "site", "dist"));
const REPO = "https://github.com/praxikit/praxikit";
// site/config.json: { "app": "https://..." } is the address of the admin app that takes submissions
const CONFIG = (() => { try { return JSON.parse(readFileSync(arg("--config", join(ROOT, "site", "config.json")), "utf8")); } catch { return {}; } })();
const APP = typeof CONFIG.app === "string" && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(CONFIG.app.replace(/\/+$/, "")) ? CONFIG.app.replace(/\/+$/, "") : "";
// site/config.json "site" is the public address of the site (with the app on the same address, accounts live there too)
const SITE_OK = typeof CONFIG.site === "string" && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(CONFIG.site) ? CONFIG.site.replace(/\/+$/, "") + "/" : "";
const HOME_URL = SITE_OK || "https://praxikit.com/";
const hashStr = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };

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
/** Other people's kits (listed, or marked as the owner's picks) from site/listings.json. A bad entry stops the build. */
function loadListings() {
  const f = join(ROOT, "site", "listings.json");
  if (!existsSync(f)) return [];
  const items = readJson(f);
  if (!Array.isArray(items)) throw new Error("listings.json must be a list");
  for (const l of items) {
    const problems = validateListing(l);
    if (problems.length) throw new Error(`listings: ${String(l?.name ?? "entry").slice(0, 40)}: ${problems.join("; ")}`);
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
  if (k.kind === "plugin" || existsSync(join(dir, "plugin", ".claude-plugin", "plugin.json"))) {
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
// The mark: building blocks (kits) assembled into a P. The one block set apart in amber is the pick.
const BLOCKS = [[0, 0], [8, 0], [0, 8], [0, 16], [8, 16], [0, 24]]; // x, y of each block on a 3 by 4 grid (6 wide, 2 gap)
const SPARK = [16, 8];
const mark = (fill, spark) => BLOCKS.map(([x, y]) => `<rect x="${x}" y="${y}" width="6" height="6" rx="1.4" fill="${fill}"/>`).join("") + `<rect x="${SPARK[0]}" y="${SPARK[1]}" width="6" height="6" rx="1.4" fill="${spark}"/>`;
const LOGO = `<svg class="logo" viewBox="0 0 22 30" width="22" height="30" aria-hidden="true" focusable="false">${mark("var(--accent)", "var(--spark)")}</svg>`;
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -1 30 32" width="240" height="256">${mark("#0f8a7e", "#d97a14")}</svg>`;
const FAVICON = "data:image/svg+xml," + encodeURIComponent(LOGO_SVG.replace(' width="240" height="256"', ""));
const ISSUE = (t) => `${REPO}/issues/new?template=${t}`;

/** Structured data for search engines. "<" is escaped so no text from a kit can end the script block. */
const jsonLd = (obj) => JSON.stringify(obj).split("<").join(String.fromCharCode(92) + "u003c");

function ogPng() {
  const W = 1200, H = 630, rows = [];
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const sc = 15, ox = 600 - (22 * sc) / 2, oy = 315 - (30 * sc) / 2; // the mark, centred
  const rects = [...BLOCKS.map(([x, y]) => [x, y, [15, 138, 126]]), [SPARK[0], SPARK[1], [217, 122, 20]]].map(([x, y, col]) => ({ x: ox + x * sc, y: oy + y * sc, w: 6 * sc, r: 1.4 * sc, col }));
  const cover = (px, py, q) => { // anti-aliased rounded square
    const cx = q.x + q.w / 2, cy = q.y + q.w / 2, hx = q.w / 2 - q.r;
    const dx = Math.max(Math.abs(px - cx) - hx, 0), dy = Math.max(Math.abs(py - cy) - hx, 0);
    return Math.min(1, Math.max(0, q.r - Math.hypot(dx, dy) + 0.5));
  };
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) {
      const g = Math.max(0, 1 - Math.hypot((x - 600) / 620, (y - 315) / 380)); // soft glow behind the mark
      let r = 11 + 20 * g * g, gr = 18 + 56 * g * g, b = 17 + 50 * g * g;
      for (const q of rects) { const a = cover(x + 0.5, y + 0.5, q); if (a > 0) { r += (q.col[0] - r) * a; gr += (q.col[1] - gr) * a; b += (q.col[2] - b) * a; } }
      row[1 + x * 3] = Math.round(r); row[2 + x * 3] = Math.round(gr); row[3 + x * 3] = Math.round(b);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const THEME_BOOT = `try{var t=localStorage.getItem("praxikit-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
// No regular expressions in here: this is a template literal, where backslashes would be eaten.
const SITE_JS = `
(function () {
  var root = document.documentElement;
  // links printed by older Keel versions pointed at the home page; the checker now lives on the Updates page
  if (document.body.hasAttribute("data-home") && location.search.indexOf("kit=") > -1) { location.replace("updates/" + location.search + "#updates"); return; }
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
      // "claude plugin list --json" prints an array of { id: "name@marketplace", version, ... }
      try {
        var arr = JSON.parse(text);
        if (Array.isArray(arr)) arr.forEach(function (it) {
          if (hit || !it || typeof it.id !== "string" || typeof it.version !== "string") return;
          var nm = it.id.split("@")[0];
          if (data[nm]) { hit = nm; ver = it.version; }
        });
      } catch (e) {}
      for (var i = 0; !hit && i < names.length; i++) { var v = versionIn(text, names[i]); if (v) { hit = names[i]; ver = v; } }
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
  // ---- menu button (small screens)
  var mt = document.getElementById("menu-toggle"), hdr = document.querySelector("header.top");
  if (mt && hdr) mt.addEventListener("click", function () {
    var open = hdr.hasAttribute("data-open");
    if (open) hdr.removeAttribute("data-open"); else hdr.setAttribute("data-open", "");
    mt.setAttribute("aria-expanded", String(!open));
  });

  // ---- save to collection: stays a plain link until we know you are signed in
  var savedMap = null, toastEl = null, toastTimer = 0;
  function toast(msg, href, label) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    if (href) { var a = document.createElement("a"); a.href = href; a.textContent = label; toastEl.appendChild(a); }
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3800);
  }
  function paintSaved(btn, on) {
    var name = btn.getAttribute("data-name") || "this kit";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", (on ? "Remove " + name + " from" : "Save " + name + " to") + " your collection");
    btn.title = on ? "Saved. Press to remove" : "Save to your collection";
    var t = btn.querySelector("span"); if (t) t.textContent = on ? "Saved" : "Save";
  }
  function paintAll() {
    [].slice.call(document.querySelectorAll("[data-save]")).forEach(function (b) { paintSaved(b, !!savedMap[b.getAttribute("data-save")]); });
  }
  function loadSaved() {
    fetch("/api/collection", { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !Array.isArray(d.items)) return;
      savedMap = {}; d.items.forEach(function (i) { savedMap[i] = true; });
      paintAll();
    }).catch(function () {});
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-save]") : null;
    if (!b || savedMap === null) return;
    e.preventDefault();
    if (b.getAttribute("data-busy")) return;
    b.setAttribute("data-busy", "1");
    var item = b.getAttribute("data-save"), body = new URLSearchParams();
    body.set("item", item);
    fetch("/collection/toggle", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok && typeof x.j.saved === "boolean") { savedMap[item] = x.j.saved; paintAll(); toast(x.j.saved ? "Saved to your collection" : "Removed from your collection", "/collection", "View"); }
        else toast(typeof x.j.message === "string" ? x.j.message : "Could not save that. Try again.");
      })
      .catch(function () { toast("Could not reach the server. Try again."); })
      .then(function () { b.removeAttribute("data-busy"); });
  });

  // ---- account: only where the site and the app share one address; the page works the same without it
  var appOrigin = document.body.getAttribute("data-app") || "";
  var slot = document.getElementById("acct");
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function link(href, text) { var a = el("a", "", text); a.href = href; return a; }
  var signin = slot ? slot.querySelector("a.signin") : null;
  if (signin && location.pathname.indexOf("/auth") !== 0) signin.href = signin.getAttribute("href") + "&return=" + encodeURIComponent(location.pathname + location.search);
  var hinted = document.cookie.indexOf("praxikit-in=1") > -1;
  if (slot && appOrigin && location.origin === appOrigin && hinted) {
    fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      if (!me || typeof me.login !== "string") { document.cookie = "praxikit-in=; Max-Age=0; Path=/; Secure; SameSite=Lax"; return; }
      loadSaved();
      var nav = document.querySelector("header nav"), admin = me.role === "admin";
      if (admin && nav) { var a = link("/admin", "Admin"); a.className = "admin-tab"; if (location.pathname.indexOf("/admin") === 0) a.setAttribute("aria-current", "page"); nav.insertBefore(a, nav.firstChild); }
      if (nav) { var mine = link("/collection", "My collection"); if (location.pathname.indexOf("/collection") === 0) mine.setAttribute("aria-current", "page"); nav.insertBefore(mine, nav.querySelector('a[href^="https://github.com"]')); }
      var d = el("details", "menu"), sum = el("summary");
      if (Number.isInteger(me.id)) { var img = el("img"); img.src = "https://avatars.githubusercontent.com/u/" + me.id + "?s=64"; img.alt = ""; img.width = 28; img.height = 28; sum.appendChild(img); }
      sum.appendChild(el("span", "", me.login)); sum.setAttribute("aria-label", "Account menu for " + me.login);
      var list = el("div", "menu-list");
      list.appendChild(link("/profile", "Profile")); list.appendChild(link("/collection", "My collection")); list.appendChild(link("/settings", "Settings"));
      if (admin) list.appendChild(link("/admin", "Admin"));
      var f = el("form"); f.method = "post"; f.action = "/auth/logout"; var b = el("button", "", "Sign out"); b.type = "submit"; f.appendChild(b); list.appendChild(f);
      d.appendChild(sum); d.appendChild(list);
      slot.textContent = ""; slot.appendChild(d);
      document.addEventListener("click", function (e) { if (!d.contains(e.target)) d.removeAttribute("open"); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") d.removeAttribute("open"); });
    }).catch(function () {});
  }

  // ---- community: counts on cards, and "helped me" with short notes on a kit's own page
  function apiCall(path, method, form) {
    var init = { method: method || "GET", credentials: "same-origin", headers: { Accept: "application/json" } };
    if (form) { var b = new URLSearchParams(); Object.keys(form).forEach(function (k) { b.set(k, form[k]); }); init.body = b.toString(); init.headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    return fetch(path, init).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  var stats = [].slice.call(document.querySelectorAll("[data-stat]"));
  if (stats.length && appOrigin && location.origin === appOrigin) {
    fetch("/api/counts", { headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c) return;
      stats.forEach(function (el) {
        var key = el.getAttribute("data-stat"), parts = [], v = c.votes && c.votes[key], s = c.saves && c.saves[key];
        if (v) parts.push(v + (v === 1 ? " person found it useful" : " people found it useful"));
        if (s) parts.push("saved by " + s);
        if (parts.length) { el.textContent = parts.join(" · "); el.hidden = false; }
      });
    }).catch(function () {});
  }
  var com = document.getElementById("community-body"), comRoot = document.getElementById("community");
  if (com && comRoot && appOrigin && location.origin === appOrigin) {
    var comItem = comRoot.getAttribute("data-item");
    var loadCom = function () {
      apiCall("/api/item?item=" + encodeURIComponent(comItem)).then(function (x) { if (x.ok) renderCom(x.j); else com.textContent = "This could not be loaded just now."; }).catch(function () { com.textContent = "This could not be loaded just now."; });
    };
    var renderCom = function (d) {
      com.textContent = "";
      var bar = node("div", "vote-row");
      var vote = node("button", "vote-btn"); vote.type = "button";
      vote.setAttribute("aria-pressed", d.voted ? "true" : "false");
      var thumb = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      thumb.setAttribute("viewBox", "0 0 24 24"); thumb.setAttribute("class", "ic"); thumb.setAttribute("aria-hidden", "true");
      var tp = document.createElementNS("http://www.w3.org/2000/svg", "path"); tp.setAttribute("d", "M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.2 2.6L12.7 9H19a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 17.8 19H7");
      thumb.appendChild(tp); vote.appendChild(thumb);
      vote.appendChild(node("span", "", d.voted ? "Helped me" : "This helped me"));
      vote.appendChild(node("span", "count", String(d.votes)));
      var msg = node("p", "com-msg muted"); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite");
      vote.addEventListener("click", function () {
        if (!d.signedIn) { location.href = "/auth/login?mode=user&return=" + encodeURIComponent(location.pathname); return; }
        apiCall("/api/vote", "POST", { item: comItem }).then(function (x) { if (x.ok) loadCom(); else msg.textContent = x.j.message || "Could not save that."; });
      });
      bar.appendChild(vote);
      if (d.saves) bar.appendChild(node("span", "muted", "Saved by " + d.saves + " people"));
      com.appendChild(bar);
      var list = node("ul", "notes");
      d.notes.forEach(function (n) {
        var li = node("li", "note-item");
        var head = node("div", "note-head");
        head.appendChild(node("strong", "", "@" + n.login)); head.appendChild(node("span", "muted", n.at));
        li.appendChild(head); li.appendChild(node("p", "", n.text));
        if (d.signedIn && !n.mine) {
          var rep = node("button", "linklike", "Report"); rep.type = "button";
          rep.addEventListener("click", function () { apiCall("/api/note/report", "POST", { id: String(n.id) }).then(function () { rep.textContent = "Reported"; rep.disabled = true; }); });
          li.appendChild(rep);
        }
        list.appendChild(li);
      });
      if (d.notes.length) { com.appendChild(node("h3", "", "How it helped people")); com.appendChild(list); }
      else com.appendChild(node("p", "muted", "No notes yet. If this kit helped you, say how in a sentence."));
      if (!d.signedIn) {
        var p = node("p", "muted"); var a = node("a", "", "Sign in with GitHub"); a.href = "/auth/login?mode=user&return=" + encodeURIComponent(location.pathname);
        p.appendChild(a); p.appendChild(document.createTextNode(" to say it helped, or to add a note.")); com.appendChild(p); return;
      }
      var form = node("form", "note-form");
      var lab = node("label", "", d.mine ? "Your note" : "Tell people how it helped"); lab.setAttribute("for", "note-text");
      var ta = node("textarea"); ta.id = "note-text"; ta.maxLength = 240; ta.rows = 3; ta.value = d.mine ? d.mine.text : ""; ta.setAttribute("placeholder", "One or two sentences, in your own words. No links.");
      var row = node("div", "note-row");
      var send = node("button", "btn", d.mine ? "Update note" : "Share"); send.type = "submit";
      var hint = node("span", "muted", "10 to 240 characters. Shown with your GitHub name. A first note is read by a maintainer before it appears.");
      row.appendChild(send); form.appendChild(lab); form.appendChild(ta); form.appendChild(row); form.appendChild(hint);
      if (d.mine && d.mine.status !== "approved") form.appendChild(node("p", "note", d.mine.status === "pending" ? "Your note is waiting for a maintainer. Only you can see it until then." : "Your note is hidden for now."));
      if (d.mine) {
        var del = node("button", "linklike", "Delete my note"); del.type = "button";
        del.addEventListener("click", function () { apiCall("/api/note/delete", "POST", { item: comItem }).then(loadCom); });
        form.appendChild(del);
      }
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        send.disabled = true;
        apiCall("/api/note", "POST", { item: comItem, text: ta.value }).then(function (x) {
          send.disabled = false;
          if (x.ok) { loadCom(); toast(x.j.status === "pending" ? "Thanks. A maintainer will read your note before it appears." : "Thanks. Your note is up."); }
          else msg.textContent = x.j.message || "Could not save that.";
        }).catch(function () { send.disabled = false; msg.textContent = "Could not reach the server. Try again."; });
      });
      com.appendChild(form); com.appendChild(msg);
    };
    loadCom();
  }

  var tgl = document.getElementById("theme");
  if (tgl) tgl.addEventListener("click", function () {
    var cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    tgl.setAttribute("aria-pressed", String(next === "dark"));
    try { localStorage.setItem("praxikit-theme", next); } catch (e) {}
  });
  // ---- copy an install line from a card
  document.querySelectorAll("[data-copy-text]").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      var text = b.getAttribute("data-copy-text") || "";
      copyText(text, function (ok) { toast(ok ? "Copied: " + text : "Could not copy. Select it on the kit page instead."); });
    });
  });

  // ---- the kits list: text filter, show (all, built, picks, listed), sort, and the address remembers it
  var q = document.getElementById("q"), grid = document.getElementById("kits");
  if (q && grid) {
    var cards = [].slice.call(grid.querySelectorAll("[data-card]")), ul = cards.length ? cards[0].parentNode : null;
    cards.forEach(function (c, i) { c.setAttribute("data-i", String(i)); });
    var segs = [].slice.call(document.querySelectorAll("[data-show]")), sortSel = document.getElementById("sort"), tagSel = document.getElementById("tag");
    var count = document.getElementById("count"), none = document.getElementById("none"), show = "all";
    var params = new URLSearchParams(location.search), wanted = params.get("show");
    q.value = (params.get("q") || "").slice(0, 100);
    if (["all", "built", "pick", "listed"].indexOf(wanted) > -1 && segs.some(function (s) { return s.getAttribute("data-show") === wanted; })) show = wanted;
    if (sortSel && ["featured", "new", "az"].indexOf(params.get("sort")) > -1) sortSel.value = params.get("sort");
    if (tagSel) {
      var wantTag = params.get("tag") || "", tagOptions = tagSel.options ? [].slice.call(tagSel.options).map(function (o) { return o.value; }) : [];
      if (wantTag && tagOptions.indexOf(wantTag) > -1) tagSel.value = wantTag;
    }
    var apply = function () {
      var term = q.value.trim().toLowerCase(), shown = 0, mode = sortSel ? sortSel.value : "featured", wantedTag = tagSel ? tagSel.value : "";
      var order = cards.slice();
      if (mode === "new") order.sort(function (a, b) { return b.getAttribute("data-date").localeCompare(a.getAttribute("data-date")) || a.getAttribute("data-i") - b.getAttribute("data-i"); });
      else if (mode === "az") order.sort(function (a, b) { return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name")); });
      else order.sort(function (a, b) { return a.getAttribute("data-i") - b.getAttribute("data-i"); });
      if (ul) order.forEach(function (c) { ul.appendChild(c); });
      cards.forEach(function (c) {
        var okShow = show === "all" || c.getAttribute("data-src") === show;
        var okText = !term || c.getAttribute("data-text").indexOf(term) > -1;
        var okTag = !wantedTag || (" " + (c.getAttribute("data-tags") || "") + " ").indexOf(" " + wantedTag + " ") > -1;
        var on = okShow && okText && okTag; c.hidden = !on; if (on) shown++;
      });
      segs.forEach(function (s) { s.setAttribute("aria-pressed", String(s.getAttribute("data-show") === show)); });
      count.textContent = shown + (shown === 1 ? " kit" : " kits");
      none.hidden = shown !== 0;
      var p = new URLSearchParams();
      if (term) p.set("q", q.value.trim());
      if (show !== "all") p.set("show", show);
      if (mode !== "featured") p.set("sort", mode);
      if (wantedTag) p.set("tag", wantedTag);
      var s = p.toString();
      try { history.replaceState(null, "", location.pathname + (s ? "?" + s : "")); } catch (e) {}
    };
    q.addEventListener("input", apply);
    if (sortSel) sortSel.addEventListener("change", apply);
    if (tagSel) tagSel.addEventListener("change", apply);
    segs.forEach(function (s) { s.addEventListener("click", function () { show = s.getAttribute("data-show"); apply(); }); });
    var clear = document.getElementById("clear");
    if (clear) clear.addEventListener("click", function () { q.value = ""; show = "all"; if (sortSel) sortSel.value = "featured"; if (tagSel) tagSel.value = ""; apply(); });
    apply();
  }

  // ---- site search: a prebuilt index, matched in the browser. Results are built with textContent only.
  var siteRoot = document.body.getAttribute("data-root") || "./";
  /*search-start*/
  function searchIndex(index, query) {
    var words = String(query || "").toLowerCase().split(" ").filter(function (w) { return w.length > 0; });
    if (!words.length) return [];
    var out = [];
    index.forEach(function (e) {
      var title = String(e.t || "").toLowerCase(), tags = String(e.g || "").toLowerCase(), desc = String(e.d || "").toLowerCase(), score = 0, ok = true;
      words.forEach(function (w) {
        var s = 0;
        if (title.indexOf(w) === 0) s += 6; else if (title.indexOf(w) > -1) s += 4;
        if (tags.split(" ").indexOf(w) > -1) s += 4; else if (tags.indexOf(w) > -1) s += 2;
        if (desc.indexOf(w) > -1) s += 1;
        if (!s) ok = false;
        score += s;
      });
      if (ok) out.push({ e: e, score: score + (e.k === "pick" ? 1 : 0) });
    });
    out.sort(function (a, b) { return b.score - a.score || String(a.e.t).localeCompare(String(b.e.t)); });
    return out.map(function (x) { return x.e; });
  }
  /*search-end*/
  var KIND_NAME = { kit: "Praxikit kit", skill: "Skill or command", pick: "My pick", listed: "Listed", tag: "Tag", page: "Page" };
  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) indexPromise = fetch(siteRoot + "search-index.json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    return indexPromise;
  }
  function hrefOf(e) {
    var u = String(e.p || e.u || "");
    if (u.indexOf("https://github.com/") === 0) return u;
    if (u.indexOf("://") > -1 || u.charAt(0) === "/") return "";
    return siteRoot + u;
  }
  function renderResults(list, into, limit) {
    into.textContent = "";
    list.slice(0, limit).forEach(function (e) {
      var href = hrefOf(e); if (!href) return;
      var li = document.createElement("li"), a = document.createElement("a"), kind = document.createElement("span"), d = document.createElement("span");
      a.href = href; a.textContent = e.t; if (e.ext && !e.p) a.rel = "noopener noreferrer";
      kind.className = "r-kind"; kind.textContent = KIND_NAME[e.k] || "";
      d.className = "r-desc"; d.textContent = e.d || "";
      li.appendChild(a); li.appendChild(kind); li.appendChild(d); into.appendChild(li);
    });
  }
  var box = document.getElementById("site-q");
  if (box) {
    var sug = document.createElement("ul"); sug.className = "suggest"; sug.hidden = true; sug.setAttribute("aria-label", "Search suggestions");
    box.parentNode.appendChild(sug);
    box.addEventListener("input", function () {
      var term = box.value.trim();
      if (term.length < 2) { sug.hidden = true; return; }
      loadIndex().then(function (idx) {
        if (box.value.trim() !== term) return;
        var found = searchIndex(idx, term);
        renderResults(found, sug, 6);
        sug.hidden = !sug.childNodes.length;
      });
    });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") { sug.hidden = true; box.blur(); } });
    document.addEventListener("click", function (e) { if (!box.parentNode.contains(e.target)) sug.hidden = true; });
    document.addEventListener("keydown", function (e) {
      var t = e.target && e.target.tagName;
      if (e.key === "/" && t !== "INPUT" && t !== "TEXTAREA" && t !== "SELECT") { e.preventDefault(); box.focus(); }
    });
  }
  var results = document.getElementById("results");
  if (results) {
    var qs = new URLSearchParams(location.search), term0 = (qs.get("q") || "").slice(0, 100), field = document.getElementById("search-q"), status = document.getElementById("search-status");
    if (field) field.value = term0;
    function run(term) {
      if (!term.trim()) { results.textContent = ""; status.textContent = "Type to search kits, picks, skills, tags and pages."; return; }
      loadIndex().then(function (idx) {
        var found = searchIndex(idx, term);
        renderResults(found, results, 50);
        status.textContent = found.length ? found.length + (found.length === 1 ? " result" : " results") + " for " + term : "Nothing matches " + term + ". Try fewer words, or browse the tags.";
      });
    }
    if (field) field.addEventListener("input", function () { run(field.value); });
    run(term0);
  }
})();
`;

const page = ({ title, depth, body, description, canonical, home = false, current = "", head = "", abs = false, ld = null }) => {
  const cur = (id) => (id === current ? ' aria-current="page"' : "");
  const up = abs ? "/" : depth ? "../".repeat(depth) : "./";
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
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${esc(HOME_URL)}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Praxikit mark: six teal blocks forming a P, with one amber block set apart.">
<meta name="twitter:image" content="${esc(HOME_URL)}og.png">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">\n` : ""}<meta name="theme-color" content="#f8f7f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b1211" media="(prefers-color-scheme: dark)">
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>\n` : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<link rel="alternate" type="application/atom+xml" title="Praxikit releases" href="${up}feed.xml">
${head}
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="${up}style.css">
<script src="${up}boot.js?v=${hashStr(THEME_BOOT)}" data-site></script>
</head>
<body${home ? " data-home" : ""} data-root="${up}" data-app="${esc(APP)}">
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap bar">
<a class="brand" href="${up}" aria-label="Praxikit home">${LOGO}<span>Praxikit</span></a>
<form class="site-search" role="search" action="${up}search/" method="get"><label class="vh" for="site-q">Search the catalogue</label><input id="site-q" name="q" type="search" placeholder="Search  ( / )" autocomplete="off" spellcheck="false" maxlength="100"></form>
<nav aria-label="Main" id="site-nav"><a href="${up}kits/"${cur("kits")}>Kits</a><a href="${up}updates/"${cur("updates")}>Updates</a><a href="${up}picks/"${cur("picks")}>Picks</a><a href="${up}submit/"${cur("submit")}>Submit</a><a href="${esc(REPO)}" rel="noopener noreferrer">GitHub</a>
<button id="theme" class="icon-btn" type="button" aria-label="Toggle dark mode" aria-pressed="false" title="Toggle dark mode"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" fill="currentColor"/></svg><span class="icon-label">Light or dark</span></button></nav>
<div class="acct" id="acct">${APP ? `<a class="signin" href="${esc(APP)}/auth/login?mode=user">Sign in</a>` : ""}</div>
<button class="icon-btn menu-toggle" id="menu-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
</div></header>
<main id="main">
${body}
</main>
<footer class="foot"><div class="wrap foot-in"><div><strong>Praxikit</strong><p>A catalogue of kits for AI coding agents.<br>Free, open source, MIT licence.</p></div><div class="foot-links"><a href="${esc(REPO)}" rel="noopener noreferrer">Source</a><a href="${up}about/">About</a><a href="${up}policy/">Policy</a><a href="${up}feed.xml">Release feed</a><a href="${up}versions.json">versions.json</a><a href="${up}submit/">Submit a kit</a><a href="${up}privacy/">Privacy</a></div></div></footer>
<script src="${up}site.js?v=${hashStr(SITE_JS)}" defer data-site></script>
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
<p class="muted">A web page cannot see what is installed on your machine, so paste the output of <code>claude plugin list</code> (or <code>claude plugin list --json</code>) and the version is picked for you. The text stays in your browser.</p>
<textarea data-ck-paste rows="4" spellcheck="false" aria-label="Output of claude plugin list" placeholder="keel@praxikit&#10;  Version: 0.5.0"></textarea>
<p class="muted" data-ck-pastemsg aria-live="polite"></p></details>
<div class="ck-row">${kitSelect}<label class="ck-field"><span>Version you have</span><select data-ck-ver></select></label></div>
<div class="ck-out" data-ck-out hidden aria-live="polite"></div>
<div data-ck-update hidden><p class="muted">Update with:</p>${copyCmd("/plugin marketplace update praxikit")}<p class="muted">then <code>/reload-plugins</code>.</p></div>
</div>`;
}
const badge = (k) => `<span class="kind own">Built by Praxikit</span><span class="kind">${esc(kindOf(k))}</span><span class="ver">v${esc(k.version)}</span>`;

// "same" | "changed" | "unreachable" per listing url, written daily by the listing-drift workflow; unknown values are ignored
let DRIFT = {};
function loadDrift() {
  const f = join(ROOT, "site", "drift.json");
  if (!existsSync(f)) return {};
  try { return Object.fromEntries(Object.entries(readJson(f)).filter(([, v]) => ["same", "changed", "unreachable"].includes(v))); } catch { return {}; }
}
// who put it forward: shown small, as context. It does not decide whether it is a pick.
const SLUG_OK = /^[a-z0-9-]{1,40}$/;
const tagsOf = (item) => (Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : []);
const MAX_CHIPS = 8; // a card shows at most two rows of tags; the rest are on the tag pages and in the tooltip of "+N"
/** A Save button: a link to the app's confirmation page (so it works without scripts and signs you in first), which the site script turns into a one-press toggle once you are signed in. */
const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16.2a.4.4 0 0 1-.64.32L12 16.9l-5.86 4.12a.4.4 0 0 1-.64-.32V4.5a1 1 0 0 1 1-1z"/></svg>';
const saveLink = (key, name = "", text = false) => (APP ? `<a class="save-btn${text ? " with-text" : ""}" href="${esc(APP)}/collection/save?item=${encodeURIComponent(key)}" data-save="${esc(key)}" data-name="${esc(name)}" aria-label="Save ${esc(name)} to your collection" title="Save to your collection" rel="noopener">${BOOKMARK}${text ? "<span>Save</span>" : ""}</a>` : "");
/** "What people say": filled in by the site script from the app (counts, notes, the vote button). */
const communityBlock = (key) => (APP ? `<section class="community" id="community" data-item="${esc(key)}"><h2>What people say</h2><div id="community-body"><p class="muted">Loading…</p></div><noscript><p class="muted">Votes and notes need JavaScript.</p></noscript></section>` : "");
function tagChips(item, up, max = MAX_CHIPS) {
  const all = tagsOf(item);
  if (!all.length) return "";
  const shown = all.slice(0, max);
  return `<ul class="taglist" aria-label="Tags">${shown.map((t) => `<li>${SLUG_OK.test(t) ? `<a class="tag" href="${up}tags/${esc(t)}/">${esc(t)}</a>` : `<span class="tag">${esc(t)}</span>`}</li>`).join("")}${all.length > shown.length ? `<li><span class="tag more" title="${esc(all.slice(max).join(", "))}">+${all.length - shown.length}</span></li>` : ""}</ul>`;
}

const SOURCE_LABEL = { community: "submitted by its author", recommended: "suggested by someone else" };
const CHECK_WORDS = { "no-flags-found": "automatic checks found nothing", "checks-flagged": "automatic checks flagged things a person reviewed", "checks-failed": "automatic checks failed, accepted by the admin", "needs-manual-review": "reviewed by hand" };

/** A listing made by someone else: links out to its repository and says what was reviewed. */
// Each listing (a pick or a listed kit) gets its own page at /l/<owner>-<repo>/, so a visitor can read the whole receipt before leaving for GitHub.
const LSLUG = new Map();
function assignListingSlugs(list) {
  const used = new Set();
  for (const l of list) {
    const base = l.url.replace("https://github.com/", "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "listing";
    let s = base, n = 2;
    while (used.has(s)) s = `${base}-${n++}`;
    used.add(s); LSLUG.set(l.url, s);
  }
}
const lpath = (l) => `l/${LSLUG.get(l.url) ?? "listing"}/`;
const SHIELD = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>';
const COPYICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const driftOf = (l) => {
  const st = DRIFT[l.url];
  return st === "changed" ? { badge: '<span class="kind warn">Changed since review</span>', short: "Changed since review", warn: true, note: ` <a href="${esc(l.url)}/compare/${esc(l.commit)}...HEAD" rel="noopener noreferrer">See what changed</a>.` }
    : st === "unreachable" ? { badge: '<span class="kind warn">Repository not reachable</span>', short: "Repository not reachable", warn: true, note: " It may have been removed or made private." }
      : { badge: "", short: "", warn: false, note: "" };
};
const receiptText = (l) => `Read by a person at commit ${l.commit.slice(0, 7)}; ${CHECK_WORDS[l.checks] ?? l.checks}. Installs follow the author's latest version, which can differ.`;
const sourceWord = (l) => { const w = SOURCE_LABEL[l.source] ?? ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };

const REPOICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5z"/><path d="M5 19.5A2.5 2.5 0 0 0 7.5 22H19v-5"/><path d="M9 7h6"/></svg>';
/** An icon link out to the repository, for the top corner of a card. */
const repoLink = (href, label) => `<a class="icon-act" href="${esc(href)}" rel="noopener noreferrer" aria-label="${esc(label)}" title="Open the repository on GitHub">${REPOICON}</a>`;

function extCard(l, up) {
  const d = driftOf(l);
  const groups = [slug(KIND_LABEL[l.kind] ?? l.kind), l.pick ? "picks" : "listed"].join(" ");
  const text = [l.name, l.why, l.note ?? "", l.author, l.kind, l.source, ...tagsOf(l)].join(" ").toLowerCase();
  const page = `${up}${lpath(l)}`;
  return `<li class="card" data-card data-src="${l.pick ? "pick" : "listed"}" data-name="${esc(l.name.toLowerCase())}" data-date="${esc(l.added)}" data-tags="${esc(tagsOf(l).join(" "))}" data-groups="${esc(groups)}" data-text="${esc(text)}">
<div class="card-head"><div class="meta-line">${l.pick ? '<span class="kind pick">My pick</span>' : '<span class="kind ext">Listed</span>'}<span class="kind">${esc(KIND_LABEL[l.kind] ?? l.kind)}</span>${d.badge}</div><div class="card-tools">${repoLink(l.url, `Open ${l.name} on GitHub`)}${saveLink(l.url, l.name)}</div></div>
<h3><a class="name" href="${esc(page)}">${esc(l.name)}</a></h3>
<p class="byline">by ${esc(l.author)}</p>
<p class="promise">${esc(l.why)}</p>
${tagChips(l, up, 3)}
${APP ? `<p class="stat" data-stat="${esc(l.url)}" hidden></p>` : ""}
${l.pick ? `<p class="pick-note"><strong>How I use it</strong>${esc(l.note)}</p>` : ""}
<div class="card-foot"><span class="receipt${d.warn ? " warn" : ""}" title="${esc(receiptText(l))}">${SHIELD}<span>${d.warn ? esc(d.short) : "Reviewed"} <code>${esc(l.commit.slice(0, 7))}</code></span></span></div>
</li>`;
}

function card(k, up) {
  if (k.ext) return extCard(k, up);
  const skills = k.adds.skills.length, agents = k.adds.agents.length;
  const bits = [skills ? plural(skills, "skill") : "", agents ? plural(agents, "agent") : ""].filter(Boolean).join(", ");
  const latest = dateOf(k.changelog[0]?.head);
  const groups = [slug(kindOf(k)), ...k.collections.map(slug)].join(" ");
  const text = [k.name, k.promise, ...(k.tags ?? []), ...k.collections, kindOf(k)].join(" ").toLowerCase();
  const cmd = Array.isArray(k.install) && k.install.length ? k.install[k.install.length - 1] : "";
  const copy = cmd ? `<button class="icon-act" type="button" data-copy-text="${esc(cmd)}" aria-label="Copy the install command for ${esc(k.name)}" title="Copy install command">${COPYICON}</button>` : "";
  return `<li class="card" data-card data-src="built" data-name="${esc(k.name.toLowerCase())}" data-date="${esc(latest || "")}" data-tags="${esc(tagsOf(k).join(" "))}" data-groups="${esc(groups)}" data-text="${esc(text)}">
<div class="card-head"><div class="meta-line">${badge(k)}</div><div class="card-tools">${repoLink(`${REPO}/tree/main/kits/${k.name}`, `Open ${k.name} on GitHub`)}${saveLink(`k/${k.name}/`, k.name)}</div></div>
<h3><a class="name" href="${up}k/${esc(k.name)}/">${esc(k.name)}</a></h3>
<p class="promise">${esc(k.promise)}</p>
${tagChips(k, up, 3)}
${APP ? `<p class="stat" data-stat="k/${esc(k.name)}/" hidden></p>` : ""}
<div class="card-foot"><span class="muted">${esc(bits)}${bits && latest ? " · " : ""}${latest ? `<span class="nowrap">updated ${esc(latest)}</span>` : ""}</span>${copy}</div>
</li>`;
}

function listingPage(l, all) {
  const d = driftOf(l);
  const related = all.filter((x) => x.url !== l.url && tagsOf(x).some((t) => tagsOf(l).includes(t))).slice(0, 3);
  const commitUrl = `${l.url}/commit/${l.commit}`;
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../">Home</a> / <a href="../../kits/">Kits</a> / ${esc(KIND_LABEL[l.kind] ?? l.kind)}</p>
<h1>${esc(l.name)}</h1>
<p class="meta-line">${l.pick ? '<span class="kind pick">My pick</span>' : '<span class="kind ext">Listed</span>'}<span class="kind">${esc(KIND_LABEL[l.kind] ?? l.kind)}</span>${d.badge}<span>by ${esc(l.author)}, not built by Praxikit</span></p>
<p class="lead">${esc(l.why)}</p>
${tagChips(l, "../../")}
<p class="actions"><a class="btn" href="${esc(l.url)}" rel="noopener noreferrer">View on GitHub</a>${APP ? saveLink(l.url, l.name, true) : ""}</p>
<div class="two listing-two">
<div class="main-col">
${l.pick ? `<section><h2>How I use it</h2><p class="pick-note big">${esc(l.note)}</p><p class="muted">This is one of the owner's picks: a kit made by someone else that they use themselves.</p></section>` : `<section><h2>Why it is listed</h2><p>${esc(sourceWord(l))}. It was scanned automatically and read by a person before it was listed. Listing is not an endorsement.</p></section>`}
<section><h2>What the review covers</h2>
<p>The automatic check reads the repository without running or installing anything and reports its licence, secret-like strings, code that runs automatically, network access, binaries and hidden instructions. A person then reads the report. It never says a kit is safe: read the code before you give it access to anything that matters. <a href="../../policy/">How listings work</a>.</p></section>
${related.length ? `<section><h2>More like this</h2><ul class="cards few-3">${related.map((r) => card(r, "../../")).join("")}</ul></section>` : ""}
</div>
<aside class="side"><div class="panel"><h2>Review receipt</h2>
<dl><dt>Status</dt><dd>${d.warn ? `<strong>${esc(d.short)}</strong>.${d.note}` : "Unchanged since it was read"}</dd>
<dt>Commit read</dt><dd><a href="${esc(commitUrl)}" rel="noopener noreferrer"><code>${esc(l.commit.slice(0, 7))}</code></a></dd>
<dt>Automatic check</dt><dd>${esc(CHECK_WORDS[l.checks] ?? l.checks)}</dd>
<dt>Listed on</dt><dd>${esc(l.added)}</dd>
<dt>Put forward by</dt><dd>${esc(sourceWord(l))}</dd></dl>
<p class="muted">Installs follow the author's latest version, which can differ from the commit that was read. A daily check marks the listing if the repository moves on.</p>
<p class="side-links"><a href="../../policy/#report">Report a problem with this listing</a></p></div></aside>
</div>
${communityBlock(l.url)}</div>`;
  return page({ title: `${l.name} — Praxikit`, depth: 2, body, canonical: `${HOME_URL}${lpath(l)}`, description: l.why,
    ld: { "@context": "https://schema.org", "@type": "SoftwareSourceCode", name: l.name, description: l.why, codeRepository: l.url, author: { "@type": "Person", name: l.author }, url: `${HOME_URL}${lpath(l)}` } });
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
<id>tag:praxikit.com,${date || BUILT}:${esc(k.name)}-${esc(v)}</id>
<title>${esc(k.name)} ${esc(v)}</title>
<updated>${date || BUILT}T00:00:00Z</updated>
<link rel="alternate" href="${esc(HOME_URL)}k/${esc(k.name)}/"/>
<summary type="text">${esc(e.bullets.map((b) => b.replace(/`/g, "")).join("\n"))}</summary>
</entry>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>tag:praxikit.com,2026:releases</id>
<title>Praxikit releases</title>
<subtitle>New versions of Praxikit kits, from their changelogs.</subtitle>
<updated>${updated}</updated>
<link rel="self" href="${esc(HOME_URL)}feed.xml"/>
<link rel="alternate" href="${esc(HOME_URL)}"/>
${items.slice(0, 30).map(entry).join("\n")}
</feed>
`;
}

// ---------- routes: home, kits, kits by type, updates, recommended, submit ----------
const GROUPS = [
  { id: "plugins", label: "Plugins", noun: "plugins", kinds: ["plugin"], blurb: "Bundles that add skills, agents and hooks to Claude Code." },
  { id: "skills", label: "Skills", noun: "skills", kinds: ["skill"], blurb: "One task Claude can run on request." },
  { id: "mcp", label: "MCP configs", noun: "MCP configs", kinds: ["mcp"], blurb: "Ready-made connections to tools and data." },
  { id: "other", label: "Templates and more", noun: "templates, adapters, agents or hooks", kinds: ["template", "adapter", "agent", "hook"], blurb: "Templates, adapters, agents and hooks." },
];
const inGroup = (kits, g) => kits.filter((k) => g.kinds.includes(k.kind));
const listHtml = (list, up) => `<ul class="cards" id="kits-list">${list.map((k) => card(k, up)).join("")}</ul>`;

function typeNav(kits, up, current) {
  const item = (href, label, n, id) => `<a href="${href}"${id === current ? ' aria-current="page"' : ""}>${esc(label)} <span class="count">${n}</span></a>`;
  return `<nav class="typenav" aria-label="Kit types">${item(`${up}kits/`, "All", kits.length, "all")}${GROUPS.map((g) => item(`${up}kits/${g.id}/`, g.label, inGroup(kits, g).length, g.id)).join("")}</nav>`;
}

const recCard = (r, up = "./") => extCard(r, up);
const releaseList = (items, up) => items.map(({ k, e, date, v }) => `<li><div class="feed-meta"><a href="${up}k/${esc(k.name)}/">${esc(k.name)} ${esc(v)}</a>${date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : ""}</div><p>${md(short(e.bullets[0] ?? ""))}</p></li>`).join("");

function homePage(kits, picks) {
  const featured = kits.slice(0, 3);
  const rows = GROUPS.map((g) => { const n = inGroup(kits, g).length; return `<li><a class="type-row" href="kits/${g.id}/"><span><strong>${esc(g.label)}</strong><span class="muted">${esc(g.blurb)}</span></span><span class="count-line">${n ? plural(n, "kit") : "None yet"}</span></a></li>`; }).join("");
  const topTags = sortedTags(collectTags(kits)).slice(0, 10);
  const built = kits.filter((k) => !k.ext).length;
  const dates = kits.map((k) => (k.ext ? k.added : dateOf(k.changelog?.[0]?.head))).filter(Boolean).sort();
  const updated = dates[dates.length - 1] ?? "";

  const body = `
<section class="hero"><div class="wrap hero-in">
<div class="hero-text">
<p class="eyebrow">${SHIELD} Every kit is read by a person before it is listed</p>
<h1>Kits for AI coding agents you can read before you trust.</h1>
<p class="lead">Plugins, skills, MCP configs and templates, each with a version, a changelog and a plain list of what it reads, writes and sends.</p>
<ol class="steps"><li><span class="label">1. Add the marketplace once, in Claude Code</span>${install(["/plugin marketplace add praxikit/praxikit"])}</li>
<li><span class="label">2. Open a kit and copy its install line</span></li></ol>
<p class="actions"><a class="btn" href="kits/">Browse all kits</a><a class="btn ghost" href="submit/">Submit a kit</a></p>
<p class="stats"><span><strong>${kits.length}</strong> ${kits.length === 1 ? "kit" : "kits"}</span><span><strong>${built}</strong> built here</span><span><strong>${picks.length}</strong> ${picks.length === 1 ? "pick" : "picks"}</span>${updated ? `<span>updated <strong>${esc(updated)}</strong></span>` : ""}</p>
</div>
<div class="hero-types"><h2 class="sub">Browse by type</h2><ul class="typelist">${rows}</ul></div>
</div></section>

${topTags.length ? `<section class="wrap sec"><h2>Find a kit for…</h2><ul class="pillrow">${topTags.map(([t, l]) => `<li><a class="pill" href="tags/${esc(t)}/">${esc(t)} <span class="count">${l.length}</span></a></li>`).join("")}<li><a class="pill ghost" href="tags/">All tags</a></li></ul></section>` : ""}

<section class="wrap sec"><div class="sec-head"><h2>Featured kits</h2><a class="viewall" href="kits/">View all ${plural(kits.length, "kit")}</a></div>
${listHtml(featured, "./")}
</section>

<section class="wrap sec"><div class="sec-head"><h2>My picks</h2><a class="viewall" href="picks/">${picks.length ? `View all ${picks.length}` : "About picks"}</a></div>
${picks.length ? `<ul class="cards">${picks.slice(0, 3).map((r) => recCard(r)).join("")}</ul>` : `<p class="muted">Nothing here yet. Picks are kits made by other people that the owner has actually used, each with a note on how.</p>`}</section>

<section class="wrap sec"><h2>Why you can trust what is here</h2>
<ul class="trust">
<li>${SHIELD}<strong>Read, never run</strong><p>The automatic check looks at a repository without running or installing anything. Then a person reads the report before anything is listed.</p></li>
<li>${SHIELD}<strong>Pinned to a commit</strong><p>Every listing records the exact commit that was read, and a daily check tells you when the repository has moved on.</p></li>
<li>${SHIELD}<strong>No pay to list</strong><p>Nothing is listed for payment. Each entry says who made it and who put it forward, and picks say how the owner uses them.</p></li>
</ul></section>

<section class="wrap sec"><div class="submit-band"><div><h2>Built a kit?</h2><p class="muted">Submit it for free. An automatic check reads the repository without running it, then a person reads it before anything is listed.</p></div><a class="btn" href="submit/">Submit a kit</a></div></section>

<section class="wrap sec faq"><h2>Questions</h2>
<details><summary>What happens when I install a kit?</summary><p>Claude Code copies the kit's files and registers its skills, agents and hooks. Each kit page lists the hooks it runs and what it reads, writes and sends, and the source is in the repository it links to.</p></details>
<details><summary>How do updates reach me?</summary><p>Run <code>/plugin marketplace update praxikit</code>, then <code>/reload-plugins</code>. Kits use semantic versions and keep a changelog; the <a href="updates/">updates page</a> shows what changed since the version you have.</p></details>
<details><summary>What do the build checks on a kit page mean?</summary><p>They are computed from the files when the site is built: the manifest is complete, the changelog matches the version, the scripts contain no network code. They show the kit is consistent with what it says about itself, not that it is safe.</p></details>
<details><summary>What is the difference between built, picked and listed?</summary><p><strong>Built</strong> kits are made here. <strong>My picks</strong> are other people's kits the owner actually uses, with a note on how. <strong>Listed</strong> kits were submitted, scanned and read, but are not endorsed.</p></details>
</section>`;
  return page({ title: "Praxikit — kits for AI coding agents you can read before you trust", depth: 0, body, home: true, canonical: HOME_URL, ld: { "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Praxikit", url: HOME_URL, description: "A catalogue of versioned, readable kits for AI coding agents.", potentialAction: { "@type": "SearchAction", target: `${HOME_URL}search/?q={search_term_string}`, "query-input": "required name=search_term_string" } }, { "@type": "Organization", name: "Praxikit", url: HOME_URL, logo: `${HOME_URL}logo.svg`, sameAs: [REPO] }] }, description: "A catalogue of versioned, readable kits for AI coding agents: plugins, skills, MCP configs and templates, each read by a person before it is listed." });
}

function kitsPage(kits, group) {
  const list = group ? inGroup(kits, group) : kits;
  const depth = group ? 2 : 1, up = "../".repeat(depth);
  const title = group ? group.label : "All kits";
  const n = { built: list.filter((k) => !k.ext).length, pick: list.filter((k) => k.ext && k.pick).length, listed: list.filter((k) => k.ext && !k.pick).length };
  const seg = (id, label, count) => (id === "all" || count ? `<button type="button" data-show="${id}" aria-pressed="${id === "all"}">${label} <span class="count">${count ?? list.length}</span></button>` : "");
  const tagOpts = sortedTags(collectTags(list));
  const tagSel = tagOpts.length ? `<label class="sort"><span class="vh">Tag</span><select id="tag"><option value="">All tags</option>${tagOpts.map(([t, l]) => `<option value="${esc(t)}">${esc(t)} (${l.length})</option>`).join("")}</select></label>` : "";
  const search = list.length >= 3 ? `<div class="toolbar">
<label class="search"><span class="vh">Search kits</span><input id="q" type="search" aria-label="Filter these kits" placeholder="Filter these kits" autocomplete="off" spellcheck="false"></label>
<div class="seg" role="group" aria-label="Show">${seg("all", "All")}${seg("built", "Built here", n.built)}${seg("pick", "My picks", n.pick)}${seg("listed", "Listed", n.listed)}</div>
${tagSel}
<label class="sort"><span class="vh">Sort by</span><select id="sort"><option value="featured">Featured first</option><option value="new">Newest</option><option value="az">A to Z</option></select></label>
</div>` : "";
  const empty = group && !list.length ? `<div class="empty"><p><strong>No ${esc(group.noun)} yet.</strong> <a href="${up}submit/">Submit one</a> or <a href="${up}kits/">see all kits</a>.</p></div>` : "";
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="${up}">Home</a> / ${group ? `<a href="${up}kits/">Kits</a> / ${esc(group.label)}` : "Kits"}</p>
<div class="sec-head"><h1>${esc(title)}</h1><p class="muted" id="count" aria-live="polite">${plural(list.length, "kit")}</p></div>
${group ? `<p class="lead">${esc(group.blurb)}</p>` : '<p class="lead">Kits built by Praxikit, plus kits by other people that were submitted and reviewed, each marked as such. Praxikit kits have their own page with what they add, what they read and send, and their changelog.</p>'}
${typeNav(kits, up, group ? group.id : "all")}
${search}
<div id="kits">${list.length ? listHtml(list, up) : ""}</div>
${empty}
<div id="none" hidden class="empty"><p><strong>No kit matches.</strong> <button type="button" class="linklike" id="clear">Clear filters</button></p></div>
</div>`;
  return page({ title: `${title} — Praxikit`, depth, body, current: "kits", canonical: `${HOME_URL}kits/${group ? `${group.id}/` : ""}`, description: group ? `${group.label}: ${group.blurb}` : "All Praxikit kits: plugins, skills, MCP configs and templates." });
}

function updatesPage(kits) {
  const items = releaseFeed(kits).slice(0, 15);
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Updates</p><h1>Updates</h1>
<p class="lead">Check whether you are up to date, and see what changed in each release.</p>
<div class="updates">
<div><h2>Am I up to date?</h2><p class="muted">Pick the version you have to see only what changed since. Or run <code>/keel:status</code>, which prints a link that fills this in.</p>${checker(kits) || '<p class="muted">No versioned kits yet.</p>'}</div>
<div><h2>Latest releases</h2><ul class="feed">${releaseList(items, "../") || '<li class="muted">No releases yet.</li>'}</ul><p><a href="../feed.xml">Subscribe with the release feed</a> (Atom, works in any feed reader).</p></div>
</div></div>`;
  return page({ title: "Updates — Praxikit", depth: 1, body, current: "updates", canonical: `${HOME_URL}updates/`, description: "Check which version of a Praxikit kit you have and what changed since, or subscribe to the release feed." });
}

function picksPage(picks) {
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Picks</p><h1>My picks</h1>
<p class="lead">Kits made by other people that the owner has actually used, each with a note on how. Everything else in the catalogue is just <em>listed</em>: scanned and read by a person, but not necessarily used.</p>
<p class="note">Praxikit did not build these and does not promise they are safe; read the source before installing anything.</p>
${picks.length ? `<ul class="recs">${picks.map((r) => recCard(r, "../")).join("")}</ul>` : `<div class="empty"><p><strong>Nothing here yet.</strong> Picks appear when the owner marks a kit as used. You can <a href="../submit/">suggest a kit</a>; it is listed after the checks and a read-through.</p></div>`}</div>`;
  return page({ title: "My picks — Praxikit", depth: 1, body, current: "picks", canonical: `${HOME_URL}picks/`, description: "Kits by other people that the owner uses, with a note on how." });
}

/** The old address of the picks page: a plain redirect, so links that were shared keep working. */

function submitPage() {
  const form = APP
    ? `<form class="submit-form panel" method="get" action="${esc(APP)}/submit">
<label for="repo">Repository link</label>
<div class="row"><input id="repo" name="url" type="url" required maxlength="200" inputmode="url" autocapitalize="off" placeholder="https://github.com/owner/repo" autocomplete="off"><button class="btn" type="submit">Continue with GitHub</button></div>
<p class="muted">You will sign in with GitHub (only your username is read) and confirm on the next screen. Your link is passed along so you do not paste it twice.</p>
</form>`
    : `<p class="note">Submissions are not open yet.</p>`;
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Submit</p><h1>Submit a kit</h1>
<p class="lead">Free. Paste the link to a public GitHub repository, yours or someone else's. We read its name, owner, licence and README from GitHub, so you do not need to describe it.</p>
${form}
<h2 class="sub">What happens next</h2>
<ol class="flow">
<li><strong>The checks run.</strong> A maintainer asks for the full read-only scan: it reads the public repository at one commit without running or installing anything, and reports licence, secret-like strings, code that runs automatically, network access, binaries and hidden instructions. It reports what it found and never says a kit is safe.</li>
<li><strong>A person reads the report and decides.</strong> The result is a starting point, not a decision. Only GitHub links can be checked automatically.</li>
<li><strong>If it is listed,</strong> the listing is pinned to the commit that person reviewed, and a daily check marks it <em>Changed since review</em> if the repository moves on. It becomes one of the owner's <em>picks</em> only if the owner uses it.</li>
</ol>
<p class="muted">Nothing is listed for payment, and listing is not a promise that a kit is safe. Read the <a href="../policy/">policy</a> for how reports and removals work.</p></div>`;
  return page({ title: "Submit a kit — Praxikit", depth: 1, body, current: "submit", canonical: `${HOME_URL}submit/`, description: "Submit a kit to Praxikit for free: paste a public GitHub repository link. An automatic read-only check runs, then a person reviews it." });
}

function collectionPage(c, kits) {
  const list = kits.filter((k) => k.collections.includes(c));
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../kits/">All kits</a> / Collection</p><h1>${esc(c)}</h1><p class="lead">${plural(list.length, "kit")} in this collection.</p><ul class="cards">${list.map((k) => card(k, "../../")).join("")}</ul></div>`;
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
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../kits/">All kits</a> / ${esc(kindOf(k))}</p>
<h1>${esc(k.name)}</h1>
<p class="meta-line">${badge(k)}${latest ? `<span>released ${esc(latest)}</span>` : ""}<span>${k.collections.map((c) => `<a href="../../c/${slug(c)}/">${esc(c)}</a>`).join(", ")}</span></p>
<p class="lead">${esc(k.promise)}</p>
${tagChips(k, "../../")}
${APP ? `<p class="actions">${saveLink(`k/${k.name}/`, k.name, true)}</p>` : ""}
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
</div>
${communityBlock(`k/${k.name}/`)}</div>`;
  return page({ title: `${k.name} — Praxikit`, depth: 2, body, canonical: `${HOME_URL}k/${k.name}/`, description: k.promise, ld: { "@context": "https://schema.org", "@type": "SoftwareApplication", name: k.name, description: k.promise, softwareVersion: k.version, applicationCategory: "DeveloperApplication", operatingSystem: "Any", isAccessibleForFree: true, url: `${HOME_URL}k/${k.name}/`, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } } });
}

function aboutPage() {
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / About</p><h1>About Praxikit</h1>
<p class="lead">A small, honest catalogue of the skills, plugins and MCP servers worth giving an AI coding agent, each one readable before you install it.</p>
<h2 class="sub">Why it exists</h2>
<p>Kits for coding agents are easy to find and hard to trust. Praxikit started as one person's own collection of the kits they actually use, with a plain list of what each one reads, writes and sends. It stays small on purpose: a catalogue you can read in one sitting beats a directory you have to search.</p>
<h2 class="sub">What you will find here</h2>
<ul><li><strong>Built by Praxikit.</strong> Kits made here, with a version, a changelog and a full account of what they touch.</li>
<li><strong>My picks.</strong> Kits by other people that the owner really uses, each with a note on how.</li>
<li><strong>Listed.</strong> Kits that were submitted, scanned and read by a person. Listing is not an endorsement.</li></ul>
<h2 class="sub">How it is run</h2>
<p>Praxikit is free, open source (MIT) and run by one maintainer, part-time. Nothing is listed for payment and nothing is sold. The checks never run a kit's code. Read the <a href="../policy/">policy</a> for what a listing means, how to report a problem and how removals work, and the <a href="../privacy/">privacy page</a> for what is kept if you sign in.</p>
<h2 class="sub">Get involved</h2>
<p>Built a kit? <a href="../submit/">Submit it</a>. Found a problem? Open an issue in the <a href="${esc(REPO)}/issues" rel="noopener noreferrer">repository</a>. The maintainer is <a href="https://github.com/royal-programmer" rel="noopener noreferrer">@royal-programmer</a> on GitHub.</p></div>`;
  return page({ title: "About — Praxikit", depth: 1, body, canonical: `${HOME_URL}about/`, description: "Why Praxikit exists, what is in it, and how it is run: free, open source and read by a person before anything is listed." });
}

function privacyPage() {
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Privacy</p><h1>Privacy</h1>
<p class="lead">You do not need an account to read anything here. An account is only for submitting a kit or keeping a private collection, and it works through GitHub.</p>
<h2 class="sub">This website</h2>
<p>Reading the site sets no cookies and shows no ads. Cloudflare, which serves it, counts page views with its privacy-first Web Analytics: no cookies, no fingerprinting and no personal profile, only totals such as which pages are read and from which country. Cloudflare keeps its own server logs. If you sign in, the next section applies.</p>
<h2 class="sub">If you sign in</h2>
<p>Signing in happens in a separate app. It asks GitHub for your username only (the <code>read:user</code> permission), does not keep your GitHub access token, and stores your username, your numeric GitHub id, the dates you signed in, your saved kits and group names, and your submissions. It uses one sign-in cookie that lasts a few hours. Nothing is sold or shared, and no page shows your collection to anyone else.</p>
<p>You can download your data and delete your account at any time from <em>My collection</em>. Deleting removes your collection, waiting submissions and account record; decided submissions stay in the catalogue's history without your name. Nothing in the app shows your collection to anyone else. Maintainers see your submissions and your username next to them. The person who runs the app can technically read the database, because that is how a database works; they do not look through collections.</p>
<h2 class="sub">What exactly is kept</h2>
<ul><li>Your GitHub username and numeric id, the date you first signed in and the date you last did.</li><li>The kits you saved and the group names you typed (up to 300 items; up to 40 can be added an hour).</li><li>Your submissions: the repository link, what GitHub says about it, the checks and the maintainers' decision.</li><li>If you press <em>This helped me</em> or write a note: the vote, and the note with your GitHub username. A note is public once a maintainer has shown it; you can delete yours at any time. Only totals are shown for votes and saves.</li><li>One sign-in cookie that lasts a few hours. No advertising or analytics cookies; nothing is sold or shared.</li></ul>
<h2 class="sub">Questions</h2>
<p>Open an issue in the <a href="${esc(REPO)}/issues" rel="noopener noreferrer">repository</a>.</p></div>`;
  return page({ title: "Privacy — Praxikit", depth: 1, body, canonical: `${HOME_URL}privacy/`, description: "What Praxikit keeps about you: nothing on the website; a GitHub username and your collection if you sign in." });
}

function policyPage() {
  const REPORT = ISSUE("report-listing.yml"), PRIVATE = `${REPO}/security/advisories/new`, LOG = `${REPO}/blob/main/docs/removals.md`;
  const ext = (href, text) => `<a href="${esc(href)}" rel="noopener noreferrer">${text}</a>`;
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Policy</p><h1>Listings, reports and removals</h1>
<p class="lead">Praxikit is run by one maintainer, part-time. This page says what a listing means, how to report a problem and what happens next. It describes how the site is run; it is not legal advice.</p>
<div class="prose">
<h2>What a listing means</h2>
<ul>
<li>Kits <strong>built by Praxikit</strong> are ours. We maintain them and ship fixes as new versions.</li>
<li><strong>Listed</strong> kits and <strong>picks</strong> are other people's work. We link to the public repository. We do not host, copy or run it. A <em>pick</em> is a kit the owner has used, with a note on how; a <em>listed</em> kit was scanned and read by a person, and is not necessarily used.</li>
<li>A listing means a person read the repository and the automatic result <strong>at one commit</strong>, which each listing shows. It is not an endorsement and not a safety guarantee. The automatic checks are pattern checks and cannot see everything.</li>
<li><strong>The reviewed commit is not what you install.</strong> Installs come from the author's repository and follow its latest version, so the code you get can be newer than the code that was reviewed. A daily check marks a listing <strong>Changed since review</strong> when its repository has moved on, with a link to what changed. That tells you something changed, not whether it is safe; compare before you install.</li>
<li>Listing is free. Nothing is listed for payment, and payment never changes a check or a decision.</li>
<li>A listing needs a licence that lets others use the work, and the submitter confirms they wrote it or have permission.</li>
<li>We can decline or remove any listing. We try to say why.</li>
</ul>
<h2 id="report">Report a problem</h2>
<ul>
<li><strong>Malicious code or an exposed secret:</strong> use the ${ext(PRIVATE, "private report")}. Please do not post details in a public issue.</li>
<li><strong>Licence or copyright, a misleading description, an abandoned kit, or an author asking for their own work to be removed:</strong> use the ${ext(REPORT, "report form")}.</li>
</ul>
<h2>What we will do</h2>
<ul>
<li>We aim to reply within <strong>3 days</strong>. There is one maintainer and no on-call rota, so this is an aim, not a service level.</li>
<li><strong>Malicious code or an exposed secret:</strong> once we have read the report and it looks real, we remove the listing first and investigate after. We aim to do that the day we read it, and within 2 days of the report.</li>
<li><strong>Everything else:</strong> we read the evidence, may ask the listing's author, then correct or remove the listing. We aim to decide within 14 days.</li>
<li><strong>A removal</strong> takes the entry off the catalogue at the next deploy, a few minutes later. It is recorded in the ${ext(LOG, "public removal log")} with the date, the name, the repository, a reason category and a short note.</li>
</ul>
<h2>Telling people who installed it</h2>
<p>We cannot message them: installs go from the author's repository to the user and do not pass through Praxikit. The removal log is the notice. If you installed something that was later removed, check the log and uninstall it.</p>
<h2>Limits we are open about</h2>
<ul>
<li>There is <strong>one maintainer</strong> and no second person with admin rights yet. One is planned. Until then, if the maintainer is away, reports wait.</li>
<li>For copyright on code hosted elsewhere, also tell the host (GitHub). We will remove our link on a credible request.</li>
<li>Last updated 2026-11-15.</li>
</ul>
</div></div>`;
  return page({ title: "Policy — Praxikit", depth: 1, body, current: "", canonical: `${HOME_URL}policy/`, description: "What a Praxikit listing means, how to report a problem, and how removals work." });
}

function notFoundPage() {
  const body = `<div class="wrap sec page-head"><h1>That page isn't here.</h1><p class="lead">It may have moved when a kit was renamed or removed.</p><form class="search-page" role="search" action="${esc(HOME_URL)}search/" method="get"><label class="vh" for="nf-q">Search the catalogue</label><input id="nf-q" name="q" type="search" placeholder="Search kits, tags and pages" autocomplete="off" maxlength="100"><button class="btn" type="submit">Search</button></form><p><a class="btn" href="${esc(HOME_URL)}">See all kits</a></p></div>`;
  return page({ title: "Not found — Praxikit", depth: 0, body, description: "Page not found." }).replace(/(href|src)="\.\//g, `$1="${HOME_URL}`);
}

// ---------- tags and search ----------
function collectTags(items) {
  const m = new Map();
  for (const it of items) for (const t of new Set(tagsOf(it))) if (SLUG_OK.test(t)) { if (!m.has(t)) m.set(t, []); m.get(t).push(it); }
  return m;
}
const sortedTags = (map) => [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
function tagCloud(map, up) {
  if (!map.size) return "";
  const top = sortedTags(map).slice(0, 16);
  return `<p class="tagcloud"><span class="muted">Browse by tag:</span> ${top.map(([t, l]) => `<a class="tag" href="${up}tags/${esc(t)}/">${esc(t)} <span class="count">${l.length}</span></a>`).join(" ")}${map.size > top.length ? ` <a href="${up}tags/">all ${map.size} tags</a>` : ""}</p>`;
}
function tagsIndexPage(map) {
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Tags</p><h1>Tags</h1><p class="lead">Find a kit by what it is for.</p>
${map.size ? `<ul class="tagindex">${sortedTags(map).map(([t, l]) => `<li><a class="tag" href="${esc(t)}/">${esc(t)}</a> <span class="muted">${plural(l.length, "kit")}</span></li>`).join("")}</ul>` : '<p class="muted">No tags yet.</p>'}</div>`;
  return page({ title: "Tags — Praxikit", depth: 1, body, canonical: `${HOME_URL}tags/`, description: "Browse Praxikit kits by tag." });
}
function tagPage(tag, list) {
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../../">Home</a> / <a href="../">Tags</a> / ${esc(tag)}</p><div class="sec-head"><h1>${esc(tag)}</h1><p class="muted">${plural(list.length, "kit")}</p></div>${listHtml(list, "../../")}</div>`;
  return page({ title: `${tag} — Praxikit`, depth: 2, body, canonical: `${HOME_URL}tags/${tag}/`, description: `Praxikit kits tagged ${tag}.` });
}
function searchPage() {
  const body = `<div class="wrap sec page-head"><p class="crumb"><a href="../">Home</a> / Search</p><h1>Search</h1>
<form role="search" action="./" method="get" class="search-page"><label class="vh" for="search-q">Search kits, picks, skills, tags and pages</label><input id="search-q" name="q" type="search" placeholder="Try planning, marketing, mcp, keel" autocomplete="off" maxlength="100"><button class="btn" type="submit">Search</button></form>
<p class="muted" id="search-status" aria-live="polite"></p>
<ol class="results" id="results"></ol>
<noscript><p class="note">Search needs JavaScript. You can still browse <a href="../kits/">all kits</a> or the <a href="../tags/">tags</a>.</p></noscript></div>`;
  return page({ title: "Search — Praxikit", depth: 1, body, current: "search", canonical: `${HOME_URL}search/`, description: "Search Praxikit kits, picks, skills, tags and pages." });
}
/** One flat list the browser searches. Internal links are relative to the site root; outside links are github.com only. */
function buildSearchIndex(kits, listings, tagMap) {
  const out = [];
  for (const k of kits) {
    out.push({ t: k.name, k: "kit", u: `k/${k.name}/`, d: k.promise, g: tagsOf(k).join(" ") });
    for (const sk of k.adds.skills) out.push({ t: k.kind === "plugin" ? `/${k.name}:${sk.name}` : sk.name, k: "skill", u: `k/${k.name}/`, d: short(sk.description), g: "" });
    for (const ag of k.adds.agents) out.push({ t: ag.name, k: "skill", u: `k/${k.name}/`, d: short(ag.description), g: "" });
  }
  for (const l of listings) out.push({ t: l.name, k: l.pick ? "pick" : "listed", u: l.url, p: lpath(l), ext: 1, d: [l.pick ? `How I use it: ${l.note}` : "", l.why].filter(Boolean).join(" "), g: tagsOf(l).join(" ") });
  for (const [t, l] of sortedTags(tagMap)) out.push({ t: `#${t}`, k: "tag", u: `tags/${t}/`, d: plural(l.length, "kit"), g: t });
  for (const [t, u, d] of [["Kits", "kits/", "Every kit, by type"], ["Updates", "updates/", "Check your version and see what changed"], ["My picks", "picks/", "Kits the owner uses, with a note on how"], ["Submit a kit", "submit/", "Submit a public GitHub repository"], ["About", "about/", "Why Praxikit exists and how it is run"], ["Policy", "policy/", "What a listing means, reports and removals"], ["Privacy", "privacy/", "What is kept about you if you sign in"], ["Tags", "tags/", "Browse by tag"], ["Release feed", "feed.xml", "Subscribe to new versions"]]) out.push({ t, k: "page", u, d, g: "" });
  return out;
}

// ---------- write ----------
const pages = []; // every public page, for the sitemap
const write = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); if (rel.endsWith(".html")) pages.push(rel); writeFileSync(p, text); };

const kits = loadKits();
const listings = loadListings();
assignListingSlugs(listings);
DRIFT = loadDrift();
const picks = listings.filter((l) => l.pick);
// everything that appears in the kit lists: kits built here first, then other people's listings
const items = [...kits, ...listings.map((l) => ({ ...l, ext: true }))];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(join(here, "style.css"), join(OUT, "style.css"));
write("index.html", homePage(items, picks));
write("kits/index.html", kitsPage(items, null));
for (const g of GROUPS) write(`kits/${g.id}/index.html`, kitsPage(items, g));
write("updates/index.html", updatesPage(kits));
write("picks/index.html", picksPage(picks));
write("submit/index.html", submitPage());
write("policy/index.html", policyPage());
write("privacy/index.html", privacyPage());
write("about/index.html", aboutPage());
writeFileSync(join(OUT, "og.png"), ogPng());
const tagMap = collectTags(items);
write("tags/index.html", tagsIndexPage(tagMap));
for (const [t, l] of tagMap) write(`tags/${t}/index.html`, tagPage(t, l));
write("search/index.html", searchPage());
for (const l of listings) write(`${lpath(l)}index.html`, listingPage(l, items));
write("search-index.json", JSON.stringify(buildSearchIndex(kits, listings, tagMap)));
write("404.html", notFoundPage());
write("feed.xml", atomFeed(kits));
for (const c of new Set(kits.flatMap((k) => k.collections))) write(`c/${slug(c)}/index.html`, collectionPage(c, kits));
for (const k of kits) write(`k/${k.name}/index.html`, kitPage(k));
write("logo.svg", LOGO_SVG);
write("versions.json", JSON.stringify(Object.fromEntries(kits.map((k) => [k.name, { version: k.version, kind: k.kind }])), null, 2) + "\n");
write("boot.js", THEME_BOOT);
write("site.js", SITE_JS);
// the frame the app puts its own pages in, so a signed-in page has the same header and footer as the rest of the site
write("app-shell.html", page({ title: "@@TITLE@@", depth: 0, abs: true, body: "<!--@@BODY@@-->", head: "<!--@@HEAD@@-->", description: "Praxikit account" }));
{
  const skip = new Set(["404.html", "app-shell.html", "search/index.html"]);
  const urls = pages.filter((p) => !skip.has(p)).map((p) => HOME_URL + p.replace(/index\.html$/, "")).sort();
  write("sitemap.xml", ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls.map((u) => `<url><loc>${esc(u)}</loc></url>`), "</urlset>", ""].join("\n"));
  write("robots.txt", ["User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /auth/", "Disallow: /api/", "Disallow: /collection", "Disallow: /account/", "Disallow: /profile", "Disallow: /settings", "Disallow: /app-shell.html", `Sitemap: ${HOME_URL}sitemap.xml`, ""].join("\n"));
}
console.log(`built ${kits.length} kit(s), ${listings.length} listing(s) (${picks.length} picks) -> ${OUT}`);
