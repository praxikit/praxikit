#!/usr/bin/env node
// The alert to the owner (a push through ntfy for things that wait for review) and the edge cache on the two public summaries.
// Fake GitHub, fake ntfy, fake edge cache, real SQLite. No network. Run from the repo root: node --no-warnings api/test-notify.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";
import { notifyOwner } from "./src/lib/notify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const raw = new DatabaseSync(":memory:");
raw.exec(readFileSync(join(here, "schema.sql"), "utf8"));
const D1 = { prepare(sql) { const st = raw.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }; return api; } };
const SECRET = "s".repeat(40), TOPIC = "t0pic-Abc123_xyz-9876543210";
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, SITE_URL: "https://site.example.dev/praxikit/", DB: D1, NTFY_TOPIC: TOPIC };
const OK = "https://admin.example.dev";
const INDEX = [{ t: "keel", k: "kit", u: "k/keel/", d: "x", g: "" }];
const USERS = { "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 }, "tok-eve": { login: "eve", id: 5 } };
const CODES = { "u-carol": "tok-carol", "u-dave": "tok-dave", "u-eve": "tok-eve" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const pushes = [];
let ntfyMode = "ok";
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "ntfy.sh") {
    pushes.push({ path: u.pathname, title: init.headers?.Title, click: init.headers?.Click, body: String(init.body ?? "") });
    if (ntfyMode === "throw") throw new Error("down");
    return new Response("ok", { status: ntfyMode === "500" ? 500 : 200 });
  }
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.href === "https://site.example.dev/praxikit/search-index.json") return json(INDEX);
  if (u.origin === "https://api.github.com" && u.pathname === "/user") { const t = String(init.headers?.Authorization ?? "").replace("Bearer ", ""); return USERS[t] ? json(USERS[t]) : json({}, 401); }
  return json({}, 404);
};

const call = (path, { method = "GET", cookies = {}, origin, form, e = env } = {}) => {
  const headers = new Headers();
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://admin.example.dev${path}`, init), e);
};
const cookieValue = (res, name) => { const c = res.headers.getSetCookie().find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
async function signIn(code) {
  const login = await call("/auth/login?mode=user");
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const cb = await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } });
  return { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") };
}
const sess = (over) => signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", iat: Date.now() - 60000, exp: Date.now() + 3600000, ...over }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const post = (path, session, form, origin = OK) => call(path, { method: "POST", cookies: session, origin, form });
const rows = (sql, ...a) => raw.prepare(sql).all(...a);

// ---- the message itself
pushes.length = 0;
must((await notifyOwner({ BASE_URL: OK }, { title: "x", message: "y" })) === false && (await notifyOwner({ ...env, NTFY_TOPIC: "short" }, { title: "x", message: "y" })) === false && (await notifyOwner({ ...env, NTFY_TOPIC: "has spaces and/slashes 1234567890" }, { title: "x", message: "y" })) === false && pushes.length === 0, "with no topic, or a malformed one, nothing is sent");
must((await notifyOwner(env, { title: "Café ❤ time", message: "line\none ☃ snow " + "z".repeat(400), path: "/admin/notes" })) === true, "a push is sent when a topic is set");
const p0 = pushes[0];
must(p0.path === "/" + TOPIC && p0.click === "https://admin.example.dev/admin/notes" && /^[\x20-\x7e]*$/.test(p0.title) && /^[\x20-\x7e]*$/.test(p0.body) && p0.body.length <= 300 && !p0.body.includes("\n"), "it goes to the topic, links to the right admin page, and is plain ASCII within 300 characters");
pushes.length = 0; await notifyOwner(env, { title: "t", message: "m", path: "https://evil.example/x" });
must(pushes[0].click === "https://admin.example.dev/admin", "a link that is not a path on this site is replaced by the admin address");
for (const mode of ["500", "throw"]) { ntfyMode = mode; must((await notifyOwner(env, { title: "t", message: "m" })) === false, `a failing push (${mode}) is reported as not sent, never thrown`); }
ntfyMode = "ok";

// ---- what triggers it
const carol = await signIn("u-carol"), dave = await signIn("u-dave"), eve = await signIn("u-eve"), admin = await sess({});
const GOOD = "I used it to plan a migration and it caught two gaps before I wrote any code.";
pushes.length = 0;
let r = await post("/api/note", carol, { item: "k/keel/", text: GOOD });
must(r.status === 200 && pushes.length === 1 && pushes[0].title === "A note is waiting" && pushes[0].body.includes("@carol") && !pushes[0].body.includes("migration") && pushes[0].click.endsWith("/admin/notes"), "a first note sends one push, naming the person but never the note's text");
const noteId = rows("SELECT id FROM notes")[0].id;
await post("/admin/notes/decide", admin, { id: noteId, action: "approve" });
pushes.length = 0;
await post("/api/note", carol, { item: "k/keel/", text: GOOD + " Updated." });
await post("/api/note", admin, { item: "k/keel/", text: "Maintainer note: this is the first kit I reach for." });
must(pushes.length === 0, "notes that are shown at once send nothing");
r = await post("/api/note/report", dave, { id: String(noteId) });
must(pushes.length === 0, "one report sends nothing");
await post("/api/note/report", eve, { id: String(noteId) });
must(pushes.length === 1 && pushes[0].title === "A note was hidden" && !pushes[0].body.includes("migration"), "the second report hides the note and sends one push");
await post("/api/note/report", eve, { id: String(noteId) }); await post("/api/note/report", dave, { id: String(noteId) });
must(pushes.length === 1, "further reports on a hidden note send nothing more");

pushes.length = 0;
await post("/requests/new", dave, { title: "A skill that turns call notes into tickets", body: "private detail that must not be pushed" });
must(pushes.length === 1 && pushes[0].title === "A request is waiting" && pushes[0].body.includes("@dave") && !pushes[0].body.includes("tickets") && !pushes[0].body.includes("private") && pushes[0].click.endsWith("/admin/requests"), "a first request sends one push without its text");
await post("/admin/requests/decide", admin, { id: String(rows("SELECT id FROM requests")[0].id), action: "show" });
pushes.length = 0;
await post("/requests/new", dave, { title: "A second request from the same person", body: "" });
await post("/requests/new", admin, { title: "A request from a maintainer", body: "" });
must(pushes.length === 0, "requests that appear at once send nothing");

// ---- a failing push never breaks the request
ntfyMode = "throw";
r = await post("/api/note", eve, { item: "k/keel/", text: GOOD + " Eve's own words about it here." });
must(r.status === 200 && (await r.json()).saved === true && rows("SELECT * FROM notes WHERE user_id = 5").length === 1, "if ntfy is down the note is still saved");
ntfyMode = "ok";

// ---- no topic configured: silence
pushes.length = 0;
const quiet = { ...env, NTFY_TOPIC: undefined };
await call("/api/note", { method: "POST", cookies: await signIn("u-eve"), origin: OK, form: { item: "k/keel/", text: GOOD + " A different note from eve." }, e: quiet });
must(pushes.length === 0, "without a configured topic the app never contacts ntfy");

// ---- the edge cache on the two public summaries
const store = new Map();
globalThis.caches = { default: { async match(req) { const v = store.get(req.url); return v ? v.clone() : undefined; }, async put(req, res) { store.set(req.url, res.clone()); } } };
try {
  const a = await (await call("/api/counts")).json();
  raw.prepare("INSERT OR IGNORE INTO votes (user_id, item, created_at) VALUES (3, 'k/keel/', '2026-11-17')").run();
  const b = await call("/api/counts?cachebust=1");
  must(JSON.stringify(await b.json()) === JSON.stringify(a) && (b.headers.get("Cache-Control") ?? "").includes("max-age=60"), "the counts are answered from the edge cache, whatever the query string");
  const c1 = await (await call("/api/community")).json();
  raw.prepare("INSERT INTO requests (user_id, login, title, body, status, created_at) VALUES (9, 'zed', 'A brand new request', '', 'open', '2026-11-17')").run();
  must(JSON.stringify(await (await call("/api/community")).json()) === JSON.stringify(c1), "so is the home strip");
  const i1 = await (await call("/api/item?item=k%2Fkeel%2F", { cookies: dave })).json();
  raw.prepare("INSERT OR IGNORE INTO votes (user_id, item, created_at) VALUES (4, 'k/keel/', '2026-11-17')").run();
  const i2 = await (await call("/api/item?item=k%2Fkeel%2F", { cookies: dave })).json();
  must(i2.votes === i1.votes + 1 && i2.voted === true && i1.voted === false, "but anything that depends on the person is never cached");
  store.clear();
  must((await (await call("/api/counts")).json()).votes["k/keel/"] === 2, "and an empty cache gives fresh numbers");
} finally { delete globalThis.caches; }

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: the owner gets a push for things waiting for review (no private text, never blocking), and the two public summaries come from the edge cache");
