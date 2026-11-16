#!/usr/bin/env node
// Accounts and private collections: sign-in carries a kit to save, only the live catalogue can be saved, collections are
// private per person, limits hold, data can be exported and deleted. Fake GitHub and site, real SQLite. No network.
// Run from the repo root: node --no-warnings api/test-accounts.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";
import { cleanItem, cleanLabel } from "./src/lib/account.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const raw = new DatabaseSync(":memory:");
raw.exec(readFileSync(join(here, "schema.sql"), "utf8"));
const D1 = { prepare(sql) { const st = raw.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }; return api; } };

const SECRET = "s".repeat(40), TOKEN = "gho_user_token_must_never_be_stored";
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, SITE_URL: "https://site.example.dev/praxikit/", DB: D1 };
const OK = "https://admin.example.dev";
const XSS = "<script>alert(1)</script>";

let INDEX = [
  { t: "keel", k: "kit", u: "k/keel/", d: "Plans projects", g: "planning" },
  { t: "/keel:plan", k: "skill", u: "k/keel/", d: "A skill", g: "" },
  { t: "Playwright MCP", k: "pick", u: "https://github.com/microsoft/playwright-mcp", ext: 1, d: "Drives a browser", g: "mcp" },
  { t: XSS, k: "listed", u: "https://github.com/o/evil", ext: 1, d: XSS, g: "" },
  ...Array.from({ length: 60 }, (_, i) => ({ t: "bulk" + i, k: "listed", u: `https://github.com/bulk/repo${i}`, ext: 1, d: "x", g: "" })),
  { t: "Tags", k: "page", u: "tags/", d: "pages cannot be saved", g: "" },
];
let siteDown = false;
const USERS = { "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 } };
const CODES = { "u-carol": "tok-carol", "u-dave": "tok-dave" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.href === "https://site.example.dev/praxikit/search-index.json") return siteDown ? json({}, 503) : json(INDEX);
  if (u.origin === "https://api.github.com" && u.pathname === "/user") return USERS[String(init.headers?.Authorization ?? "").replace("Bearer ", "")] ? json(USERS[String(init.headers.Authorization).replace("Bearer ", "")]) : json({}, 401);
  return json({}, 404);
};

const everything = [];
const call = (path, { method = "GET", cookies = {}, origin, form, headers: extra = {} } = {}) => {
  const headers = new Headers(extra);
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://admin.example.dev${path}`, init), env);
};
const note = async (res) => { everything.push(await res.clone().text(), [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")); return res; };
const cookieValue = (res, name) => { const c = res.headers.getSetCookie().find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
const loc = (r) => r.headers.get("Location") ?? "";
async function signIn(code, query = "") {
  const login = await note(await call(`/auth/login?mode=user${query}`));
  const state = new URL(loc(login)).searchParams.get("state");
  const cookies = { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") };
  for (const n of ["__Host-praxikit-save", "__Host-praxikit-next", "__Host-praxikit-return"]) if (cookieValue(login, n)) cookies[n] = cookieValue(login, n);
  const cb = await note(await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies }));
  return { login, cb, session: { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") } };
}
const rows = (sql, ...a) => raw.prepare(sql).all(...a);
const save = async (session, item, label = "", opts = {}) => note(await call("/collection/save", { method: "POST", cookies: session, origin: OK, form: { item, label }, ...opts }));

// ---- pure helpers
must(cleanItem("k/keel/") === "k/keel/" && cleanItem("https://github.com/O/R.git") === "https://github.com/O/R" && cleanItem("javascript:alert(1)") === "" && cleanItem("k/../x/") === "" && cleanItem("https://evil.example/o/r") === "" && cleanItem("k/KEEL/") === "", "only a kit path or a github.com repository is an item");
must(cleanLabel("  Work & <b>Plans</b>  ") === "Work & b Plans b" && cleanLabel("x".repeat(60)).length === 24 && cleanLabel("a\nb") === "a b", "labels are plain text up to 24 characters");

// ---- signed out
const so = await note(await call("/collection"));
must(so.status === 200 && (await so.clone().text()).includes("Sign in with GitHub"), "signed out, My collection asks to sign in");
must((await call("/collection/save", { method: "POST", origin: OK, form: { item: "k/keel/" } })).status === 401, "saving needs a sign-in");
must((await call("/privacy")).status === 404, "the app has no privacy page of its own: the text lives on the site");

// ---- the Save link: sign in, land on the confirmation, then save
const link = await (await note(await call("/collection/save?item=" + encodeURIComponent("k/keel/")))).text();
must(link.includes("save=" + encodeURIComponent("k/keel/")), "signed out, the sign-in link carries the kit to save");
const junkLink = await (await note(await call("/collection/save?item=" + encodeURIComponent("javascript:alert(1)")))).text();
must(!junkLink.includes("javascript:") && !junkLink.includes("save="), "a junk item is dropped, not echoed");
const carol = await signIn("u-carol", "&save=" + encodeURIComponent("k/keel/"));
must(loc(carol.cb) === "/collection/save?item=" + encodeURIComponent("k/keel/"), `after signing in the visitor lands on the confirmation: ${loc(carol.cb)}`);
must(rows("SELECT * FROM users").length === 1 && rows("SELECT * FROM users")[0].login === "carol" && rows("SELECT * FROM users")[0].id === 3, "an account record is made with the username and id only");
must(!JSON.stringify(rows("SELECT * FROM users")).includes(TOKEN) && !JSON.stringify(rows("SELECT * FROM collection")).includes("tok-"), "no GitHub token is stored");
const tamper = await signIn("u-dave", "");
const tamperCb = await note(await call("/auth/callback?code=u-dave&state=x", { cookies: { "__Host-praxikit-save": encodeURIComponent("https://evil.example/o/r") } }));
must(tamperCb.status === 400, "a callback without a matching state is refused");
must(loc(tamper.cb) === "/profile", "without a kit to save, sign-in goes to the profile");
const conf = await (await note(await call("/collection/save?item=" + encodeURIComponent("k/keel/"), { cookies: carol.session }))).text();
must(conf.includes("keel") && conf.includes('action="/collection/save"') && conf.includes("Private") === false && conf.includes("private"), "the confirmation shows the kit and saves with a form post, never a link");

// ---- after signing in, the person is back on the page they came from
{
  const back = async (query) => (await signIn("u-carol", query)).cb.headers.get("Location");
  must((await back("&return=" + encodeURIComponent("/kits/plugins/"))) === "/kits/plugins/", "signing in from a site page returns to that page");
  must((await back("&return=" + encodeURIComponent("/search/?q=planning"))) === "/search/?q=planning", "including its query");
  must((await back("&return=" + encodeURIComponent("/admin"))) === "/admin", "signing in from the admin page returns to the admin page");
  must((await back("")) === "/profile", "with no page to return to, sign-in lands on the profile");
  for (const bad of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "/../etc", "/auth/login", "/api/me", "javascript:alert(1)", "/x<script>", "/x y"]) must((await back("&return=" + encodeURIComponent(bad))) === "/profile", `an unsafe return address is ignored: ${bad}`);
  must((await back("&save=" + encodeURIComponent("k/keel/") + "&return=" + encodeURIComponent("/kits/"))) === "/collection/save?item=" + encodeURIComponent("k/keel/"), "saving a kit takes priority over the page you were on");
  const gate = await (await note(await call("/collection"))).text();
  must(gate.includes("return=%2Fcollection"), "a page that needs a sign-in sends you back to itself afterwards");
  const tamper = await note(await call("/auth/callback?code=u-carol&state=x", { cookies: { "__Host-praxikit-return": encodeURIComponent("https://evil.example/") } }));
  must(tamper.status === 400, "a callback without a matching state is still refused");
}

// ---- the hint cookie that spares signed-out visitors any account request
{
  const si = await signIn("u-carol", "");
  const hint = si.cb.headers.getSetCookie().find((c) => c.startsWith("praxikit-in="));
  must(hint && hint.startsWith("praxikit-in=1") && hint.includes("Secure") && !hint.includes("HttpOnly") && /Max-Age=\d+/.test(hint) && !hint.includes("carol"), "signing in leaves a plain hint the page can read, with no identity in it");
  const out = await note(await call("/auth/logout", { method: "POST", cookies: si.session, origin: OK }));
  must(out.headers.getSetCookie().some((c) => c.startsWith("praxikit-in=;") && c.includes("Max-Age=0")), "signing out clears the hint");
}

// ---- saving
let r = await save(carol.session, "k/keel/", "Planning");
must(r.status === 303 && loc(r).endsWith("m=saved") && rows("SELECT * FROM collection WHERE user_id = 3").length === 1, `a kit is saved: ${loc(r)}`);
r = await save(carol.session, "k/keel/", "Work");
must(rows("SELECT * FROM collection WHERE user_id = 3").length === 1 && rows("SELECT * FROM collection")[0].label === "Work", "saving again changes the group, not the count");
must(loc(await save(carol.session, "https://github.com/microsoft/playwright-mcp")).endsWith("m=saved"), "a listed repository can be saved");
must(loc(await save(carol.session, "tags/")).endsWith("m=bad") && loc(await save(carol.session, "k/nope/")).endsWith("m=gone") && loc(await save(carol.session, "https://github.com/not/listed")).endsWith("m=gone") && loc(await save(carol.session, "")).endsWith("m=bad"), "pages, unknown kits and unlisted repositories cannot be saved");
must((await save(carol.session, "k/keel/", "", { origin: "https://evil.example" })).status === 403 && (await save(carol.session, "k/keel/", "", { origin: undefined })).status === 403, "a save from another origin, or with no proof of origin, is refused");
siteDown = true; must(loc(await save(carol.session, "k/keel/")).endsWith("m=down"), "if the catalogue cannot be read, nothing is saved"); siteDown = false;

// ---- the one-press toggle used by the Save icon
{
  const toggle = async (session, item, over = {}) => note(await call("/collection/toggle", { method: "POST", cookies: session, origin: OK, form: { item }, ...over }));
  const dave2 = await signIn("u-dave", "");
  must((await call("/api/collection")).status === 401, "the saved list needs a sign-in");
  const list = async () => (await (await call("/api/collection", { cookies: dave2.session })).json()).items;
  const was = (await list()).includes("k/keel/");
  let r2 = await toggle(dave2.session, "k/keel/");
  must(r2.status === 200 && (await r2.json()).saved === !was && (await list()).includes("k/keel/") === !was, "pressing the icon flips the saved state, and the list agrees");
  r2 = await toggle(dave2.session, "k/keel/");
  must((await r2.json()).saved === was && (await list()).includes("k/keel/") === was, "pressing again flips it back");
  must((await toggle(dave2.session, "k/nope/")).status === 404, "an item that is not in the catalogue cannot be toggled on");
  must((await toggle(dave2.session, "k/keel/", { origin: "https://evil.example" })).status === 403, "a toggle from another origin is refused");
  must((await toggle({}, "k/keel/")).status === 401, "a toggle without a sign-in is refused");
  const mine = (await (await call("/api/collection", { cookies: carol.session })).json()).items;
  must(!mine.includes("k/nope/") && Array.isArray(mine), "the list is each person's own");
}

// ---- the collection page
const page = await (await note(await call("/collection", { cookies: carol.session }))).text();
must(page.includes("Playwright MCP") && page.includes("Work") && page.includes("keel") && page.includes("/settings") && !page.includes("Delete my account"), "the collection page lists saved kits by group and links to settings");
const settings = await (await note(await call("/settings", { cookies: carol.session }))).text();
must(settings.includes("Download my data") && settings.includes("Delete my account") && settings.includes('action="/auth/logout"'), "settings has the data download, sign-out and account deletion");
const profile = await (await note(await call("/profile", { cookies: carol.session }))).text();
must(profile.includes("@carol") && profile.includes("My collection") && profile.includes("My submissions") && !profile.includes("/admin"), "the profile shows the person, their collection and submissions, and no admin link for a member");
await save(carol.session, "https://github.com/o/evil", "<b>x</b>");
const evil = await (await note(await call("/collection", { cookies: carol.session }))).text();
must(!evil.includes("<script>alert(1)") && evil.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "hostile catalogue text is shown escaped");

// ---- private to each person
const dave = await signIn("u-dave", "");
const davePage = await (await note(await call("/collection", { cookies: dave.session }))).text();
must(!davePage.includes("Playwright MCP") && davePage.includes("Nothing saved yet"), "another person never sees your collection");
await save(dave.session, "k/keel/", "mine");
await note(await call("/collection/remove", { method: "POST", cookies: dave.session, origin: OK, form: { item: "https://github.com/microsoft/playwright-mcp" } }));
must(rows("SELECT * FROM collection WHERE user_id = 3").length === 3, "removing an item only touches your own rows");
r = await note(await call("/collection/remove", { method: "POST", cookies: carol.session, origin: OK, form: { item: "https://github.com/o/evil" } }));
must(loc(r).endsWith("m=removed") && rows("SELECT * FROM collection WHERE user_id = 3").length === 2, "an item can be removed");
must((await call("/collection/remove", { method: "POST", cookies: carol.session, origin: "https://evil.example", form: { item: "k/keel/" } })).status === 403, "removal from another origin is refused");

// ---- limits
const bulk = await signIn("u-dave", "");
for (let i = 0; i < 60; i++) await save(bulk.session, `https://github.com/bulk/repo${i}`);
const daveCount = rows("SELECT COUNT(*) AS n FROM collection WHERE user_id = 4")[0].n;
const addEvents = rows("SELECT COUNT(*) AS n FROM events WHERE user_id = 4 AND kind = 'save'")[0].n;
must(addEvents === 40 && daveCount <= 40, `at most 40 additions in an hour, counting ones that were added and taken back: ${addEvents} (${daveCount} saved now)`);
must(loc(await save(bulk.session, "https://github.com/bulk/repo59")).endsWith("m=slow"), "the hourly limit is reported plainly");
must(loc(await save(bulk.session, "k/keel/", "renamed")).endsWith("m=saved"), "changing a group on something already saved is not an addition");
raw.prepare("UPDATE collection SET added_at = '2020-01-01T00:00:00.000Z' WHERE user_id = 4").run();
for (let i = 0; i < 280; i++) raw.prepare("INSERT OR IGNORE INTO collection (user_id, item, label, added_at) VALUES (4, ?, '', '2020-01-01T00:00:00.000Z')").run(`https://github.com/filler/r${i}`);
must(rows("SELECT COUNT(*) AS n FROM collection WHERE user_id = 4")[0].n >= 300, "(test setup) the collection is at the cap");
must(loc(await save(bulk.session, "https://github.com/bulk/repo50")).endsWith("m=limit"), "the total cap holds");

// ---- export
const ex = await note(await call("/account/export", { cookies: carol.session }));
const exported = JSON.parse(await ex.clone().text());
must(ex.headers.get("Content-Disposition")?.includes("attachment") && exported.github_login === "carol" && exported.collection.length === 2 && !JSON.stringify(exported).includes("tok-"), "export is a download of your own data, without any token");
must((await call("/account/export")).status === 200 && !(await (await call("/account/export")).text()).includes("github_login"), "export needs a sign-in");

// ---- delete
raw.prepare("INSERT INTO submissions (repo_url, repo_key, name, owner, owner_type, submitted_by, submitted_by_id, source, commit_sha, precheck, precheck_status, status, created_at) VALUES ('https://github.com/a/p', 'a/p', 'p', 'a', 'User', 'carol', 3, 'community', 'a', '[]', 'pass', 'pending', '2026-11-16'), ('https://github.com/a/d', 'a/d', 'd', 'a', 'User', 'carol', 3, 'community', 'a', '[]', 'pass', 'approved', '2026-11-15')").run();
r = await note(await call("/account/delete", { method: "POST", cookies: carol.session, origin: OK, form: { confirm: "someone-else" } }));
must(loc(r).endsWith("m=confirm") && rows("SELECT * FROM users WHERE id = 3").length === 1, "deleting needs your own username typed");
must((await call("/account/delete", { method: "POST", cookies: carol.session, origin: "https://evil.example", form: { confirm: "carol" } })).status === 403 && rows("SELECT * FROM users WHERE id = 3").length === 1, "deleting from another origin is refused");
r = await note(await call("/account/delete", { method: "POST", cookies: carol.session, origin: OK, form: { confirm: "Carol" } }));
must(r.status === 200 && (await r.clone().text()).includes("Account deleted") && (cookieValue(r, "__Host-praxikit-session") ?? "x") === "", "deleting signs you out");
must(rows("SELECT * FROM users WHERE id = 3").length === 0 && rows("SELECT * FROM collection WHERE user_id = 3").length === 0, "the account record and collection are gone");
must(rows("SELECT * FROM submissions WHERE status = 'pending'").length === 0 && rows("SELECT * FROM submissions WHERE repo_key = 'a/d'")[0].submitted_by === "deleted-account" && rows("SELECT * FROM submissions WHERE repo_key = 'a/d'")[0].submitted_by_id === 0, "waiting submissions are deleted and decided ones lose the name");
must(rows("SELECT * FROM collection WHERE user_id = 4").length > 0 && rows("SELECT * FROM users WHERE id = 4").length === 1, "someone else's account is untouched");

// ---- an old session for a deleted account holds nothing
const ghost = await call("/collection", { cookies: carol.session });
must((await ghost.text()).includes("Nothing saved yet"), "a leftover session sees an empty collection");

// ---- nothing unsafe in any page
for (const t of everything) must(!/<script|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");
must(!everything.join("\n").includes("csecret") && !everything.join("\n").includes(SECRET), "no secret appears in any page or header");
void TOKEN; void signToken;

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: accounts keep only a username and id; kits are saved to a private collection from the live catalogue, with limits, export and deletion");
