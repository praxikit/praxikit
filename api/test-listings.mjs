#!/usr/bin/env node
// Managing live listings from the admin app: who can, what the app may ask GitHub to do, and what it refuses.
// A fake GitHub (listings file and workflow dispatch) and a real SQLite database running api/schema.sql. No network.
// Run from the repo root: node --no-warnings api/test-listings.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken } from "./src/lib/crypto.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return { prepare(sql) { const st = db.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; } }; return api; } };
}

const SECRET = "s".repeat(40), DISPATCH = "github_pat_dispatch_secret_must_never_leak";
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, GITHUB_TOKEN: "ghp_read_only", GITHUB_DISPATCH_TOKEN: DISPATCH, DB: makeD1() };
const OK = "https://admin.example.dev";
const XSS = "<script>alert(1)</script>";
const SHA = "a".repeat(40);

let LISTINGS = [
  { name: "Playwright MCP", url: "https://github.com/microsoft/playwright-mcp", author: "microsoft", why: "Drives a real browser.", kind: "mcp", source: "recommended", added: "2026-11-15", commit: SHA, checks: "checks-flagged", pick: true, note: "I use it to test sites", tags: ["mcp", "testing"] },
  { name: XSS, url: "https://github.com/o/evil", author: "o", why: XSS, kind: "skill", source: "community", added: "2026-11-15", commit: SHA, checks: "no-flags-found", tags: [XSS] },
];
let dispatchMode = "ok";
const dispatches = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.origin !== "https://api.github.com") return json({}, 404);
  if (u.pathname === "/repos/praxikit/praxikit/contents/site/listings.json") return new Response(JSON.stringify(LISTINGS), { status: 200 });
  const d = /^\/repos\/praxikit\/praxikit\/actions\/workflows\/([a-z-]+\.yml)\/dispatches$/.exec(u.pathname);
  if (d && init.method === "POST") {
    dispatches.push({ file: d[1], auth: String(init.headers?.Authorization ?? ""), body: JSON.parse(init.body) });
    return dispatchMode === "ok" ? new Response(null, { status: 204 }) : json({ message: "no" }, 403);
  }
  return json({}, 404);
};

const call = (path, { method = "GET", cookies = {}, origin, form } = {}) => {
  const headers = new Headers();
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://admin.example.dev${path}`, init), env);
};
const sess = (over, ageMin = 1) => signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", iat: Date.now() - ageMin * 60000, exp: Date.now() + 3600000, ...over }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const admin = await sess({}), stale = await sess({}, 45), user = await sess({ sub: "carol", id: 3, role: "user", via: "" });
const loc = (r) => r.headers.get("Location") ?? "";
const post = (what, form, cookies = admin, origin = OK) => call(`/admin/listings/${what}`, { method: "POST", cookies, origin, form });
const edit = { url: "https://github.com/microsoft/playwright-mcp", name: "Playwright MCP", why: "Drives a real browser from an agent.", tags: "MCP, browser testing", note: "I use it to check my site" };

// ---- who can see the page
must((await call("/admin/listings")).status === 200 && (await (await call("/admin/listings")).text()).includes("Sign in"), "signed out, the page asks to sign in");
must((await call("/admin/listings", { cookies: user })).status === 403, "a plain signed-in user is refused");
const page = await call("/admin/listings", { cookies: admin });
const html = await page.text();
must(page.status === 200 && html.includes("Playwright MCP") && html.includes("I use it to test sites") && html.includes("mcp, testing"), "a maintainer sees the live listings with their fields");
must(!html.includes("<script>alert(1)") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "hostile listing text is shown escaped");
must(!html.includes(DISPATCH) && !html.includes("ghp_read_only"), "no token appears in the page");

// ---- edit
let r = await post("edit", edit);
must(r.status === 303 && loc(r).endsWith("m=edited") && dispatches.length === 1, `an edit starts exactly one job: ${loc(r)}`);
const d = dispatches[0];
must(d.file === "edit-listing.yml" && d.auth === `Bearer ${DISPATCH}`, "the edit job is started with the dispatch token");
must(d.body.ref === "main" && Object.keys(d.body.inputs).sort().join() === "by,decided_by,name,note,tags,url,why".replace("by,", "") && d.body.inputs.tags === "mcp,browser-testing" && d.body.inputs.decided_by === "ratul", `fixed inputs, tags cleaned: ${JSON.stringify(d.body.inputs)}`);
dispatches.length = 0;

must(loc(await post("edit", edit, stale)).includes("/auth") === false && (await post("edit", edit, stale)).status === 401 && dispatches.length === 0, "a stale sign-in is refused and nothing starts");
must((await post("edit", edit, user)).status === 403 && dispatches.length === 0, "a plain user cannot edit");
must((await post("edit", edit, admin, "https://evil.example")).status === 403 && dispatches.length === 0, "a request from another origin is refused");
must((await call("/admin/listings/edit", { method: "POST", cookies: admin, form: edit })).status === 403 && dispatches.length === 0, "a post with no origin proof is refused");
must(loc(await post("edit", { ...edit, url: "https://github.com/someone/else" })).endsWith("m=gone") && dispatches.length === 0, "a repository that is not live cannot be edited");
must(loc(await post("edit", { ...edit, url: "javascript:alert(1)" })).endsWith("m=gone") && dispatches.length === 0, "a non-GitHub link is refused");
must(loc(await post("edit", { ...edit, name: "" })).endsWith("m=badedit") && loc(await post("edit", { ...edit, why: "x".repeat(401) })).endsWith("m=badedit") && loc(await post("edit", { ...edit, note: "x".repeat(201) })).endsWith("m=badedit") && dispatches.length === 0, "bad fields are refused");
// the form cannot smuggle in fields the workflow does not take, nor change what was reviewed
r = await post("edit", { ...edit, commit: "b".repeat(40), checks: "no-flags-found", url2: "x" });
must(dispatches.length === 1 && !("commit" in dispatches[0].body.inputs) && !("checks" in dispatches[0].body.inputs), "extra form fields never reach the job");
dispatches.length = 0;

// ---- remove
const rm = { url: "https://github.com/o/evil", reason: "misleading", note: "Did not do what it said", confirm: "yes" };
r = await post("remove", rm);
must(loc(r).endsWith("m=removed") && dispatches.length === 1 && dispatches[0].file === "remove-listing.yml" && dispatches[0].body.inputs.reason === "misleading" && dispatches[0].body.inputs.url === rm.url, `a removal starts the remove job: ${loc(r)}`);
dispatches.length = 0;
must(loc(await post("remove", { ...rm, confirm: "" })).endsWith("m=badremove") && loc(await post("remove", { ...rm, reason: "because" })).endsWith("m=badremove") && loc(await post("remove", { ...rm, note: "x".repeat(161) })).endsWith("m=badremove") && dispatches.length === 0, "removal needs the confirmation, a listed reason and a short note");
must((await post("remove", rm, stale)).status === 401 && (await post("remove", rm, user)).status === 403 && dispatches.length === 0, "removal needs a fresh maintainer sign-in");

// ---- GitHub problems are reported plainly, nothing is claimed done
dispatchMode = "refuse";
r = await post("edit", edit);
must(loc(r).endsWith("m=joberr"), "a refused job is reported as not started");
dispatchMode = "ok"; dispatches.length = 0;
const saved = LISTINGS, realFetch = globalThis.fetch; LISTINGS = null;
globalThis.fetch = ((orig) => async (i, n) => (String(i.url ?? i).endsWith("listings.json") ? json({}, 500) : orig(i, n)))(globalThis.fetch);
must(loc(await post("edit", edit)).endsWith("m=unread") && dispatches.length === 0, "if the live listings cannot be read, nothing starts");
const errPage = await (await call("/admin/listings", { cookies: admin })).text();
must(errPage.includes("could not be read") && !errPage.includes(DISPATCH), "the page explains it without leaking anything");
LISTINGS = saved; globalThis.fetch = realFetch;

// ---- publishing not connected
const off = { ...env, GITHUB_DISPATCH_TOKEN: "REPLACE_ME" };
const rr = await worker.fetch(new Request("https://admin.example.dev/admin/listings/edit", { method: "POST", headers: new Headers({ Cookie: `__Host-praxikit-session=${admin["__Host-praxikit-session"]}`, Origin: OK, "Content-Type": "application/x-www-form-urlencoded" }), body: new URLSearchParams(edit).toString() }), off);
must(loc(rr).endsWith("m=nopublish"), "without a dispatch token the edit is refused with a clear message");

// ---- the Updates page: listings whose repository changed in files that run code; a maintainer reads and updates one at a time
{
  const NEWEST = "c".repeat(40);
  const PW = "https://github.com/microsoft/playwright-mcp";
  let newest = NEWEST;
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.origin === "https://api.github.com" && u.pathname === "/repos/microsoft/playwright-mcp") return json({ default_branch: "main" });
    if (u.origin === "https://api.github.com" && u.pathname === "/repos/microsoft/playwright-mcp/commits/main") return newest ? json({ sha: newest }) : json({}, 500);
    return inner(input, init);
  };
  const envU = { ...env, ASSETS: { fetch: async (req) => (new URL(req.url).pathname === "/drift.json" ? json({ [PW]: "review", "https://github.com/o/evil": "newer" }) : new Response("", { status: 404 })) } };
  const callU = (path, { method = "GET", cookies = {}, origin, form } = {}) => {
    const headers = new Headers(); const c = Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); if (c) headers.set("Cookie", c); if (origin) headers.set("Origin", origin);
    const init = { method, headers }; if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
    return worker.fetch(new Request("https://admin.example.dev" + path, init), envU);
  };
  const before = dispatches.length;
  must(!(await (await callU("/admin/updates")).text()).includes("Read what changed"), "without a sign-in the page shows nothing about the updates");
  must((await callU("/admin/updates", { cookies: user })).status === 403, "a signed-in person who is not a maintainer cannot open the updates");
  const page = await (await callU("/admin/updates", { cookies: admin })).text();
  must(page.includes("Playwright MCP") && page.includes("compare/" + SHA + "..." + NEWEST) && page.includes('name="read"') && page.includes("1 listed kit has newer commits") && !page.includes(DISPATCH), "the page lists the kit that needs reading, links the changes, and counts the quiet ones");
  const form = { url: PW, commit: NEWEST, read: "yes" };
  const go = (f, cookies = admin, origin = OK) => callU("/admin/updates/refresh", { method: "POST", cookies, origin, form: f });
  must(loc(await go({ ...form, read: "" })).endsWith("m=needread") && dispatches.length === before, "updating needs the box ticked");
  must(loc(await go(form, stale)).includes("/auth") || (await go(form, stale)).status === 401, "a stale sign-in is asked to sign in again");
  must((await go(form, user)).status === 403 && (await go(form, admin, "https://evil.example")).status === 403 && dispatches.length === before, "a non-maintainer and another origin are refused");
  must(loc(await go({ ...form, url: "https://github.com/x/not-listed" })).endsWith("m=gone") && dispatches.length === before, "only a listed repository can be updated");
  must(loc(await go({ ...form, commit: "d".repeat(40) })).endsWith("m=movedupdate") && dispatches.length === before, "if the repository moved since the page was drawn, nothing starts");
  newest = "";
  must(loc(await go(form)).endsWith("m=movedupdate") && dispatches.length === before, "if the newest commit cannot be read, nothing starts");
  newest = NEWEST;
  const ok = await go(form);
  must(loc(ok).endsWith("m=updating") && dispatches.length === before + 1 && dispatches[before].file === "update-listing.yml" && dispatches[before].body.inputs.url === PW && dispatches[before].body.inputs.expect_commit === NEWEST.slice(0, 12) && Object.keys(dispatches[before].body.inputs).length === 2, "a maintainer who read the changes starts the update job with the repository and the commit they were shown, nothing else");
  must(dispatches[before].auth.includes(DISPATCH) && !JSON.stringify(dispatches[before].body).includes(DISPATCH), "the job is started with the dispatch token, which is never in the request body");
  globalThis.fetch = inner;
}

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: maintainers edit and remove live listings through fixed jobs with fresh sign-ins; others, stale sessions, other origins and unlisted targets are refused");
