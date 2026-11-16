#!/usr/bin/env node
// Kit requests: asking, "I need this too", moderation, solving, limits and privacy. Fake GitHub and site, real SQLite. No network.
// Run from the repo root: node --no-warnings api/test-requests.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";
import { cleanRequest, REQUESTS } from "./src/lib/requests.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const raw = new DatabaseSync(":memory:");
raw.exec(readFileSync(join(here, "schema.sql"), "utf8"));
const D1 = { prepare(sql) { const st = raw.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }; return api; } };
const SECRET = "s".repeat(40);
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, SITE_URL: "https://site.example.dev/praxikit/", DB: D1 };
const OK = "https://admin.example.dev";
const XSS = "<script>alert(1)</script>";
const INDEX = [{ t: "Meeting Notes Skill", k: "listed", u: "https://github.com/o/notes", p: "l/o-notes/", ext: 1, d: "x", g: "" }, { t: "keel", k: "kit", u: "k/keel/", d: "y", g: "" }];
const USERS = { "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 }, "tok-eve": { login: "eve", id: 5 } };
const CODES = { "u-carol": "tok-carol", "u-dave": "tok-dave", "u-eve": "tok-eve" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.href === "https://site.example.dev/praxikit/search-index.json") return json(INDEX);
  if (u.origin === "https://api.github.com" && u.pathname === "/user") { const t = String(init.headers?.Authorization ?? "").replace("Bearer ", ""); return USERS[t] ? json(USERS[t]) : json({}, 401); }
  return json({}, 404);
};

const everything = [];
const call = (path, { method = "GET", cookies = {}, origin, form } = {}) => {
  const headers = new Headers();
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://admin.example.dev${path}`, init), env);
};
const text = async (r) => { const t = await r.text(); everything.push(t); return t; };
const cookieValue = (res, name) => { const c = res.headers.getSetCookie().find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
async function signIn(code) {
  const login = await call("/auth/login?mode=user");
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const cb = await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } });
  return { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") };
}
const sess = (over, ageMin = 1) => signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", iat: Date.now() - ageMin * 60000, exp: Date.now() + 3600000, ...over }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const post = async (path, session, form, origin = OK) => call(path, { method: "POST", cookies: session, origin, form });
const rows = (sql, ...a) => raw.prepare(sql).all(...a);

const carol = await signIn("u-carol"), dave = await signIn("u-dave"), eve = await signIn("u-eve");
const admin = await sess({}), stale = await sess({}, 45);
const ASK = { title: "A skill that turns call notes into tickets", body: "I paste notes and want tickets for my tracker." };

// ---- the rules on their own
must(cleanRequest(ASK.title, ASK.body).ok && cleanRequest("  many   spaces here please  ", "").title === "many spaces here please", "a good request is accepted and tidied");
for (const [t, b, why] of [["short", "", "title too short"], ["x".repeat(REQUESTS.titleMax + 1), "", "title too long"], ["A kit for tickets from notes", "y".repeat(REQUESTS.bodyMax + 1), "details too long"], ["See https://spam.example now", "", "link in the title"], ["A kit for notes please", "go to cheap-pills.com", "link in the details"], ["aaaaaaaaaaaaaaaaaaaaaaaa", "", "repeated characters"]]) must(!cleanRequest(t, b).ok, `refused: ${why}`);

// ---- the page, signed out
let html = await text(await call("/requests"));
must(html.includes("Kit requests") && html.includes("No requests yet") && html.includes("Sign in with GitHub") && !html.includes('name="title"'), "signed out: the page explains itself, shows the empty state and offers sign-in, not the form");

// ---- asking
must((await post("/requests/new", {}, ASK)).status === 401, "asking needs a sign-in");
must((await post("/requests/new", carol, ASK, "https://evil.example")).status === 403, "and a request from this site");
let r = await post("/requests/new", carol, { title: "short", body: "" });
html = await text(r);
must(r.status === 400 && html.includes("a few words") && html.includes('value="short"'), "a bad request is explained, and what was typed is kept");
r = await post("/requests/new", carol, { title: "Needs a link https://x.example please", body: "" });
must(r.status === 400 && (await text(r)).includes("Links are not allowed"), "links are refused");
r = await post("/requests/new", carol, ASK);
must(r.status === 303 && r.headers.get("Location") === "/requests?m=waiting" && rows("SELECT status FROM requests WHERE user_id = 3")[0].status === "pending", "a first request waits for a maintainer");
html = await text(await call("/requests", { cookies: carol }));
must(html.includes("Waiting. Only you can see this.") && html.includes(ASK.title), "its author sees it, marked as waiting");
must(!(await text(await call("/requests", { cookies: dave }))).includes(ASK.title) && !(await text(await call("/requests"))).includes(ASK.title), "nobody else does");
must((await post("/requests/need", dave, { id: "1" })).headers.get("Location") === "/requests?m=gone", "a waiting request cannot be pressed yet");

// ---- the maintainers' review
must((await call("/admin/requests")).status === 200 && (await text(await call("/admin/requests"))).includes("Sign in"), "the review page asks for a sign-in");
must((await call("/admin/requests", { cookies: carol })).status === 403, "a member cannot open it");
html = await text(await call("/admin/requests", { cookies: admin }));
must(html.includes(ASK.title) && html.includes("@carol") && html.includes('value="solve"'), "a maintainer sees it with the person and the choices");
must((await text(await call("/admin", { cookies: admin }))).includes("Review requests (1)"), "and the admin page counts what is waiting");
must((await post("/admin/requests/decide", carol, { id: "1", action: "show" })).status === 403, "a member cannot decide");
must((await post("/admin/requests/decide", stale, { id: "1", action: "show" })).status === 401, "a stale maintainer sign-in is refused");
must((await post("/admin/requests/decide", admin, { id: "1", action: "show" }, "https://evil.example")).status === 403, "from another origin is refused");
must((await post("/admin/requests/decide", admin, { id: "1", action: "explode" })).headers.get("Location") === "/admin/requests?m=bad" && rows("SELECT status FROM requests")[0].status === "pending", "an unknown action does nothing");
await post("/admin/requests/decide", admin, { id: "1", action: "show" });
html = await text(await call("/requests"));
must(html.includes(ASK.title) && html.includes("Asked by @carol") && html.includes("I need this too") && html.includes('<span class="count">1</span>'), "once shown, everyone sees it, with the asker counted as needing it");

// ---- after one is shown, the person's later ones appear at once; maintainers' always do
r = await post("/requests/new", carol, { title: "A kit that checks my commit messages", body: "" });
must(r.headers.get("Location") === "/requests?m=posted" && rows("SELECT status FROM requests WHERE id = 2")[0].status === "open", "after one is shown, later requests appear at once");
r = await post("/requests/new", admin, { title: "A skill for release notes from git history", body: "" });
must(r.headers.get("Location") === "/requests?m=posted", "a maintainer's requests appear at once");
r = await post("/requests/new", carol, { title: "A third request from the same person", body: "" });
r = await post("/requests/new", carol, { title: "A fourth request from the same person", body: "" });
must(r.status === 429 && (await text(r)).includes("a lot"), "three requests a day is the limit");
raw.prepare("DELETE FROM requests WHERE id IN (2, 4, 5)").run();
raw.prepare("DELETE FROM request_needs WHERE request_id NOT IN (SELECT id FROM requests)").run();

// ---- "I need this too"
must((await post("/requests/need", {}, { id: "1" })).status === 401 && (await post("/requests/need", dave, { id: "1" }, "https://evil.example")).status === 403, "pressing needs a sign-in from this site");
r = await post("/requests/need", dave, { id: "1" });
html = await text(await call("/requests", { cookies: dave }));
must(r.headers.get("Location") === "/requests?m=needed" && html.includes("You need this") && html.includes('<span class="count">2</span>'), "pressing counts, and shows as yours");
await post("/requests/need", eve, { id: "1" });
must(rows("SELECT COUNT(*) AS n FROM request_needs WHERE request_id = 1")[0].n === 3, "three people need it");
r = await post("/requests/need", dave, { id: "1" });
must(r.headers.get("Location") === "/requests?m=unneeded" && rows("SELECT COUNT(*) AS n FROM request_needs WHERE request_id = 1")[0].n === 2, "pressing again takes it back");
must((await post("/requests/need", dave, { id: "x" })).headers.get("Location") === "/requests?m=bad" && (await post("/requests/need", dave, { id: "999" })).headers.get("Location") === "/requests?m=gone", "a bad or missing request is handled");
for (let i = 0; i < REQUESTS.needsPerHour; i++) raw.prepare("INSERT OR IGNORE INTO request_needs (request_id, user_id, created_at) VALUES (?, 5, ?)").run(1000 + i, new Date().toISOString());
must((await post("/requests/need", eve, { id: "1" })).headers.get("Location") === "/requests?m=slow", "a flood of presses is slowed down");
raw.prepare("DELETE FROM request_needs WHERE request_id >= 1000").run();

// ---- the most wanted come first
const relId = rows("SELECT id FROM requests WHERE user_id = 111")[0].id;
await post("/requests/need", eve, { id: String(relId) });
await post("/requests/need", dave, { id: String(relId) });
await post("/requests/need", dave, { id: "1" }); await post("/requests/need", dave, { id: "1" });
html = await text(await call("/requests"));
must(html.indexOf("A skill for release notes") < html.indexOf(ASK.title), "the request with three presses is listed above the one with two");

// ---- hostile text stays text
await post("/requests/new", admin, { title: XSS + " skill please", body: XSS });
html = await text(await call("/requests"));
must(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.includes("<script>alert(1)"), "markup in a request is shown as plain text");

// ---- deleting your own
must((await post("/requests/delete", dave, { id: "1" })).headers.get("Location") === "/requests?m=gone" && rows("SELECT * FROM requests WHERE id = 1").length === 1, "you cannot delete someone else's request");
await post("/requests/new", eve, { title: "Something eve wants to take back", body: "" });
const eveId = rows("SELECT id FROM requests WHERE user_id = 5")[0].id;
must((await post("/requests/delete", eve, { id: String(eveId) })).headers.get("Location") === "/requests?m=deleted" && rows("SELECT * FROM requests WHERE user_id = 5").length === 0 && rows("SELECT * FROM request_needs WHERE request_id = ?", eveId).length === 0, "you can delete your own, and the presses go with it");

// ---- solving
html = await text(await call("/admin/requests", { cookies: admin }));
must(html.includes("Mark solved"), "a maintainer can mark a request solved");
r = await post("/admin/requests/decide", admin, { id: "1", action: "solve", item: "https://github.com/o/nothere" });
must(r.headers.get("Location") === "/admin/requests?m=unsolved" && rows("SELECT status FROM requests WHERE id = 1")[0].status === "open", "a kit that is not in the catalogue cannot be used");
r = await post("/admin/requests/decide", admin, { id: "1", action: "solve", item: "" });
must(r.headers.get("Location") === "/admin/requests?m=unsolved", "nor can an empty one");
r = await post("/admin/requests/decide", admin, { id: "1", action: "solve", item: "https://github.com/o/notes" });
html = await text(await call("/requests"));
must(rows("SELECT status, solved_item FROM requests WHERE id = 1")[0].status === "solved" && html.includes("<h2>Solved</h2>") && html.includes('href="/l/o-notes/"') && html.includes("Meeting Notes Skill") && html.includes("Solved</span> by"), "a solved request moves to Solved and links to the kit that answers it");
must((await post("/requests/delete", carol, { id: "1" })).headers.get("Location") === "/requests?m=gone", "its author can no longer delete it");
must((await post("/requests/need", dave, { id: "1" })).headers.get("Location") === "/requests?m=needed", "people can still say they needed it");

// ---- hiding
await post("/admin/requests/decide", admin, { id: String(relId), action: "hide" });
must(!(await text(await call("/requests"))).includes("A skill for release notes") && !(await text(await call("/requests", { cookies: dave }))).includes("A skill for release notes") && (await text(await call("/requests", { cookies: admin }))).includes("Hidden by a maintainer"), "a hidden request disappears for everyone but its author, who is told");
await post("/admin/requests/decide", admin, { id: String(relId), action: "delete" });
must(rows("SELECT * FROM requests WHERE id = ?", relId).length === 0, "a maintainer can delete one");

// ---- privacy: the download and deleting an account
const exp = await (await call("/account/export", { cookies: carol })).json();
must(exp.requests.length === 1 && exp.requests[0].title === ASK.title && Array.isArray(exp.needed_too), "the data download includes requests and presses");
r = await call("/account/delete", { method: "POST", cookies: carol, origin: OK, form: { confirm: "carol" } });
must(r.status === 200 && rows("SELECT * FROM requests WHERE user_id = 3").length === 0 && rows("SELECT * FROM request_needs WHERE request_id = 1").length === 0 && !(await text(await call("/requests"))).includes(ASK.title), "deleting an account removes their requests and the presses on them");

for (const t of everything) must(!/<script(?!>alert)|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");
must(!everything.join("\n").includes("csecret") && !everything.join("\n").includes(SECRET), "no secret appears in any page");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: kit requests: asking in plain words, first requests reviewed, I need this too, most wanted first, solved by a listed kit, limits, privacy");
