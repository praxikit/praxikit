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
execFileSync("node", [join(here, "..", "site", "build.mjs"), "--out", out], { stdio: "pipe" });
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

const js0 = () => readFileSync(join(out, "site.js"), "utf8");
// ---- the site is served as it is built, with strict headers
let r = await call("/");
let html = await r.text();
must(r.status === 200 && html.includes("<title>") && html.includes('data-app="https://praxikit.com"') && html.includes('id="acct"'), "the home page is the built site, with the account slot");
const csp = r.headers.get("Content-Security-Policy") ?? "";
must(csp.includes("font-src 'self'") && !/font-src[^;]*(https?:|\*)/.test(csp) && (await call("/admin")).headers.get("Content-Security-Policy").includes("font-src 'self'"), "the heading font may come from this site only (static pages and app pages alike)");
must(csp.includes("script-src 'self' https://static.cloudflareinsights.com;") && csp.includes("connect-src 'self' https://cloudflareinsights.com;") && !csp.includes("*"), `the policy allows Cloudflare's cookie-less analytics and no other outside host: ${csp}`);
must(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe-inline") && !csp.includes("unsafe-eval") && r.headers.get("X-Content-Type-Options") === "nosniff" && (r.headers.get("Strict-Transport-Security") ?? "").includes("max-age"), `static pages carry strict headers: ${csp}`);
must(!/<script(?![^>]*(?:\ssrc=|ld\+json))[^>]*>/i.test(html), "no inline script is left on any page");
must(html.includes('defer data-site>'), "the site script is deferred so it never blocks the first paint");
for (const p of ["/kits/", "/k/keel/", "/tags/", "/search/", "/submit/", "/privacy/", "/policy/", "/about/"]) {
  const x = await call(p);
  must(x.status === 200 && (await x.text()).includes("<header"), `${p} is the site's page`);
  must(!/<script(?![^>]*(?:\ssrc=|ld\+json))[^>]*>/i.test(await (await call(p)).text()), `${p} has no inline script`);
}
must((await (await call("/.well-known/security.txt")).text()).includes("Contact: https://github.com/praxikit/praxikit/security/advisories/new"), "security.txt is served from the standard address");
must(r.headers.get("Cross-Origin-Opener-Policy") === "same-origin", "site pages carry the same opener policy as the app");
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
must(!/<script(?![^>]*(?:\ssrc=|ld\+json))[^>]*>/i.test(html), "app pages carry no inline script");
const css = await call("/assets/app.css");
must(css.status === 200 && (css.headers.get("Content-Type") ?? "").includes("text/css"), "the app's styles are served as CSS");
{
  const appCss = await (await call("/assets/app.css")).text();
  must(appCss.startsWith("@layer tokens, base, site, app;") && appCss.includes("@layer app {") && appCss.includes(".app "), "the app's styles are scoped to .app and are the last cascade layer, after the site's three");
}
r = await call("/admin");
must(r.status === 200 && (await r.text()).includes("Sign in") && (await call("/admin")).headers.get("Content-Security-Policy").includes("default-src 'none'"), "signed out, /admin is the sign-in page inside the frame, with the app's strict policy");
r = await call("/admin", { cookies: carol });
must((await r.text()).includes("sign in again with organisation access"), "a member who is a maintainer is told how to get admin access");
r = await call("/admin", { cookies: admin });
html = await r.text();
must(r.status === 200 && html.includes("Catalogue admin") && html.includes("Live listings") && html.includes('class="adm-tabs"'), "a maintainer sees the admin page");
must((await call("/api/me", { cookies: admin })).status === 200 && (await (await call("/api/me", { cookies: admin })).json()).role === "admin" && (await (await call("/api/me", { cookies: carol })).json()).role === "user" && (await call("/api/me")).status === 401, "the header learns the role from /api/me; signed out it gets 401");
must((await call("/settings", { cookies: carol })).status === 200 && (await (await call("/settings")).text()).includes("Sign in"), "settings needs a sign-in");
for (const gone of ["/mine", "/recommended/", "/assets/admin.css"]) must((await call(gone, { cookies: carol })).status === 404, `${gone} is gone: the old paths are not kept`);
must(!existsSync(join(out, "recommended")) && !existsSync(join(out, ".nojekyll")), "the site has no redirect page for the old Recommended address");
r = await call("/auth/logout", { method: "POST", cookies: carol, origin: "https://praxikit.com" });
must(r.status === 302 && r.headers.get("Location") === "/", "signing out returns to the home page");

// ---- the removed pages send people somewhere useful
{
  let r0 = await call("/picks/"); must(r0.status === 301 && r0.headers.get("Location") === "/kits/?show=pick", "the old Picks address opens the kits list filtered to picks");
  r0 = await call("/updates/?kit=keel&v=0.6.1"); must(r0.status === 301 && r0.headers.get("Location") === "/k/keel/", "an old update-check link opens that kit's page");
  r0 = await call("/updates/?kit=" + encodeURIComponent("../evil")); must(r0.status === 301 && r0.headers.get("Location") === "/kits/", "a hostile kit name goes to the kits list");
  r0 = await call("/updates"); must(r0.status === 301 && r0.headers.get("Location") === "/kits/", "no kit named: the kits list");
}

// ---- regression: every address the app answers must reach the app, not the static files (a form once posted to an address the
// router did not know and got the file server's 405). The app's answers carry Referrer-Policy: same-origin; the site's files do not.
{
  const ME = { cookies: carol, origin: "https://praxikit.com" };
  const APP_ROUTES = [
    ["GET", "/submit"], ["GET", "/profile"], ["GET", "/settings"], ["GET", "/collection"], ["GET", "/collection/save?item=k%2Fpitch-panel%2F"], ["GET", "/account/export"], ["GET", "/admin"], ["GET", "/admin/listings"], ["GET", "/admin/notes"],
    ["GET", "/contributors"], ["GET", "/requests"], ["GET", "/admin/requests"], ["GET", "/u/nobody"], ["GET", "/api/me"], ["GET", "/api/collection"], ["GET", "/api/counts"], ["GET", "/api/community"], ["GET", "/api/item?item=k%2Fpitch-panel%2F"], ["GET", "/auth/login?mode=user"], ["GET", "/assets/app.css"], ["GET", "/healthz"],
    ["POST", "/settings/public", { public: "yes" }], ["POST", "/collection/save", { item: "k/pitch-panel/" }], ["POST", "/collection/remove", { item: "k/pitch-panel/" }], ["POST", "/collection/toggle", { item: "k/pitch-panel/" }], ["POST", "/account/delete", { confirm: "not-me" }],
    ["POST", "/api/vote", { item: "k/pitch-panel/" }], ["POST", "/api/note", { item: "k/pitch-panel/", text: "short" }], ["POST", "/api/note/delete", { item: "k/pitch-panel/" }], ["POST", "/api/note/report", { id: "1" }],
    ["POST", "/requests/new", { title: "short" }], ["POST", "/requests/need", { id: "1" }], ["POST", "/requests/delete", { id: "1" }], ["POST", "/admin/requests/decide", {}], ["POST", "/admin/listings/edit", {}], ["POST", "/admin/listings/remove", {}], ["POST", "/admin/notes/decide", {}], ["POST", "/admin/submissions/1/approve", {}], ["POST", "/auth/logout", {}],
    ...(globalThis.EXTRA_APP_ROUTES ?? []),
  ];
  for (const [method, path, form] of APP_ROUTES) {
    const x = await call(path, { method, ...ME, form });
    const app = x.headers.get("Referrer-Policy") === "same-origin"; // the app's pages say this; the site's files say something else
    must(x.status !== 405 && app, `${method} ${path} is answered by the app (status ${x.status}), not by the static files`);
  }
  must((await call("/settings/public", { method: "POST", ...ME, form: { public: "no" } })).status === 303, "the public-credit form reaches the app and is accepted");
}

// ---- regression: Saving read the catalogue over the internet, which a Worker cannot do to its own address; it must use its own files
// (the fake network in this test answers 404 to everything, exactly like an unreachable address)
{
  const page = await (await call("/collection/save?item=" + encodeURIComponent("k/keel/"), { cookies: carol })).text();
  must(page.includes("Save to your collection") && !page.includes("could not be read"), "the Save confirmation page finds the kit in the site's own files");
  const t = await call("/collection/toggle", { method: "POST", cookies: carol, origin: "https://praxikit.com", form: { item: "k/keel/" } });
  must(t.status === 200 && (await t.json()).saved === true, "the one-press Save works without any network");
  const t2 = await call("/collection/toggle", { method: "POST", cookies: carol, origin: "https://praxikit.com", form: { item: "k/keel/" } });
  must((await t2.json()).saved === false, "and pressing again removes it");
}

// ---- regression: the header's script must be allowed to run on the app's own pages too (it was blocked, so the header kept showing "Sign in")
for (const [p, ck] of [["/profile", carol], ["/settings", carol], ["/collection", carol], ["/admin", admin], ["/admin", {}]]) {
  const x = await call(p, { cookies: ck });
  const policy = x.headers.get("Content-Security-Policy") ?? "";
  must(policy.includes("script-src 'self'") && policy.includes("connect-src 'self'") && !policy.includes("unsafe-inline"), `${p} lets the site script and its /api/me call run, and nothing inline: ${policy}`);
  const body = await x.text();
  must(body.includes('src="/site.js?v=') && body.includes('data-app="https://praxikit.com"'), `${p} loads the site script and knows the app address`);
}
must((await (await call("/admin", { cookies: carol })).text()).includes('href="/auth/login">Sign in with organisation access'), "a member who is a maintainer gets a button to sign in with organisation access");
must((await (await call("/settings", { cookies: carol })).text()).includes("Maintainer access") && !(await (await call("/settings", { cookies: admin })).text()).includes("Maintainer access"), "settings offers maintainer sign-in to members only");

must(js0().includes('signin.href = signin.getAttribute("href") + "&return=" + encodeURIComponent(location.pathname + location.search)'), "the header's Sign in button remembers the page it was pressed on");
// ---- the site script's account code only acts where the app lives, and builds with text nodes
const js = readFileSync(join(out, "site.js"), "utf8");
must(js.includes('data-app') && js.includes("location.origin === appOrigin") && js.includes("textContent") && !js.includes("innerHTML") && !js.includes("document.write") && !js.includes("eval("), "the account code compares origins and never uses innerHTML or eval");
must(js.includes('"/collection/toggle"') && js.includes('"aria-pressed"') && js.includes("savedMap === null") && js.includes('getElementById("menu-toggle")') && js.includes('"aria-expanded"'), "the script turns Save links into a one-press toggle only when signed in, and runs the mobile menu");
const home = await (await call("/kits/")).text();
must(home.includes('class="save-btn"') && home.includes('data-save="k/keel/"') && home.includes('aria-label="Save keel to your collection"') && home.includes('id="menu-toggle"') && home.includes('aria-controls="site-nav"'), "cards carry a labelled bookmark button and the page has the menu button");
must(js.includes('link("/collection", "My collection")') && !js.includes("nav.insertBefore("), "My collection is in the account menu, and the navigation tab is in the page from the start (nothing is inserted later)");
must(js.includes('document.cookie.indexOf("praxikit-in=1") > -1') && js.includes('document.cookie = "praxikit-in=; Max-Age=0'), "visitors without the hint make no account requests, and a stale hint is cleared");
must(js.includes('"/admin"') && js.includes('"data-admin"') && js.includes('me.role === "admin"'), "the Admin tab is added first in the nav, only for the admin role");

rmSync(out, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: the site and the app share one address: static pages with strict headers, app pages in the site's frame, www redirects, an admin tab driven by /api/me");
