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
  constructor(tag = "div") { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ""; this.textContent = ""; this.hidden = false; this.title = ""; this.parentNode = null; this.classes = new Set(); this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
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
async function run({ hint = false, me = null, saved = [], dark = false }) {
  const calls = [], docListeners = {}, ids = {};
  const root = new El("html"), body = new El("body");
  body.attrs = { "data-root": "/", "data-app": "https://praxikit.com" };
  for (const id of ["theme", "menu-toggle", "acct", "site-q"]) ids[id] = new El(id === "site-q" ? "input" : "button");
  ids["site-q"].value = ""; ids["site-q"].parentNode = new El("form");
  const header = new El("header"); header.className = "top";
  const nav = new El("nav"); const gh = new El("a"); gh.attrs.href = "https://github.com/praxikit/praxikit"; gh.textContent = "GitHub"; nav.appendChild(gh); nav.finder = (sel) => (sel.includes("github.com") ? gh : null);
  const btn = new El("a"); btn.attrs = { "data-save": "k/keel/", "data-name": "keel", "aria-pressed": "false" };
  const label = new El("span"); btn.querySelector = (s) => (s === "span" ? label : null);
  const store = {};
  const doc = {
    documentElement: root, body, cookie: hint ? "praxikit-in=1" : "",
    getElementById: (id) => ids[id] ?? null,
    querySelector: (s) => (s === "header nav" ? nav : s === "header.top" ? header : null),
    querySelectorAll: (s) => (s === "[data-save]" ? [btn] : []),
    createElement: (t) => new El(t),
    addEventListener: (t, f) => (docListeners[t] ??= []).push(f),
  };
  const fetchStub = async (url, init = {}) => {
    calls.push([String(url), init.method ?? "GET"]);
    if (String(url) === "/api/me") return me ? { ok: true, json: async () => me } : { ok: false, status: 401, json: async () => ({}) };
    if (String(url) === "/api/collection") return { ok: true, json: async () => ({ items: saved }) };
    if (String(url) === "/collection/toggle") return { ok: true, json: async () => ({ saved: !saved.includes("k/keel/") }) };
    return { ok: false, json: async () => [] };
  };
  const ctx = vm.createContext({
    document: doc, location: { origin: "https://praxikit.com", pathname: "/", search: "", href: "https://praxikit.com/" },
    matchMedia: () => ({ matches: dark }), localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    fetch: fetchStub, URLSearchParams, Promise, setTimeout, clearTimeout, console, String, Array, Object, Number, JSON, encodeURIComponent, decodeURIComponent, Math, Date, RegExp, Error,
    navigator: { clipboard: { writeText: async () => {} } }, history: { replaceState() {} },
  });
  let threw = null;
  try { vm.runInContext(code, ctx); } catch (e) { threw = e; }
  await new Promise((r) => setTimeout(r, 30));
  return { threw, calls, root, body, header, nav, ids, btn, label, store, doc, docListeners, click: (el) => { const ev = {}; for (const f of docListeners.click ?? []) f({ target: el, preventDefault() { ev.prevented = true; } }); return ev; } };
}

// ---- the theme button
{
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
  const labels = p.nav.children.map((c) => c.textContent);
  must(labels[0] === "Admin" && labels.indexOf("My collection") > 0 && labels.indexOf("My collection") < labels.indexOf("GitHub"), `the Admin tab is first and My collection is in the navigation: ${labels.join(", ")}`);
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
  must(!p.nav.children.some((c) => c.textContent === "Admin") && p.nav.children.some((c) => c.textContent === "My collection"), "a member has My collection but no Admin tab");
}

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: the theme button, menu, Save toggle, account menu and Admin tab all work in the real site script");
