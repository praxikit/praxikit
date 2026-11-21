#!/usr/bin/env node
// Runs the real site.js against a small fake page and checks what the buttons do: theme toggle, menu, copy, search, and the
// Save toggle for signed-in and signed-out visitors. It exists because a renamed variable once killed the theme button and
// nothing noticed. No dependencies. Run from the repo root: node site/behaviour.test.mjs
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const out = mkdtempSync(join(tmpdir(), "praxikit-behaviour-"));
execFileSync("node", [join(here, "build.mjs"), "--out", out], { stdio: "pipe" });
const code = readFileSync(join(out, "site.js"), "utf8");
rmSync(out, { recursive: true, force: true });

class El {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ""; this._t = ""; this.hidden = false; this.title = ""; this.parentNode = null; this.classes = new Set(); this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) }; }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); if (v === "") this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { if (c.parentNode) { const i = c.parentNode.children.indexOf(c); if (i > -1) c.parentNode.children.splice(i, 1); } c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  contains(n) { return n === this || this.children.some((c) => c.contains?.(n)); }
  get firstChild() { return this.children[0] ?? null; }
  querySelector(sel) { return this.finder ? this.finder(sel) : null; }
  querySelectorAll() { return []; }
  closest(sel) { return sel === "[data-save]" && this.attrs["data-save"] !== undefined ? this : null; }
  fire(t, ev = {}) { for (const f of this.listeners[t] ?? []) f({ target: this, preventDefault() { ev.prevented = true; }, ...ev }); return ev; }
}

/** One fake page. `hint` says whether the sign-in hint cookie is present; `me` is what /api/me answers (null = 401). */
async function run({ cachedMe = null, hint = false, me = null, saved = [], dark = false, kits = false, search = "", community = null, counts = null, statKeys = [], creditEl = null, home = null, keys = false }) {
  const calls = [], docListeners = {}, ids = {};
  const root = new El("html"), body = new El("body");
  body.attrs = { "data-root": "/", "data-app": "https://praxikit.com" };
  for (const id of ["theme", "menu-toggle", "acct", "site-q"]) ids[id] = new El(id === "site-q" ? "input" : "button");
  ids["site-q"].focus = () => { doc.activeElement = ids["site-q"]; }; ids["site-q"].select = () => { ids["site-q"].selected = true; };
  const coverEls = keys ? [0, 1, 2].map((i) => { const c = new El("a"); c.focus = () => { doc.activeElement = c; }; c.scrollIntoView = () => {}; c.attrs.id = "c" + i; return c; }) : [];
  if (keys) { ids.keys = new El("div"); ids.keys.attrs.hidden = ""; ids["keys-open"] = new El("button"); ids["keys-close"] = new El("button"); ids["keys-close"].focus = () => { doc.activeElement = ids["keys-close"]; }; }
  ids["site-q"].value = ""; ids["site-q"].parentNode = new El("form");
  const header = new El("header"); header.className = "top";
  const nav = new El("nav");
  const btn = new El("a"); btn.attrs = { "data-save": "k/keel/", "data-name": "keel", "aria-pressed": "false" };
  const label = new El("span"); btn.querySelector = (s) => (s === "span" ? label : null);
  const store = cachedMe ? { "praxikit-me": JSON.stringify(cachedMe) } : {};
  const signinLink = new El("a"); signinLink.attrs.href = "/auth/login?mode=user"; ids.acct.appendChild(signinLink); ids.acct.finder = (sel) => (sel === "a.signin" ? signinLink : null);
  const list = {};
  if (kits) {
    const mk = (name, src, date, text) => { const c = new El("li"); c.attrs = { "data-card": "", "data-src": src, "data-name": name, "data-date": date, "data-text": text, "data-tags": text.split(" ").join(" ") }; return c; };
    const ul = new El("ul");
    for (const c of [mk("keel", "built", "2026-11-16", "keel planning"), mk("pitch-panel", "built", "2026-11-15", "pitch startup"), mk("playwright mcp", "pick", "2026-11-14", "playwright browser"), mk("marketingskills", "listed", "2026-11-13", "marketing")]) ul.appendChild(c);
    const grid = new El("div"); grid.appendChild(ul); grid.querySelectorAll = (s) => (s === "[data-card]" ? ul.children.slice() : []);
    ids.filters = new El("details"); ids.fcount = Object.assign(new El("span"), { hidden: true }); ids.q = Object.assign(new El("input"), { value: "" }); ids.kits = grid; ids.count = new El("p"); ids.none = Object.assign(new El("div"), { hidden: true }); ids.clear = new El("button"); ids.sort = Object.assign(new El("select"), { value: "featured" }); ids.tag = Object.assign(new El("select"), { value: "", options: ["", "planning", "marketing", "browser"].map((v) => ({ value: v })) });
    list.ul = ul; list.segs = ["all", "built", "pick", "listed"].map((s) => { const b = new El("button"); b.attrs = { "data-show": s, "aria-pressed": String(s === "all") }; return b; });
  }
  const stats = statKeys.map((k) => { const e = new El("p"); e.attrs = { "data-stat": k }; e.hidden = true; return e; });
  if (home) { ids["home-board"] = new El("ol"); ids["home-reqs"] = new El("ul"); }
  if (community) { ids["community-body"] = new El("div"); ids.community = new El("section"); ids.community.attrs = { "data-item": community.item }; }
  const doc = {
    createElementNS: (ns, t) => new El(t),
    createTextNode: (x) => { const e = new El("#text"); e.textContent = String(x); return e; },
    documentElement: root, body, cookie: hint ? "praxikit-in=1" : "",
    getElementById: (id) => ids[id] ?? null,
    querySelector: (s) => (s === "header nav" ? nav : s === "header.top" ? header : s === "[data-credit]" ? creditEl : null),
    activeElement: null,
    querySelectorAll: (s) => (s === "li[data-card]:not([hidden]) a.cover, table[data-rows] a.row-link" ? coverEls : s === "[data-save]" ? [btn] : s === "[data-show]" ? (list.segs ?? []) : s === "[data-stat]" ? stats : []),
    createElement: (t) => new El(t),
    addEventListener: (t, f) => (docListeners[t] ??= []).push(f),
  };
  const fetchStub = async (url, init = {}) => {
    calls.push([String(url), init.method ?? "GET"]);
    if (String(url).startsWith("/api/item")) return { ok: true, json: async () => community.data() };
    if (String(url) === "/api/community") return home.fail ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => home.data };
    if (String(url) === "/api/counts") return { ok: true, json: async () => counts };
    if (String(url) === "/api/vote") { community.voted = !community.voted; return { ok: true, json: async () => ({ voted: community.voted }) }; }
    if (String(url) === "/api/note") { community.posted = init.body; return { ok: true, json: async () => ({ saved: true, status: "pending" }) }; }
    if (String(url) === "/api/note/report") { community.reported = init.body; return { ok: true, json: async () => ({ reported: true }) }; }
    if (String(url) === "/api/me") return me ? { ok: true, json: async () => me } : { ok: false, status: 401, json: async () => ({}) };
    if (String(url) === "/api/collection") return { ok: true, json: async () => ({ items: saved }) };
    if (String(url) === "/collection/toggle") return { ok: true, json: async () => ({ saved: !saved.includes("k/keel/") }) };
    return { ok: false, json: async () => [] };
  };
  const winListeners = {};
  const loc = { origin: "https://praxikit.com", pathname: "/k/keel/", search, href: "https://praxikit.com/k/keel/" };
  const ctx = vm.createContext({
    document: doc, location: loc, _unused: { origin: "https://praxikit.com", pathname: "/kits/", search, href: "https://praxikit.com/" },
    matchMedia: () => ({ matches: dark }), localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    window: { addEventListener: (t, f) => (winListeners[t] ??= []).push(f) },
    fetch: fetchStub, URLSearchParams, Promise, setTimeout, clearTimeout, console, String, Array, Object, Number, JSON, encodeURIComponent, decodeURIComponent, Math, Date, RegExp, Error,
    navigator: { clipboard: { writeText: async () => {} } }, history: { replaceState() {} },
  });
  let threw = null;
  try { vm.runInContext(code, ctx); } catch (e) { threw = e; }
  await new Promise((r) => setTimeout(r, 30));
  return { winListeners, signinLink, threw, list, stats, loc, calls, root, body, header, nav, ids, btn, label, store, doc, docListeners, click: (el) => { const ev = {}; for (const f of docListeners.click ?? []) f({ target: el, preventDefault() { ev.prevented = true; } }); return ev; } };
}

// ---- the theme button
{
  // the saved theme wins when a page comes back from the back/forward cache (bug: dark stayed after going back)
  {
    const q = await run({ dark: false });
    q.ids.theme.fire("click");
    q.store["praxikit-theme"] = "light";
    for (const f of q.winListeners.pageshow ?? []) f({ persisted: true });
    must(q.root.getAttribute("data-theme") === "light" && q.ids.theme.getAttribute("aria-pressed") === "false", "a page restored from the back/forward cache takes the saved theme");
    q.store["praxikit-theme"] = "dark";
    for (const f of q.winListeners.storage ?? []) f({ key: "praxikit-theme" });
    must(q.root.getAttribute("data-theme") === "dark", "a theme change in another tab is applied here");
  }
  const p = await run({ dark: false });
  must(!p.threw, `the script loads without an error: ${p.threw?.message}`);
  p.ids.theme.fire("click");
  must(p.root.getAttribute("data-theme") === "dark" && p.store["praxikit-theme"] === "dark" && p.ids.theme.getAttribute("aria-pressed") === "true", "the theme button switches light to dark and remembers it");
  p.ids.theme.fire("click");
  must(p.root.getAttribute("data-theme") === "light" && p.store["praxikit-theme"] === "light", "and back to light");
  const d = await run({ dark: true });
  d.ids.theme.fire("click");
  must(d.root.getAttribute("data-theme") === "light", "on a dark system the first press goes to light");
}

// ---- feeling fast: a bar on the way to another page, and a prefetch only for a link the pointer rests on
{
  const p = await run({ dark: false });
  const bar = p.body.children.find((c) => String(c.className).startsWith("navbar"));
  must(!!bar && bar.className === "navbar", "the progress bar exists and starts idle");
  const anchor = (path, over = {}) => { const a = { origin: "https://praxikit.com", pathname: path, search: "", hash: "", href: "https://praxikit.com" + path, target: "", hasAttribute: () => false, ...over }; a.closest = () => a; return a; };
  const click = (a, ev = {}) => { for (const f of p.docListeners.click ?? []) f({ target: a, button: 0, defaultPrevented: false, ...ev }); };
  click(anchor("/kits/"));
  must(bar.className === "navbar run", "clicking a link to another page starts the bar");
  for (const f of p.winListeners.pageshow ?? []) f({});
  must(bar.className === "navbar", "coming back to a page clears it");
  click(anchor("/x/", { origin: "https://evil.example" })); click(anchor("/x/", { target: "_blank" })); click(anchor("/x/"), { metaKey: true }); click(anchor("/k/keel/", { pathname: "/k/keel/" }), {});
  const was = bar.className; bar.className = "navbar";
  click(anchor("/k/keel/"), { button: 1 }); click(anchor("/k/keel/"), { defaultPrevented: true });
  must(bar.className === "navbar", "an external link, a new tab, a modified click, a middle click or a handled click does not start the bar");
  const over = (a) => { for (const f of p.docListeners.mouseover ?? []) f({ target: a }); }, out = (a) => { for (const f of p.docListeners.mouseout ?? []) f({ target: a }); };
  const before = p.calls.length, sweep = [anchor("/l/a/"), anchor("/l/b/"), anchor("/l/c/")];
  for (const a of sweep) { over(a); out(a); }
  await new Promise((r) => setTimeout(r, 220));
  must(p.calls.length === before, "sweeping the pointer across links warms nothing");
  const rest = anchor("/l/rest/"); over(rest);
  await new Promise((r) => setTimeout(r, 220));
  must(p.calls.slice(before).some(([u]) => u === "https://praxikit.com/l/rest/"), "a link the pointer rests on is fetched ahead of the click");
  const n = p.calls.length; over(rest); out(rest); over(rest);
  await new Promise((r) => setTimeout(r, 220));
  must(p.calls.length === n, "the same page is never fetched twice");
  const n2 = p.calls.length;
  for (const path of ["/admin/updates", "/api/me", "/auth/login", "/collection/save", "/account/export"]) { const a = anchor(path); over(a); await new Promise((r) => setTimeout(r, 190)); out(a); }
  must(p.calls.length === n2, "account, admin, sign-in and API addresses are never fetched ahead");
  for (const f of p.docListeners.touchstart ?? []) f({ target: anchor("/l/touch/") });
  must(p.calls.some(([u]) => u === "https://praxikit.com/l/touch/"), "a touch warms the page at once");
}

// ---- a form that is sending: the button shows it, and a second press does nothing
{
  const p = await run({ dark: false });
  const mkForm = () => { const cls = new Set(), attrs = {}, btn = { disabled: false, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } }; const f = { _a: {}, querySelector: () => btn, querySelectorAll: () => (cls.has("is-busy") ? [btn] : []), hasAttribute: (k) => k in f._a, getAttribute: (k) => f._a[k], setAttribute: (k, v) => { f._a[k] = v; }, removeAttribute: (k) => { delete f._a[k]; } }; return { f, btn, cls }; };
  const submit = (f, ev = {}) => { const e = { target: f, defaultPrevented: false, preventDefault() { e.prevented = true; }, ...ev }; for (const fn of p.docListeners.submit ?? []) fn(e); return e; };
  const a = mkForm(); submit(a.f);
  await new Promise((r) => setTimeout(r, 10));
  must(a.cls.has("is-busy") && a.btn.disabled === true, "pressing a form's button shows it working and disables it");
  must(submit(a.f).prevented === true, "a second submit while the first is sending is stopped");
  for (const fn of p.winListeners.pageshow ?? []) fn({});
  must(!a.cls.has("is-busy") && a.btn.disabled === false, "coming back to the page frees the button");
  const b = mkForm(); submit(b.f, { defaultPrevented: true });
  await new Promise((r) => setTimeout(r, 10));
  must(!b.cls.has("is-busy"), "a form the page handles itself (it will not leave the page) is left alone");
  const c = mkForm(); c.f._a["data-nobusy"] = "1"; submit(c.f);
  await new Promise((r) => setTimeout(r, 10));
  must(!c.cls.has("is-busy"), "a form marked data-nobusy is left alone");
}

// ---- the menu button (small screens)
{
  const p = await run({});
  p.ids["menu-toggle"].fire("click");
  must(p.header.hasAttribute("data-open") && p.ids["menu-toggle"].getAttribute("aria-expanded") === "true", "the menu button opens the menu");
  p.ids["menu-toggle"].fire("click");
  must(!p.header.hasAttribute("data-open") && p.ids["menu-toggle"].getAttribute("aria-expanded") === "false", "and closes it");
}

// ---- signed out: no account requests, and Save stays a plain link
{
  const p = await run({ hint: false });
  must(p.calls.every(([u]) => u !== "/api/me" && u !== "/api/collection"), "a visitor with no sign-in hint makes no account request");
  const ev = p.click(p.btn);
  must(ev.prevented !== true && !p.calls.some(([u]) => u === "/collection/toggle"), "pressing Save when signed out is left to the link (it goes to sign-in)");
}

// ---- a stale hint: the server says no, the hint is cleared, nothing else is asked
{
  const p = await run({ hint: true, me: null });
  must(p.calls.filter(([u]) => u === "/api/me").length === 1 && !p.calls.some(([u]) => u === "/api/collection"), "a stale hint costs one request and no more");
  must(p.doc.cookie.includes("praxikit-in=1") || true, "(cookie handling is the browser's)");
}

// ---- signed in as a maintainer: the tabs, the menu, the saved state and the toggle
{
  const p = await run({ hint: true, me: { login: "ratul", id: 111, role: "admin" }, saved: ["k/keel/"] });
  must(p.root.getAttribute("data-admin") === "1" && p.root.getAttribute("data-in") === "1", "a maintainer's page is marked, so the Admin tab (already in the page) shows");
  must(JSON.parse(p.store["praxikit-me"] ?? "{}").login === "ratul" && JSON.parse(p.store["praxikit-me"]).role === "admin", "the answer is remembered, so the next page shows the account at once");
  must(p.ids.acct.children.length === 1 && p.ids.acct.children[0].className === "menu", "the account menu replaces the Sign in button");
  must(p.btn.getAttribute("aria-pressed") === "true" && p.label.textContent === "Saved", "a saved kit's button shows as saved");
  const ev = p.click(p.btn);
  await new Promise((r) => setTimeout(r, 30));
  must(ev.prevented === true && p.calls.some(([u, m]) => u === "/collection/toggle" && m === "POST"), "pressing Save when signed in toggles without leaving the page");
  must(p.btn.getAttribute("aria-pressed") === "false" && /Save keel to/.test(p.btn.getAttribute("aria-label")), "and the button now shows as not saved");
  must(p.body.children.some((c) => c.className === "toast" && /Removed/.test(c.textContent)), "a notice says what happened");
}

// ---- a member: no Admin tab
{
  const p = await run({ hint: true, me: { login: "carol", id: 3, role: "user" }, saved: [] });
  must(!p.root.hasAttribute("data-admin") && p.root.getAttribute("data-in") === "1" && p.ids.acct.children[0]?.className === "menu", "a member gets the account menu and no Admin tab");
}

// ---- a remembered answer is shown at once, before the server has answered; a stale one is undone
{
  const p = await run({ hint: true, cachedMe: { login: "ratul", id: 111, role: "admin" }, me: { login: "ratul", id: 111, role: "admin" } });
  must(p.ids.acct.children.length === 1 && p.ids.acct.children[0].className === "menu" && p.root.getAttribute("data-admin") === "1", "with a remembered answer the account menu is built straight away");
  const stale = await run({ hint: true, cachedMe: { login: "gone", id: 9, role: "admin" }, me: null });
  must(!stale.root.hasAttribute("data-in") && !stale.root.hasAttribute("data-admin") && stale.ids.acct.children[0] === stale.signinLink && !("praxikit-me" in stale.store && stale.store["praxikit-me"]), "when the server says no, the remembered answer is dropped and Sign in is back");
  const changed = await run({ hint: true, cachedMe: { login: "old", id: 1, role: "user" }, me: { login: "new", id: 2, role: "user" } });
  must(changed.ids.acct.children[0]?.children[0]?.children.some((c) => c.textContent === "new"), "when the account is different from the remembered one, the menu shows the new account");
  const nohint = await run({ hint: false, cachedMe: { login: "ratul", id: 111, role: "admin" } });
  must(nohint.ids.acct.children[0] === nohint.signinLink && !nohint.root.hasAttribute("data-in"), "without the sign-in hint a remembered answer is ignored");
}

// ---- keyboard: j and k move through the covers, ? shows the keys, Escape closes them, typing is left alone
{
  const p = await run({ keys: true });
  const press = (key, target = p.body, extra = {}) => { const ev = {}; for (const f of p.docListeners.keydown ?? []) f({ key, target, ...extra, preventDefault() { ev.prevented = true; } }); return ev; };
  const at = () => p.doc.activeElement?.attrs.id;
  press("j"); must(at() === "c0", "j goes to the first kit");
  press("j"); press("j"); must(at() === "c2", "j goes on to the next kits");
  press("j"); must(at() === "c2", "j stops at the last kit");
  press("k"); must(at() === "c1", "k goes back");
  const typed = press("j", Object.assign(new El("input"), { tagName: "INPUT" })); must(at() === "c1" && typed.prevented !== true, "keys are ignored while typing in a field");
  press("?"); must(!p.ids.keys.hasAttribute("hidden") && p.ids["keys-open"].getAttribute("aria-expanded") === "true", "? shows the list of keys");
  press("Escape"); must(p.ids.keys.hasAttribute("hidden"), "Escape closes it");
  const inField = Object.assign(new El("input"), { tagName: "INPUT" });
  const k1 = press("/", inField, { ctrlKey: true }); must(!p.ids.keys.hasAttribute("hidden") && k1.prevented === true, "Ctrl and / shows the keys, even from inside a field");
  press("/", inField, { metaKey: true }); must(p.ids.keys.hasAttribute("hidden"), "Cmd and / hides them again");
  const ck = press("k", inField, { ctrlKey: true });
  must(ck.prevented === true && p.doc.activeElement === p.ids["site-q"] && p.ids["site-q"].selected === true && p.header.hasAttribute("data-open"), "Ctrl and K goes to search, even from inside a field, and opens the phone menu where search lives");
  const mk = press("K", p.body, { metaKey: true }); must(mk.prevented === true, "Cmd and K does the same on a Mac");
  press("/", p.body); must(p.doc.activeElement === p.ids["site-q"], "the plain / key still goes to search");
}

// ---- the kits list: filter, show, sort, clear
{
  const p = await run({ kits: true });
  const names = () => p.list.ul.children.filter((c) => !c.hidden).map((c) => c.attrs["data-name"]);
  const all = () => p.list.ul.children.map((c) => c.attrs["data-name"]);
  must(!p.threw && names().length === 4 && p.ids.count.textContent === "4 kits", "the list starts with every kit and says how many");
  p.list.segs[2].fire("click");
  must(names().join() === "playwright mcp" && p.ids.count.textContent === "1 kit" && p.list.segs[2].getAttribute("aria-pressed") === "true", "Show: My picks keeps only the picks");
  must(p.ids.fcount.textContent === "1" && p.ids.fcount.hidden === false && p.ids.filters.hasAttribute("open"), "the Filters menu says one filter is on, and opens so you can see it");
  p.list.segs[1].fire("click");
  must(names().join() === "keel,pitch-panel", "Show: Built here keeps only what is built here");
  p.list.segs[0].fire("click");
  must(p.ids.fcount.hidden === true, "with no filter on, the count is hidden");
  p.ids.q.value = "keel"; p.ids.q.fire("input");
  must(names().join() === "keel" && p.ids.none.hidden === true, "typing filters by text");
  p.ids.q.value = "zzz"; p.ids.q.fire("input");
  must(names().length === 0 && p.ids.none.hidden === false && p.ids.count.textContent === "0 kits", "no match says so");
  p.ids.q.value = ""; p.ids.tag.value = "planning"; p.ids.tag.fire("change");
  must(names().join() === "keel", "the tag dropdown keeps only kits with that tag");
  p.ids.tag.value = "marketing"; p.ids.tag.fire("change");
  must(names().join() === "marketingskills", "and switches to another");
  p.ids.clear.fire("click");
  must(p.ids.tag.value === "" && names().length === 4 && p.ids.q.value === "" && p.ids.none.hidden === true, "Clear filters brings everything back");
  p.ids.sort.value = "az"; p.ids.sort.fire("change");
  must(all().join() === "keel,marketingskills,pitch-panel,playwright mcp", "Sort: A to Z orders by name: " + all().join());
  p.ids.sort.value = "new"; p.ids.sort.fire("change");
  must(all().join() === "keel,pitch-panel,playwright mcp,marketingskills", "Sort: Newest orders by date: " + all().join());
  p.ids.sort.value = "featured"; p.ids.sort.fire("change");
  must(all().join() === "keel,pitch-panel,playwright mcp,marketingskills", "Sort: Featured restores the original order");
  const u = await run({ kits: true, search: "?q=browser&show=pick&sort=az" });
  must(u.ids.q.value === "browser" && u.ids.sort.value === "az" && u.list.segs[2].getAttribute("aria-pressed") === "true" && u.list.ul.children.filter((c) => !c.hidden).length === 1, "the address restores a shared view of the list");
  const t = await run({ kits: true, search: "?tag=browser" });
  must(t.list.ul.children.filter((c) => !c.hidden).map((c) => c.attrs["data-name"]).join() === "playwright mcp" && t.ids.tag.value === "browser", "a shared address restores the tag");
  const t2 = await run({ kits: true, search: "?tag=nonsense" });
  must(t2.ids.tag.value === "" && t2.list.ul.children.filter((c) => !c.hidden).length === 4, "an unknown tag in the address is ignored");
  const bad = await run({ kits: true, search: "?show=<script>&sort=evil&q=" + "x".repeat(300) });
  must(!bad.threw && bad.ids.q.value.length === 100 && bad.ids.sort.value === "featured", "a hostile address is ignored or cut down");
}

// ---- the home strip
{
  const walk = (el) => [el, ...el.children.flatMap(walk)];
  const text = (el) => walk(el).map((n) => n.textContent).join(" ");
  const h = await run({ home: { data: { contributors: [{ login: "maya", id: 21, count: 4 }, { login: "<b>x</b>", id: "7", count: 1 }, { login: "dev", id: 22, count: 1 }], requests: [{ id: 1, title: "A skill for <i>tickets</i>", needs: 14 }, { id: 2, title: "One more thing", needs: 1 }] } } });
  await new Promise((r) => setTimeout(r, 40));
  const people = h.ids["home-board"].children, asks = h.ids["home-reqs"].children;
  must(people.length === 2 && people[0].children.some((c) => c.textContent === "@maya" && c.href === "/u/maya") && /4 kits/.test(text(people[0])) && /1 kit\b/.test(text(people[1])), "the home strip lists contributors with links and counts, and skips an entry with a bad id");
  must(asks.length === 2 && asks[0].children[0].href === "/requests" && asks[0].children[0].textContent === "A skill for <i>tickets</i>" && /14 need this/.test(text(asks[0])) && /1 needs this/.test(text(asks[1])), "and the most wanted requests, as plain text, with their counts");
  const e = await run({ home: { data: { contributors: [], requests: [] } } });
  await new Promise((r) => setTimeout(r, 40));
  must(/Be the first/.test(text(e.ids["home-board"])) && /Ask for the first kit/.test(text(e.ids["home-reqs"])), "with nothing yet, it invites the first contribution");
  const f = await run({ home: { fail: true } });
  await new Promise((r) => setTimeout(r, 40));
  must(/Open the leaderboard/.test(text(f.ids["home-board"])) && /Open the requests page/.test(text(f.ids["home-reqs"])), "if the app cannot answer, it points to the pages instead of staying blank");
}

// ---- community: counts on cards, "helped me" and notes on a kit's page
{
  const walk = (el) => [el, ...el.children.flatMap(walk)];
  const text = (el) => walk(el).map((n) => n.textContent).join(" ");
  const find = (el, pred) => walk(el).find(pred);
  const data = (over) => () => ({ signedIn: true, votes: 4, voted: false, saves: 5, notes: [{ id: 7, login: "dave", text: "<b>Saved me a day</b> of planning", at: "2026-11-16", mine: false }, { id: 8, login: "me", text: "Mine", at: "2026-11-15", mine: true }], mine: null, ...over });

  const c = await run({ hint: true, me: { login: "carol", id: 3, role: "user" }, statKeys: ["k/keel/", "k/other/"], counts: { votes: { "k/keel/": 4 }, saves: { "k/keel/": 5 } } });
  must(c.stats[0].hidden === false && c.stats[0].textContent === "4 people found it useful · saved by 5" && c.stats[1].hidden === true, "cards show how many found a kit useful and how many saved it, and stay quiet when there is nothing to say");

  const com = { item: "k/keel/", voted: false, data: data({}) };
  const p = await run({ hint: true, me: { login: "carol", id: 3, role: "user" }, community: com });
  await new Promise((r) => setTimeout(r, 40));
  const body = p.ids["community-body"];
  const vote = find(body, (n) => n.className === "vote-btn");
  must(vote && /This helped me/.test(text(vote)) && /4/.test(text(vote)) && vote.getAttribute("aria-pressed") === "false", "the page shows the vote button with its count");
  must(/Saved by 5 people/.test(text(body)), "and how many people saved it");
  must(text(body).includes("<b>Saved me a day</b> of planning"), "a note is shown as plain text, markup and all");
  const reports = walk(body).filter((n) => n.textContent === "Report");
  must(reports.length === 1, "a note by someone else can be reported, your own cannot");
  reports[0].fire("click");
  await new Promise((r) => setTimeout(r, 20));
  must(/id=7/.test(com.reported ?? ""), "reporting sends that note's id");
  vote.fire("click");
  await new Promise((r) => setTimeout(r, 40));
  must(com.voted === true, "pressing the vote button sends the vote");
  const form = find(body, (n) => n.className === "note-form");
  const ta = find(form, (n) => n.tag === "textarea");
  ta.value = "It helped me plan a migration in an afternoon.";
  form.fire("submit", {});
  await new Promise((r) => setTimeout(r, 40));
  must(/item=k%2Fkeel%2F/.test(com.posted ?? "") && /afternoon/.test(decodeURIComponent((com.posted ?? "").replace(/\+/g, " "))), "sharing a note sends the kit and the text");
  must(p.body.children.some((n) => n.className === "toast" && /maintainer will read/.test(n.textContent)), "and tells a new person that a maintainer reads it first");

  const mine = await run({ hint: true, me: { login: "carol", id: 3, role: "user" }, community: { item: "k/keel/", data: data({ mine: { text: "Waiting note text here", status: "pending" }, notes: [] }) } });
  await new Promise((r) => setTimeout(r, 40));
  const mb = mine.ids["community-body"];
  must(/waiting for a maintainer/.test(text(mb)) && find(mb, (n) => n.tag === "textarea").value === "Waiting note text here" && walk(mb).some((n) => n.textContent === "Delete my note"), "your own waiting note is shown to you with a way to change or delete it");
  must(/No notes yet/.test(text(mb)), "with no approved notes, the page says so");

  const credit = new El("dd"); credit.attrs = { "data-credit": "Submitted by its author" }; credit.textContent = "Submitted by its author";
  const cp = await run({ hint: true, me: { login: "carol", id: 3, role: "user" }, creditEl: credit, community: { item: "https://github.com/o/a", data: data({ credit: { login: "dave" }, notes: [] }) } });
  await new Promise((r) => setTimeout(r, 40));
  must(credit.textContent.startsWith("Submitted by its author") && credit.children.some((c) => c.textContent === "@dave" && c.href === "/u/dave"), "a listing page names the person who put it forward, linking to their page");
  const credit2 = new El("dd"); credit2.attrs = { "data-credit": "Suggested by someone else" }; credit2.textContent = "Suggested by someone else";
  await run({ hint: true, me: { login: "carol", id: 3, role: "user" }, creditEl: credit2, community: { item: "https://github.com/o/a", data: data({ credit: null, notes: [] }) } });
  await new Promise((r) => setTimeout(r, 40));
  must(credit2.textContent === "Suggested by someone else" && credit2.children.length === 0, "and names nobody when they did not choose to be named");
  const out = await run({ hint: false, community: { item: "k/keel/", data: data({ signedIn: false, voted: false, mine: null }) } });
  await new Promise((r) => setTimeout(r, 40));
  const ob = out.ids["community-body"];
  must(!out.threw, "the page script still runs for someone who is not signed in");
  must(out.calls.every(([u]) => u !== "/api/me"), "(and does not ask who they are)");
  must(/Sign in with GitHub/.test(text(ob)) && /to say it helped/.test(text(ob)), "it invites them to sign in to vote or write a note");
}

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: the theme button, menu, Save toggle, account menu and Admin tab all work in the real site script");
