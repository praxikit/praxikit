#!/usr/bin/env node
// A development aid, not part of the app: runs the real Worker against an in-memory SQLite database and a fake GitHub,
// signs in as a maintainer and as a member, and writes the signed-in pages (admin queue, submission, notes, requests,
// profile, settings, collection, boards) to site/dist/_app/<name>.html so they can be looked at in a browser.
//   node site/build.mjs && node api/dev-render.mjs     then serve site/dist and open /_app/admin.html
// Nothing here is deployed: site/dist is rebuilt from scratch by site/build.mjs, which removes _app.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";
import { CSS } from "./src/lib/html.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "site", "dist");
const out = join(dist, "_app");
mkdirSync(out, { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
writeFileSync(join(dist, "assets", "app.css"), CSS); // the Worker serves this itself; a plain static server needs the file

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
const D1 = { raw: db, prepare(sql) { const st = db.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; } }; return api; } };

const SECRET = "s".repeat(40), SHA = "a".repeat(40);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain" };
const ASSETS = { async fetch(req) {
  const p = decodeURIComponent(new URL(req.url).pathname);
  let f = join(dist, p); if (p.endsWith("/")) f = join(f, "index.html");
  if (existsSync(f) && statSync(f).isFile()) return new Response(readFileSync(f), { headers: { "content-type": MIME[extname(f)] ?? "application/octet-stream" } });
  return new Response("not found", { status: 404 });
} };
const env = { BASE_URL: "https://praxikit.com", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "cs", SESSION_SECRET: SECRET, GITHUB_TOKEN: "x", GITHUB_DISPATCH_TOKEN: "y", DB: D1, ASSETS };
const ORIGIN = "https://praxikit.com";

// ---- a fake GitHub with a few repositories
const body = (owner, name, over = {}) => ({ name, owner: { login: owner, type: "User" }, private: false, archived: false, fork: false, license: { spdx_id: "MIT" }, default_branch: "main", pushed_at: new Date().toISOString(), topics: ["agents", "claude-code"], ...over });
const REPOS = {
  "alice/review-helper": { body: body("alice", "review-helper"), tree: ["SKILL.md", "README.md"], readme: "A skill that reads a diff the way a careful colleague would and writes the review comments you would otherwise forget." },
  "bob/meeting-notes": { body: body("bob", "meeting-notes"), tree: [".claude-plugin/plugin.json"], readme: "Turns a meeting transcript into decisions, owners and dates, and posts them where the team already looks." },
  "carol/video-tools": { body: body("carol", "video-tools"), tree: [".mcp.json"], readme: "Video editing tools for agents. Large repository with sample media, too big for the automatic scan." },
};
globalThis.fetch = async (input) => {
  const u = new URL(typeof input === "string" ? input : input.url), p = u.pathname;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (u.origin !== "https://api.github.com") return json({}, 404);
  if (p === "/repos/praxikit/praxikit/contents/site/listings.json") return new Response(readFileSync(join(here, "..", "site", "listings.json"), "utf8"), { status: 200 });
  if (p.startsWith("/repos/praxikit/praxikit/")) return json({ workflow_runs: [], jobs: [] });
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
  if (!m) return json({}, 404);
  const repo = REPOS[`${m[1]}/${m[2]}`.toLowerCase()], rest = m[3] ?? "";
  if (!repo) return json({ message: "Not Found" }, 404);
  if (rest === "") return json(repo.body);
  if (rest.startsWith("/commits/")) return json({ sha: SHA });
  if (rest.startsWith("/git/trees/")) return json({ tree: repo.tree.map((path) => ({ path })), truncated: false });
  if (rest === "/readme") return json({ path: "README.md", encoding: "base64", content: Buffer.from(repo.readme).toString("base64") });
  return json({}, 404);
};

const ctx = { waitUntil() {} };
const token = (sub, id, role) => signToken({ sub, id, role, via: role === "admin" ? "owner" : "user", iat: Date.now(), exp: Date.now() + 3600000 }, SECRET);
const sessions = { admin: await token("royal-programmer", 111, "admin"), carol: await token("carol", 3, "user"), dave: await token("dave", 4, "user") };
const call = (path, { method = "GET", as, form } = {}) => {
  const headers = new Headers();
  if (as) headers.set("Cookie", `__Host-praxikit-session=${sessions[as]}; praxikit-in=1`);
  const init = { method, headers };
  if (form) { headers.set("Origin", ORIGIN); headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
};

// ---- seed: submissions through the real route, then the rest straight into the tables
for (const [as, url, why] of [["carol", "https://github.com/alice/review-helper", "I use it every week and it catches things I miss."], ["dave", "https://github.com/bob/meeting-notes", ""], ["carol", "https://github.com/carol/video-tools", ""]]) await call("/submit", { method: "POST", as, form: { url, why } });
const now = new Date().toISOString();
db.prepare("UPDATE submissions SET scan_state = 'done', scan_label = 'checks-flagged', scan_commit = ?, scan_run_url = 'https://github.com/praxikit/praxikit/actions/runs/1', scan_at = ? WHERE id = 1").run(SHA.slice(0, 12), now);
db.prepare("UPDATE submissions SET scan_state = 'done', scan_label = 'needs-manual-review', scan_commit = 'none', scan_run_url = 'https://github.com/praxikit/praxikit/actions/runs/2', scan_at = ? WHERE id = 3").run(now);
db.prepare("INSERT INTO users (id, login, created_at, last_seen) VALUES (3, 'carol', ?, ?), (4, 'dave', ?, ?), (111, 'royal-programmer', ?, ?)").run(now, now, now, now, now, now);
const note = db.prepare("INSERT INTO notes (user_id, login, item, text, status, reports, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
note.run(3, "carol", "k/keel/", "Caught two gaps in my migration plan before I wrote any code. Worth the setup.", "pending", 0, now);
note.run(4, "dave", "https://github.com/microsoft/playwright-mcp", "Does what it says. The page snapshots are much more reliable than screenshots.", "approved", 2, now);
const req = db.prepare("INSERT INTO requests (user_id, login, title, body, status, solved_item, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
req.run(3, "carol", "A skill that turns meeting notes into tickets", "We keep losing action items between the call and the tracker.", "pending", "", now);
req.run(4, "dave", "A kit that checks my commit messages", "", "open", "", now);
req.run(3, "carol", "A plugin that explains a failing CI run", "", "open", "", now);
db.prepare("INSERT INTO request_needs (request_id, user_id, created_at) VALUES (2, 3, ?), (2, 111, ?), (3, 4, ?)").run(now, now, now);
db.prepare("INSERT INTO collection (user_id, item, label, added_at) VALUES (111, 'k/keel/', '', ?), (111, 'https://github.com/microsoft/playwright-mcp', 'browsers', ?)").run(now, now);
db.prepare("INSERT INTO votes (user_id, item, created_at) VALUES (3, 'k/keel/', ?), (4, 'k/keel/', ?)").run(now, now);

// ---- render
const pages = [
  ["signin", "/admin", null], ["admin", "/admin", "admin"], ["submission-flagged", "/admin/submissions/1", "admin"], ["submission-unscannable", "/admin/submissions/3", "admin"],
  ["admin-listings", "/admin/listings", "admin"], ["admin-notes", "/admin/notes", "admin"], ["admin-requests", "/admin/requests", "admin"],
  ["submit", "/submit", "carol"], ["profile", "/profile", "carol"], ["settings", "/settings", "carol"], ["collection", "/collection", "admin"],
  ["contributors", "/contributors", null], ["requests", "/requests", "carol"],
];
for (const [name, path, as] of pages) {
  const res = await call(path, { as });
  const text = await res.text();
  writeFileSync(join(out, `${name}.html`), text);
  console.log(String(res.status).padEnd(4), name.padEnd(24), path, `(${text.length} bytes)`);
}
// the browser-side development tools (site/dev) are served next to the pages, so they can be loaded with fetch + eval
for (const f of readdirSync(join(here, "..", "site", "dev"))) writeFileSync(join(out, f), readFileSync(join(here, "..", "site", "dev", f)));
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>App pages</title><link rel="stylesheet" href="/style.css"><body style="padding:24px"><h1>App pages</h1><ul>${pages.map(([n]) => `<li><a href="${n}.html">${n}</a></li>`).join("")}</ul>`);
