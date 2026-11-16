#!/usr/bin/env node
// "This helped me" votes and short notes: who can do what, what is refused, how moderation works, and what is private.
// Fake GitHub and site, real SQLite. No network. Run from the repo root: node --no-warnings api/test-community.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";
import { cleanNote, COMMUNITY } from "./src/lib/community.mjs";

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
const KEEL = "k/keel/", PW = "https://github.com/microsoft/playwright-mcp";

const INDEX = [{ t: "keel", k: "kit", u: KEEL, d: "x", g: "" }, { t: "Playwright MCP", k: "pick", u: PW, ext: 1, d: "y", g: "" }, { t: "Tags", k: "page", u: "tags/", d: "z", g: "" }];
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
const note = async (r) => { everything.push(await r.clone().text()); return r; };
const cookieValue = (res, name) => { const c = res.headers.getSetCookie().find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
async function signIn(code) {
  const login = await call("/auth/login?mode=user");
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const cb = await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } });
  return { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") };
}
const sess = (over, ageMin = 1) => signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", iat: Date.now() - ageMin * 60000, exp: Date.now() + 3600000, ...over }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const post = async (path, session, form, origin = OK) => note(await call(path, { method: "POST", cookies: session, origin, form }));
const item = async (session, it) => (await note(await call("/api/item?item=" + encodeURIComponent(it), { cookies: session }))).json();
const rows = (sql, ...a) => raw.prepare(sql).all(...a);

const carol = await signIn("u-carol"), dave = await signIn("u-dave"), eve = await signIn("u-eve");
const admin = await sess({}), staleAdmin = await sess({}, 45);
const GOOD = "I used it to plan a migration and it caught two gaps before I wrote any code.";

// ---- the rules for a note
must(cleanNote(GOOD).ok && cleanNote("  lots   of\n spaces in this useful note  ").text === "lots of spaces in this useful note", "a good note is accepted and tidied");
for (const bad of ["short", "x".repeat(COMMUNITY.max + 1), "see https://spam.example now please", "visit www.spam.example today ok", "go to cheap-pills.com for more", "evil.io has a better one for sure", "aaaaaaaaaaaaaaaaaaaa wow", "ftp://x.y/z is great fun"]) must(!cleanNote(bad).ok, `refused: ${bad.slice(0, 30)}`);
must(cleanNote("It works with Node.js and Next.js projects, which I like a lot.").ok, "ordinary product names like Node.js are not mistaken for links");

// ---- public counts and per-kit data, signed out
must((await (await note(await call("/api/counts"))).json()).votes !== undefined && (await call("/api/counts")).headers.get("Cache-Control").includes("max-age"), "counts are public and cacheable");
must((await item({}, KEEL)).signedIn === false && (await item({}, "javascript:alert(1)")).error === "bad", "per-kit data works signed out, and a junk item is refused");

// ---- votes
must((await post("/api/vote", {}, { item: KEEL })).status === 401, "voting needs a sign-in");
must((await post("/api/vote", carol, { item: KEEL }, "https://evil.example")).status === 403, "a vote from another origin is refused");
must((await post("/api/vote", carol, { item: "k/nope/" })).status === 404 && (await post("/api/vote", carol, { item: "tags/" })).status === 400, "unknown kits and pages cannot be voted on");
let r = await post("/api/vote", carol, { item: KEEL });
must(r.status === 200 && (await r.json()).votes === 1 && (await item(carol, KEEL)).voted === true, "a vote counts, and the voter sees it as theirs");
await post("/api/vote", dave, { item: KEEL });
must((await item({}, KEEL)).votes === 2 && (await item({}, KEEL)).voted === false, "two people, two votes; a visitor is not marked as having voted");
r = await post("/api/vote", carol, { item: KEEL });
must((await r.json()).voted === false && (await item({}, KEEL)).votes === 1, "pressing again takes the vote back");
must((await (await call("/api/counts")).json()).votes[KEEL] === 1, "the public counts agree");
for (let i = 0; i < COMMUNITY.votesPerHour; i++) raw.prepare("INSERT OR IGNORE INTO votes (user_id, item, created_at) VALUES (5, ?, ?)").run("https://github.com/filler/r" + i, new Date().toISOString());
must((await post("/api/vote", eve, { item: PW })).status === 429, "a flood of votes is slowed down");
raw.prepare("DELETE FROM votes WHERE user_id = 5").run();

// ---- saves as a signal: shown only from three people, and only as a number
for (const uid of [3, 4, 5]) raw.prepare("INSERT OR IGNORE INTO collection (user_id, item, label, added_at) VALUES (?, ?, '', '2026-11-16')").run(uid, KEEL);
raw.prepare("INSERT OR IGNORE INTO collection (user_id, item, label, added_at) VALUES (3, ?, '', '2026-11-16')").run(PW);
must((await (await call("/api/counts")).json()).saves[KEEL] === 3 && (await (await call("/api/counts")).json()).saves[PW] === undefined, "'saved by' appears from three people, never before");
must((await item({}, KEEL)).saves === 3 && (await item({}, PW)).saves === 0, "and on the kit's own data too");

// ---- notes: refused input
for (const [text, why] of [["short", "too short"], ["x".repeat(300), "too long"], ["great kit, see https://spam.example today", "link"]]) {
  r = await post("/api/note", carol, { item: KEEL, text });
  must(r.status === 400 && typeof (await r.json()).message === "string", `a note is refused: ${why}`);
}
must((await post("/api/note", {}, { item: KEEL, text: GOOD })).status === 401 && (await post("/api/note", carol, { item: KEEL, text: GOOD }, "https://evil.example")).status === 403 && (await post("/api/note", carol, { item: "k/nope/", text: GOOD })).status === 404, "notes need a sign-in, this site, and a real kit");

// ---- a person's first note waits for a maintainer
r = await post("/api/note", carol, { item: KEEL, text: GOOD });
must(r.status === 200 && (await r.json()).status === "pending", "a first note is held for review");
must((await item({}, KEEL)).notes.length === 0 && (await item(dave, KEEL)).notes.length === 0, "nobody else sees it yet");
let mine = (await item(carol, KEEL)).mine;
must(mine && mine.status === "pending" && mine.text === GOOD, "its author sees it, marked as waiting");
r = await post("/api/note", carol, { item: KEEL, text: GOOD + " Updated." });
must(rows("SELECT * FROM notes WHERE user_id = 3").length === 1 && (await item(carol, KEEL)).mine.text.endsWith("Updated."), "one note per person per kit: writing again replaces it");

// ---- the maintainers' review
must((await call("/admin/notes")).status === 200 && (await (await call("/admin/notes")).text()).includes("Sign in"), "the review page asks for a sign-in");
must((await call("/admin/notes", { cookies: carol })).status === 403, "a member cannot open it");
const page = await (await note(await call("/admin/notes", { cookies: admin }))).text();
must(page.includes("Updated.") && page.includes("@carol") && page.includes('name="action" value="approve"'), "a maintainer sees the waiting note with the person");
const noteId = rows("SELECT id FROM notes WHERE user_id = 3")[0].id;
must((await post("/admin/notes/decide", carol, { id: noteId, action: "approve" })).status === 403, "a member cannot decide");
must((await post("/admin/notes/decide", staleAdmin, { id: noteId, action: "approve" })).status === 401, "a stale maintainer sign-in is refused");
must((await post("/admin/notes/decide", admin, { id: noteId, action: "approve" }, "https://evil.example")).status === 403, "from another origin is refused");
must((await post("/admin/notes/decide", admin, { id: noteId, action: "explode" })).status === 303 && rows("SELECT status FROM notes WHERE id = ?", noteId)[0].status === "pending", "an unknown action does nothing");
r = await post("/admin/notes/decide", admin, { id: noteId, action: "approve" });
must(r.status === 303 && (await item({}, KEEL)).notes.length === 1 && (await item({}, KEEL)).notes[0].login === "carol", "showing a note publishes it with the author's name");
must(!JSON.stringify(await item({}, KEEL)).includes("user_id") && !JSON.stringify(await item({}, KEEL)).includes('"id":3'), "the public data carries no account ids");
must((await item(carol, KEEL)).notes[0].mine === true && (await item(dave, KEEL)).notes[0].mine === false, "a person's own note is marked as theirs, for them only");

// ---- once approved, later notes appear at once; maintainers' always do
r = await post("/api/note", carol, { item: PW, text: "I use it to check my pages in a real browser, it is steady." });
must((await r.json()).status === "approved" && (await item({}, PW)).notes.length === 1, "after one approved note, later notes show at once");
r = await post("/api/note", admin, { item: KEEL, text: "Maintainer here: this is the kit I reach for first." });
must((await r.json()).status === "approved", "a maintainer's own notes show at once");
for (let i = 0; i < COMMUNITY.notesPerDay; i++) raw.prepare("INSERT INTO notes (user_id, login, item, text, status, reports, created_at) VALUES (5, 'eve', ?, 'filler filler filler', 'approved', 0, ?)").run("https://github.com/filler/n" + i, new Date().toISOString());
must((await post("/api/note", eve, { item: KEEL, text: GOOD })).status === 429, "a flood of notes is slowed down");
raw.prepare("DELETE FROM notes WHERE user_id = 5").run();

// ---- reports
const carolNoteId = rows("SELECT id FROM notes WHERE user_id = 3 AND item = ?", KEEL)[0].id;
must((await post("/api/note/report", {}, { id: carolNoteId })).status === 401 && (await post("/api/note/report", dave, { id: "x" })).status === 400 && (await post("/api/note/report", dave, { id: 99999 })).status === 404, "reports need a sign-in, a real note");
await post("/api/note/report", carol, { id: carolNoteId });
must(rows("SELECT reports FROM notes WHERE id = ?", carolNoteId)[0].reports === 0, "you cannot report your own note");
await post("/api/note/report", dave, { id: carolNoteId }); await post("/api/note/report", dave, { id: carolNoteId });
must(rows("SELECT reports, status FROM notes WHERE id = ?", carolNoteId)[0].reports === 1 && (await item({}, KEEL)).notes.some((n) => n.id === carolNoteId), "one person reporting twice counts once, and one report hides nothing");
await post("/api/note/report", eve, { id: carolNoteId });
must(rows("SELECT status FROM notes WHERE id = ?", carolNoteId)[0].status === "hidden" && !(await item({}, KEEL)).notes.some((n) => n.id === carolNoteId), "two different people hide a note");
must((await (await note(await call("/admin/notes", { cookies: admin }))).text()).includes("Hidden after 2 reports"), "and it lands in the maintainers' list");
await post("/admin/notes/decide", admin, { id: carolNoteId, action: "approve" });
must((await item({}, KEEL)).notes.some((n) => n.id === carolNoteId) && rows("SELECT COUNT(*) AS n FROM note_reports WHERE note_id = ?", carolNoteId)[0].n === 0, "a maintainer can restore it, which clears the reports");

// ---- hostile text stays text
r = await post("/api/note", dave, { item: KEEL, text: XSS + " this helped me a great deal with planning" });
must(r.status === 200, "markup in a note is accepted as plain text");
const html = await (await note(await call("/admin/notes", { cookies: admin }))).text();
must(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.includes("<script>alert(1)"), "and shown escaped to maintainers");

// ---- own note: delete
r = await post("/api/note/delete", dave, { item: KEEL });
must((await r.json()).deleted === true && rows("SELECT * FROM notes WHERE user_id = 4").length === 0, "a person can delete their own note");

// ---- privacy: export and deletion
const exp = await (await call("/account/export", { cookies: carol })).json();
must(exp.notes.length === 2 && Array.isArray(exp.helped_me) && exp.notes.some((n) => n.text === GOOD + " Updated."), "the data download includes notes and votes");
await post("/api/vote", carol, { item: PW });
r = await note(await call("/account/delete", { method: "POST", cookies: carol, origin: OK, form: { confirm: "carol" } }));
must(r.status === 200 && rows("SELECT * FROM notes WHERE user_id = 3").length === 0 && rows("SELECT * FROM votes WHERE user_id = 3").length === 0 && rows("SELECT * FROM note_reports WHERE note_id = ?", carolNoteId).length === 0, "deleting an account removes its notes, votes and the reports on them");
must(!(await item({}, KEEL)).notes.some((n) => n.login === "carol"), "and they disappear from the site");

// ---- nothing unsafe in any page
for (const t of everything) must(!/<script(?!>alert)|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");
must(!everything.join("\n").includes("csecret") && !everything.join("\n").includes(SECRET), "no secret appears in any response");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: helped-me votes and short notes: sign-in and origin checks, no links, one note per person, first notes reviewed, reports hide, maintainers decide, data is exportable and deletable");
