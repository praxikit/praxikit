#!/usr/bin/env node
// Each finding of the security review, as a test that fails if the problem comes back: the open redirect on the www address,
// hidden names showing on notes and requests, limits that reset when things are deleted, moderation that can be sidestepped,
// sign-ins that survive account deletion, shared login names, non-atomic deletion, unindexed public reads, and the per-visitor limiter.
// Fake GitHub and site, real SQLite. No network. Run from the repo root: node --no-warnings api/test-hardening.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const raw = new DatabaseSync(":memory:");
raw.exec(readFileSync(join(here, "schema.sql"), "utf8"));
// a database whose batch is a real transaction, like D1's
const D1 = {
  prepare(sql) { const st = raw.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }, _run() { return st.run(...args); } }; return api; },
  async batch(stmts) { raw.exec("BEGIN"); try { for (const s of stmts) s._run(); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; } },
};
const SECRET = "s".repeat(40);
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, SITE_URL: "https://site.example.dev/praxikit/", DB: D1 };
const OK = "https://admin.example.dev";
const KEEL = "k/keel/";
const INDEX = [{ t: "keel", k: "kit", u: KEEL, d: "x", g: "" }, { t: "Alpha", k: "listed", u: "https://github.com/o/a", p: "l/o-a/", ext: 1, d: "a", g: "" }];
let USERS = { "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 }, "tok-eve": { login: "eve", id: 5 }, "tok-carol2": { login: "Carol", id: 9 }, "tok-gil": { login: "gil", id: 21 } };
const CODES = { "u-carol": "tok-carol", "u-dave": "tok-dave", "u-eve": "tok-eve", "u-carol2": "tok-carol2", "u-gil": "tok-gil" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "ntfy.sh") return new Response("ok");
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.href === "https://site.example.dev/praxikit/search-index.json") return json(INDEX);
  if (u.origin === "https://api.github.com" && u.pathname === "/user") { const t = String(init.headers?.Authorization ?? "").replace("Bearer ", ""); return USERS[t] ? json(USERS[t]) : json({}, 401); }
  return json({}, 404);
};

const call = (path, { method = "GET", cookies = {}, origin, form, host = "admin.example.dev", headers: extra = {}, e = env } = {}) => {
  const headers = new Headers(extra);
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://${host}${path}`, init), e);
};
const cookieValue = (res, name) => { const c = res.headers.getSetCookie().find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
async function signIn(code) {
  const login = await call("/auth/login?mode=user");
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const cb = await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } });
  return { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") };
}
const sess = (over) => signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", iat: Date.now() - 60000, exp: Date.now() + 3600000, ...over }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const post = (path, session, form, origin = OK, extra = {}) => call(path, { method: "POST", cookies: session, origin, form, ...extra });
const rows = (sql, ...a) => raw.prepare(sql).all(...a);
const GOOD = "I used it to plan a migration and it caught two gaps before I wrote any code.";

// ---- 1. the www address cannot be turned into an open redirect
for (const [path, want] of [["//evil.example/login", "https://admin.example.dev/evil.example/login"], ["///evil.example", "https://admin.example.dev/evil.example"], ["/kits/?x=1", "https://admin.example.dev/kits/?x=1"], ["/", "https://admin.example.dev/"]]) {
  const r = await call(path, { host: "www.admin.example.dev" });
  must(r.status === 301 && r.headers.get("Location") === want && new URL(r.headers.get("Location")).host === "admin.example.dev", `www${path} stays on our own address: ${r.headers.get("Location")}`);
}

const carol = await signIn("u-carol"), dave = await signIn("u-dave"), eve = await signIn("u-eve"), admin = await sess({});

// ---- 2. a hidden name stays hidden on notes and requests, and on the pages that show them
await post("/api/note", admin, { item: KEEL, text: "Maintainer here: I reach for this kit first, every time." });
await post("/api/note", carol, { item: KEEL, text: GOOD });
raw.prepare("UPDATE notes SET status = 'approved' WHERE user_id = 3").run();
await post("/requests/new", admin, { title: "A skill for release notes from git history", body: "" });
await post("/requests/new", carol, { title: "A skill that turns call notes into tickets", body: "" });
raw.prepare("UPDATE requests SET status = 'open' WHERE user_id = 3").run();
let item = await (await call("/api/item?item=" + encodeURIComponent(KEEL))).json();
let page = await (await call("/requests")).text();
must(item.notes.some((n) => n.login === "carol") && page.includes("Asked by @carol"), "by default a name is shown on notes and requests");
await post("/settings/public", carol, { public: "no" });
item = await (await call("/api/item?item=" + encodeURIComponent(KEEL) + "&v=2")).json();
page = await (await call("/requests")).text();
must(!item.notes.some((n) => n.login === "carol") && item.notes.some((n) => n.login === "") && !JSON.stringify(item).includes("carol") && !page.includes("@carol") && page.includes("Asked by a member"), "after hiding, her name is gone from the notes data and the requests page (shown as a member)");
await post("/settings/public", carol, { public: "yes" });

// ---- 3. limits cannot be reset by removing what was made
let r;
for (let i = 0; i < 60; i++) { await post("/api/vote", dave, { item: KEEL }); await post("/api/vote", dave, { item: KEEL }); }
r = await post("/api/vote", dave, { item: KEEL });
must(r.status === 429, "voting on and off 60 times uses up the hour's votes, even though nothing is left standing");
for (let i = 0; i < 40; i++) { await post("/collection/toggle", eve, { item: KEEL }); await post("/collection/toggle", eve, { item: KEEL }); }
r = await post("/collection/toggle", eve, { item: KEEL });
must(r.status === 429, "saving and removing 40 times uses up the hour's saves");
const fred = await signIn("u-carol2"); // a fresh account, for the request and note limits
for (let i = 0; i < 3; i++) await post("/requests/new", admin, { title: "Another request number " + i + " from me", body: "" });
r = await post("/requests/new", admin, { title: "One more request that is too many", body: "" });
must(r.status === 429, "the daily request limit holds");
raw.prepare("DELETE FROM requests WHERE user_id = 111").run();
r = await post("/requests/new", admin, { title: "Posting again after deleting them all", body: "" });
must(r.status === 429, "deleting your requests does not give you more");
for (let i = 0; i < 5; i++) { await post("/api/note", admin, { item: KEEL, text: GOOD + " Attempt " + i + " at writing it." }); await post("/api/note/delete", admin, { item: KEEL }); }
r = await post("/api/note", admin, { item: KEEL, text: GOOD + " A sixth attempt at writing it." });
must(r.status === 429, "writing and deleting notes five times uses up the day's notes");

// the report limit
for (let i = 0; i < 21; i++) raw.prepare("INSERT INTO notes (user_id, login, item, text, status, reports, created_at) VALUES (?, 'x', ?, 'a note that is long enough', 'approved', 0, '2026-11-17')").run(1000 + i, "https://github.com/o/a");
const ids = rows("SELECT id FROM notes WHERE user_id >= 1000").map((n) => n.id);
let last;
for (const id of ids) last = await post("/api/note/report", dave, { id: String(id) });
must(last.status === 429, "twenty reports a day is the limit, so one account cannot bury the review queue");

// ---- 4. moderation: a maintainer's hide or delete sends the person back to review
const gina = await signIn("u-eve");
raw.prepare("DELETE FROM notes").run(); raw.prepare("DELETE FROM events WHERE user_id = 5").run();
await post("/api/note", eve, { item: KEEL, text: GOOD });
const noteId = rows("SELECT id FROM notes WHERE user_id = 5")[0].id;
await post("/admin/notes/decide", admin, { id: String(noteId), action: "approve" });
r = await post("/api/note", eve, { item: "https://github.com/o/a", text: GOOD + " Second one, about another kit." });
must((await r.json()).status === "approved", "after one note is shown, a person's next notes appear at once");
await post("/admin/notes/decide", admin, { id: String(noteId), action: "delete" });
r = await post("/api/note", eve, { item: KEEL, text: GOOD + " Writing again after a deletion." });
must((await r.json()).status === "pending", "after a maintainer deletes a note, the person's next note is read first again");
raw.prepare("DELETE FROM events WHERE kind = 'strike'").run();

// ---- 5. a copy of the sign-in on another device stops working once the account is deleted
const frank = await signIn("u-gil");
r = await post("/api/vote", frank, { item: "https://github.com/o/a" });
must(r.status === 200, "(setup) the sign-in works");
await post("/account/delete", frank, { confirm: "gil" });
r = await post("/api/vote", frank, { item: "https://github.com/o/a" });
must(r.status === 401 && rows("SELECT * FROM users WHERE id = 21").length === 0, "the same sign-in, used again after the account was deleted, is refused and does not bring the account back");
must((await call("/profile", { cookies: frank })).status === 200, "(pages that only read still load; they show nothing of the person)");

// ---- 6. two accounts never share a login name after a rename
r = await call("/api/me", { cookies: fred });
must((await signIn("u-carol")) !== undefined && rows("SELECT login FROM users WHERE id = 3")[0].login === "carol", "(setup) carol signs in");
await signIn("u-carol2");
const names = rows("SELECT id, login FROM users WHERE id IN (3, 9) ORDER BY id");
must(names[1].login === "Carol" && names[0].login.startsWith("carol~") && new Set(names.map((n) => n.login.toLowerCase())).size === 2, `the later holder of a name gets it, the earlier one's copy is parked: ${JSON.stringify(names)}`);

// ---- 7. a posted form has a size cap
r = await post("/requests/new", carol, { title: "Short but with a large declared size", body: "" }, OK, { headers: { "Content-Length": "30000" } });
must(r.status === 413, "a request that declares a very large body is refused");

// ---- 8. deleting an account is all or nothing
raw.prepare("INSERT OR IGNORE INTO collection (user_id, item, label, added_at) VALUES (5, ?, '', '2026-11-17')").run(KEEL);
raw.exec("ALTER TABLE votes RENAME TO votes_x");
r = await post("/account/delete", eve, { confirm: "eve" });
raw.exec("ALTER TABLE votes_x RENAME TO votes");
must(r.status >= 500 && rows("SELECT * FROM collection WHERE user_id = 5").length === 1 && rows("SELECT * FROM users WHERE id = 5").length === 1, "if one step of a deletion fails, nothing is deleted");
r = await post("/account/delete", eve, { confirm: "eve" });
must(r.status === 200 && rows("SELECT * FROM users WHERE id = 5").length === 0 && rows("SELECT * FROM collection WHERE user_id = 5").length === 0, "and it works as one step when nothing fails");
must(rows("SELECT * FROM events WHERE user_id = 5 AND kind = 'deleted'").length === 1, "a short tombstone remains so that other devices are signed out");

// ---- 9. the public reads use indexes
const plan = (sql) => raw.prepare("EXPLAIN QUERY PLAN " + sql).all().map((p) => p.detail).join(" | ");
must(/collection_by_item/.test(plan("SELECT COUNT(*) FROM collection WHERE item = 'x'")), "saves for a kit are counted through an index");
must(/users_login_unique/.test(plan("SELECT * FROM users WHERE login = 'x' COLLATE NOCASE")), "a person is found by name through an index");
must(/submissions_repo_nocase/.test(plan("SELECT * FROM submissions WHERE repo_url = 'x' COLLATE NOCASE")), "who put a repository forward is found through an index");
must(/events_lookup/.test(plan("SELECT COUNT(*) FROM events WHERE user_id = 1 AND kind = 'vote' AND created_at >= 'x'")), "limits are counted through an index");

// ---- 10. the per-visitor limiter
let allowed = 3;
const limited = { ...env, LIMITER: { async limit() { return { success: allowed-- > 0 }; } } };
const codes = []; for (let i = 0; i < 5; i++) codes.push((await call("/api/counts", { e: limited })).status);
must(codes.join() === "200,200,200,429,429", `public reads are cut off after the allowance: ${codes}`);
must((await call("/auth/login?mode=user", { e: limited })).status === 429 && (await call("/contributors", { e: limited })).status !== 429, "sign-in starts are limited too, ordinary pages are not");
must((await call("/api/counts", { e: { ...env, LIMITER: { async limit() { throw new Error("down"); } } } })).status === 200, "if the limiter itself fails, visitors are let through");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: every finding of the security review is closed: no open redirect, hidden names stay hidden, limits survive deletion, strikes send people back to review, deleted accounts are signed out everywhere, names are unique, deletion is atomic, reads use indexes, visitors are limited");
