#!/usr/bin/env node
// One address for the site and the app: pages are served as static files with strict headers, the app's own pages sit inside
// the site's frame, www goes to the main address, and nothing crosses between the two. The real site is built for this test.
// Run from the repo root: node --no-warnings api/test-site.mjs
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

// ---- build the real site the way the Worker does
const out = mkdtempSync(join(tmpdir(), "praxikit-app-site-"));
execFileSync("node", [join(here, "..", "site", "build.mjs"), "--config", join(here, "..", "site", "config.worker.json"), "--out", out], { stdio: "pipe" });
const TYPES = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", json: "application/json", xml: "application/xml", txt: "text/plain", svg: "image/svg+xml" };
const ASSETS = {
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    let f = join(out, p);
    if (p.endsWith("/")) f = join(f, "index.html");
    if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) return new Response(readFileSync(join(out, "404.html")), { status: 404, headers: { "Content-Type": TYPES.html } });
    return new Response(readFileSync(f), { status: 200, headers: { "Content-Type": TYPES[f.split(".").pop()] ?? "application/octet-stream" } });
  },
};

const raw = new DatabaseSync(":memory:");
raw.exec(readFileSync(join(here, "schema.sql"), "utf8"));
const D1 = { prepare(sql) { const st = raw.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }; return api; } };
const SECRET = "s".repeat(40);
const env = { BASE_URL: "https://praxikit.com", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, SITE_URL: "https://praxikit.com/", DB: D1, ASSETS };
globalThis.fetch = async () => new Response("{}", { status: 404 });

const call = (path, { method = "GET", cookies = {}, origin, form, host = "https://praxikit.com" } = {}) => {
  const headers = new Headers();
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`${host}${path}`, init), env);
};
const sess = (over) => signToken({ sub: "carol", id: 3, role: "user", via: "", iat: Date.now(), exp: Date.now() + 3600000, ...over }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const carol = await sess({}), admin = await sess({ sub: "ratul", id: 111, role: "admin", via: "owner" });

// ---- the site is served as it is built, with strict headers
let r = await call("/");
let html = await r.text();
must(r.status === 200 && html.includes("<title>") && html.includes('data-app="https://praxikit.com"') && html.includes('id="acct"'), "the home page is the built site, with the account slot");
const csp = r.headers.get("Content-Security-Policy") ?? "";
must(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe-inline") && !csp.includes("unsafe-eval") && r.headers.get("X-Content-Type-Options") === "nosniff" && (r.headers.get("Strict-Transport-Security") ?? "").includes("max-age"), `static pages carry strict headers: ${csp}`);
must(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), "no inline script is left on any page");
for (const p of ["/kits/", "/k/keel/", "/tags/", "/search/", "/submit/", "/privacy/", "/policy/", "/updates/", "/picks/"]) {
  const x = await call(p);
  must(x.status === 200 && (await x.text()).includes("<header"), `${p} is the site's page`);
  must(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(await (await call(p)).text()), `${p} has no inline script`);
}
for (const p of ["/site.js", "/boot.js", "/style.css", "/search-index.json", "/versions.json", "/feed.xml", "/sitemap.xml", "/robots.txt", "/logo.svg"]) must((await call(p)).status === 200, `${p} is served`);
must((await (await call("/robots.txt")).text()).includes("Disallow: /admin") && (await (await call("/sitemap.xml")).text()).includes("https://praxikit.com/kits/"), "robots and the sitemap use the real address");
must(!(await (await call("/sitemap.xml")).text()).includes("/admin") && !(await (await call("/sitemap.xml")).text()).includes("app-shell"), "the sitemap lists no account or admin pages");
r = await call("/nothing-here/");
must(r.status === 404 && (await r.text()).includes("<header"), "an unknown page is the site's 404");
must((await call("/submit")).status === 200 && (await (await call("/submit")).text()).includes("Sign in"), "/submit is the app's form (the sign-in page when signed out), /submit/ the site's page");

// ---- www and the old workers.dev style names
r = await call("/kits/?x=1", { host: "https://www.praxikit.com" });
must(r.status === 301 && r.headers.get("Location") === "https://praxikit.com/kits/?x=1", "www goes to the main address");

// ---- the app's pages are inside the site's frame
r = await call("/profile", { cookies: carol });
html = await r.text();
must(r.status === 200 && html.includes("<header") && html.includes('class="brand"') && html.includes("<footer") && html.includes("Profile — Praxikit") && !html.includes("@@TITLE@@") && !html.includes("@@BODY@@") && !html.includes("@@HEAD@@"), "the profile uses the site's header and footer, with the title filled in");
must(html.includes("@carol") && html.includes('href="/assets/app.css?v=') && html.includes('content="noindex,nofollow"') && html.includes('data-root="/"'), "the profile shows the person, loads the app styles, is not indexed and links from the root");
must(!html.includes('href="./') && !html.includes('href="../'), "no relative links on an app page (they would break on /admin/submissions/5)");
must(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), "app pages carry no inline script");
const css = await call("/assets/app.css");
must(css.status === 200 && (css.headers.get("Content-Type") ?? "").includes("text/css") && (await css.text()).includes(".app "), "the app's styles are served and scoped to .app");
r = await call("/admin");
must(r.status === 200 && (await r.text()).includes("Sign in") && (await call("/admin")).headers.get("Content-Security-Policy").includes("default-src 'none'"), "signed out, /admin is the sign-in page inside the frame, with the app's strict policy");
r = await call("/admin", { cookies: carol });
must((await r.text()).includes("sign in again with organisation access"), "a member who is a maintainer is told how to get admin access");
r = await call("/admin", { cookies: admin });
html = await r.text();
must(r.status === 200 && html.includes("Catalogue admin") && html.includes("Manage live listings"), "a maintainer sees the admin page");
must((await call("/api/me", { cookies: admin })).status === 200 && (await (await call("/api/me", { cookies: admin })).json()).role === "admin" && (await (await call("/api/me", { cookies: carol })).json()).role === "user" && (await call("/api/me")).status === 401, "the header learns the role from /api/me; signed out it gets 401");
must((await call("/settings", { cookies: carol })).status === 200 && (await (await call("/settings")).text()).includes("Sign in"), "settings needs a sign-in");
r = await call("/mine?ok=1", { cookies: carol });
must(r.status === 302 && r.headers.get("Location") === "/profile?ok=1", "the old /mine address goes to the profile");
r = await call("/auth/logout", { method: "POST", cookies: carol, origin: "https://praxikit.com" });
must(r.status === 302 && r.headers.get("Location") === "/", "signing out returns to the home page");

// ---- the site script's account code only acts where the app lives, and builds with text nodes
const js = readFileSync(join(out, "site.js"), "utf8");
must(js.includes('data-app') && js.includes("location.origin === appOrigin") && js.includes("textContent") && !js.includes("innerHTML") && !js.includes("document.write") && !js.includes("eval("), "the account code compares origins and never uses innerHTML or eval");
must(js.includes('"/admin"') && js.includes("nav.insertBefore(a, nav.firstChild)") && js.includes('me.role === "admin"'), "the Admin tab is added first in the nav, only for the admin role");

// ---- the mirror for the old address: pages redirect, versions and the feed stay real
const mirror = mkdtempSync(join(tmpdir(), "praxikit-mirror-"));
execFileSync("node", [join(here, "..", "site", "build.mjs"), "--config", join(here, "..", "site", "config.worker.json"), "--out", mirror, "--mirror", "https://praxikit.com"], { stdio: "pipe" });
const stub = readFileSync(join(mirror, "k", "keel", "index.html"), "utf8");
must(stub.includes('http-equiv="refresh"') && stub.includes("https://praxikit.com/k/keel/") && stub.includes('rel="canonical"') && !stub.includes("<header"), "a mirrored page redirects to the same page on the new address");
must(readFileSync(join(mirror, "versions.json"), "utf8").includes("keel") && readFileSync(join(mirror, "feed.xml"), "utf8").includes("<feed") && !existsSync(join(mirror, "app-shell.html")), "versions.json and the feed stay real; the app frame is not published");
must(readFileSync(join(mirror, "404.html"), "utf8").includes("https://praxikit.com/"), "unknown old addresses land on the new home page");

rmSync(out, { recursive: true, force: true }); rmSync(mirror, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: the site and the app share one address: static pages with strict headers, app pages in the site's frame, www redirects, an admin tab driven by /api/me, and a redirecting mirror for the old address");
