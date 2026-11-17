#!/usr/bin/env node
// Phase 2 tests: the submit form, repo lookup, README excerpt, author detection, limits and the admin
// queue. A fake GitHub and a real SQLite database (node:sqlite, running api/schema.sql). No network.
// Run from the repo root: node api/test-submit.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { verifyToken } from "./src/lib/crypto.mjs";
import { parseRepo, readmeExcerpt, guessKind, precheck } from "./src/lib/repo.mjs";
import { parseTags as appTags } from "./src/lib/tags.mjs";
import { parseTags as siteTags } from "../site/listings.mjs";
import { d1Store } from "./src/lib/store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

// ---- a D1-shaped wrapper over real SQLite, running the real schema
function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return { raw: db, prepare(sql) { const st = db.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return api; } };
}

const SECRET = "s".repeat(40);
const TOKEN = "ghp_readonlytoken_must_never_leak";
const baseEnv = () => ({ BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, GITHUB_TOKEN: TOKEN });
const D1 = makeD1();
const env = { ...baseEnv(), DB: D1, NTFY_TOPIC: "topic-for-tests-0123456789" };
const pushes = [];

// ---- a fake GitHub
const SHA = "a".repeat(40);
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const USERS = { "tok-alice": { login: "alice", id: 1 }, "tok-bob": { login: "bob", id: 2 }, "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 }, "tok-owner": { login: "ratul", id: 111 } };
const CODES = { "u-alice": "tok-alice", "u-bob": "tok-bob", "u-carol": "tok-carol", "u-dave": "tok-dave", "good-owner": "tok-owner" };
const README = `<h1 align="center"><img src="https://evil.example/x.png"></h1>

[![build](https://img.shields.io/x.svg)](https://ci.example) [![npm](https://img.shields.io/n.svg)](https://npm.example)

<script>alert(1)</script>

# Good Kit

A **small** tool that [does things](javascript:alert(1)) for agents. Ping @everyone about it. <img src=x onerror=alert(2)>

\`\`\`js
fetch("https://evil.example/leak")
\`\`\`

More text.`;
const repoBody = (owner, name, over = {}) => ({ name, owner: { login: owner, type: "User" }, private: false, archived: false, fork: false, license: { spdx_id: "MIT" }, default_branch: "main", pushed_at: "2026-11-01T00:00:00Z", ...over });
const REPOS = {
  "alice/good": { body: repoBody("alice", "good", { topics: ["Claude-Code", "Agents", "<b>x</b>", "agents", "z"] }), tree: [".claude-plugin/plugin.json", "README.md", "skills/a/SKILL.md"], readme: README },
  "alice/other": { body: repoBody("alice", "other"), tree: ["SKILL.md"], readme: "A second repository by the same person, with enough words to count." },
  "acme/tool": { body: repoBody("acme", "tool", { owner: { login: "acme", type: "Organization" }, license: null }), tree: ["SKILL.md"], readme: "Tools from the acme organisation, described in a full sentence here." },
  "someone/archived": { body: repoBody("someone", "archived", { archived: true, fork: true, pushed_at: "2019-01-01T00:00:00Z" }), tree: ["notes.txt"], readme: "An old archived repository that nobody has touched for years now." },
  "someone/private": { body: repoBody("someone", "private", { private: true }), tree: [], readme: "" },
  "evil/name": { body: repoBody("evil", "name", { name: "<img src=x onerror=alert(1)>Bad" }), tree: [".mcp.json"], readme: "A repository whose name field contains markup that must stay inert." },
  "listedowner/listed": { body: repoBody("listedowner", "listed"), tree: ["SKILL.md"], readme: "Already in the catalogue, so a second submission must be refused." },
};
const LISTINGS = JSON.stringify([{ name: "Listed", url: "https://github.com/ListedOwner/Listed", author: "x", why: "y", kind: "skill", source: "community", added: "2026-11-15", commit: SHA, checks: "no-flags-found" }]);
let downMode = "";
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "ntfy.sh") { pushes.push({ title: init.headers?.Title, body: String(init.body ?? ""), click: init.headers?.Click }); return new Response("ok"); }
  const auth = init.headers?.Authorization ?? "";
  calls.push({ url: u.href, auth });
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.origin !== "https://api.github.com") return json({}, 404);
  const p = u.pathname;
  const bearer = auth.replace("Bearer ", "");
  if (p === "/user") return USERS[bearer] ? json(USERS[bearer]) : json({}, 401);
  if (p === "/user/memberships/orgs/praxikit") return bearer === "tok-owner" ? json({ state: "active", role: "admin" }) : json({}, 404);
  if (p === "/user/teams") return json([]);
  if (p === "/orgs/acme/public_members/bob") return new Response(null, { status: 204 });
  if (p.startsWith("/orgs/")) return new Response(null, { status: 404 });
  if (p === "/repos/praxikit/praxikit/contents/site/listings.json") return new Response(LISTINGS, { status: 200 });
  if (p === "/repos/praxikit/praxikit/issues") return json([]);
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
  if (!m) return json({}, 404);
  const key = `${m[1]}/${m[2]}`.toLowerCase(), rest = m[3] ?? "";
  if (m[1] === "busy") return json({ message: "rate limit" }, 403);
  if (m[1] === "flaky") throw new TypeError("network down");
  if (downMode === "5xx") return json({}, 500);
  const rate = /^rate\/r(\d)$/.exec(key);
  const repo = REPOS[key] ?? (rate ? { body: repoBody("rate", `r${rate[1]}`), tree: ["SKILL.md"], readme: `Repository number ${rate[1]} with a perfectly ordinary description sentence.` } : null);
  if (!repo) return json({ message: "Not Found" }, 404);
  if (rest === "") return json(repo.body);
  if (rest.startsWith("/commits/")) return json({ sha: SHA });
  if (rest.startsWith("/git/trees/")) return json({ tree: repo.tree.map((path) => ({ path })), truncated: false });
  if (rest === "/readme") return repo.readme ? json({ path: "README.md", encoding: "base64", content: b64(repo.readme) }) : json({}, 404);
  return json({}, 404);
};

// ---- helpers
const call = (path, { method = "GET", cookies = {}, origin, form, e = env } = {}) => {
  const headers = new Headers();
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://admin.example.dev${path}`, init), e);
};
const OK = "https://admin.example.dev";
const setCookies = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) => { const c = setCookies(res).find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
const everything = [];
const note = async (res) => { everything.push(await res.clone().text(), [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")); return res; };
async function signIn(code, mode) {
  const login = await note(await call(mode ? `/auth/login?mode=${mode}` : "/auth/login"));
  const loc = new URL(login.headers.get("Location"));
  const cb = await note(await call(`/auth/callback?code=${code}&state=${encodeURIComponent(loc.searchParams.get("state"))}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } }));
  return { login, loc, cb, session: { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") } };
}
const rows = () => D1.raw.prepare("SELECT * FROM submissions ORDER BY id").all();
const submit = async (session, url, why = "", opts = {}) => note(await call("/submit", { method: "POST", cookies: session, origin: OK, form: { url, why }, ...opts }));

// ---- pure helpers
for (const good of ["https://github.com/o/r", "https://github.com/o/r.git", "https://github.com/o/r/tree/main/x", "see https://github.com/some-user/my.repo_1 please"]) must(parseRepo(good), `parsed ${good}`);
for (const bad of ["http://github.com/o/r", "https://github.com.evil.example/o/r", "https://github.com@evil.example/o/r", "https://user:pw@github.com/o/r", "https://github.com:444/o/r", "https://gitlab.com/o/r", "https://github.com/o", "https://github.com/../x", "javascript:alert(1)", "not a link", "", "git@github.com:o/r.git"]) must(parseRepo(bad) === null, `refused ${bad}`);
must(parseRepo("https://github.com/Owner/Repo.git").key === "owner/repo" && parseRepo("https://github.com/Owner/Repo/").url === "https://github.com/Owner/Repo", "the key is lowercase and the url is normalised");
{
  const ex = readmeExcerpt(README);
  must(ex.startsWith("A small tool that does things for agents. Ping (at)everyone about it."), `excerpt takes the first real sentence: ${ex}`);
  must(!/[<>@]|javascript|evil\.example|alert|fetch/.test(ex), `excerpt has no markup, links, mentions, scripts or code: ${ex}`);
  must(readmeExcerpt("x".repeat(500) + " word ".repeat(100)).length <= 241, "excerpt is capped");
  must(readmeExcerpt("") === "" && readmeExcerpt(null) === "", "an empty README gives an empty excerpt");
  must(!/\u0000/.test(readmeExcerpt("hello there friend, this is a test with a null\u0000 byte inside the sentence")), "control characters are removed");
}
must(guessKind([".claude-plugin/plugin.json"]) === "plugin" && guessKind(["a/SKILL.md"]) === "skill" && guessKind([".mcp.json"]) === "mcp" && guessKind([".cursorrules"]) === "template" && guessKind(["x.txt"]) === "", "kind is guessed from file names");
must(precheck({ license: "", kind: "", archived: false, fork: false, pushedAt: "2026-11-01", truncated: false }).status === "fail" && precheck({ license: "MIT", kind: "skill", archived: false, fork: false, pushedAt: "2026-11-01", truncated: false }).status === "pass" && precheck({ license: "MIT", kind: "", archived: true, fork: false, pushedAt: "2026-11-01", truncated: false }).status === "flag", "the quick check fails without a licence, flags oddities, passes when clean");

// ---- the app and the site must clean tags the same way
for (const sample of ["Planning, model routing; SEO", "a, <script>alert(1)</script>, ok-tag, -x-", "x".repeat(40), "", "A,b,C,,,d-e", Array.from({ length: 30 }, (_, i) => "t" + i).join(",")]) must(JSON.stringify(appTags(sample)) === JSON.stringify(siteTags(sample)), `tag rules agree for: ${sample.slice(0, 30)}`);

// ---- the store, on real SQLite
{
  const s = d1Store(D1);
  const rec = (o = {}) => ({ repo_url: "https://github.com/x/y", repo_key: "x/y", name: "y", owner: "x", owner_type: "User", submitted_by: "u", submitted_by_id: 9, source: "community", kind_guess: "", license: "MIT", commit_sha: SHA, readme_url: "", readme_excerpt: "", why: "", topics: "", precheck: "[]", precheck_status: "pass", created_at: "2026-11-15T10:00:00.000Z", ...o });
  const id = await s.insert(rec({ name: "'); DROP TABLE submissions;--" }));
  must(Number.isInteger(id) && id > 0 && (await s.get(id)).name === "'); DROP TABLE submissions;--" && rows().length === 1, "values are bound, never joined into SQL: a hostile name is stored as text and the table survives");
  let dup = false; try { await s.insert(rec()); } catch (e) { dup = e.message === "duplicate"; }
  must(dup, "a second pending submission for the same repository is refused by the database itself");
  must((await s.countSince(9, "2026-11-15T09:00:00.000Z")) === 1 && (await s.countSince(9, "2026-11-15T11:00:00.000Z")) === 0 && (await s.countSince(10, "2000-01-01")) === 0, "counting by user and time window works");
  D1.raw.exec("DELETE FROM submissions");
}

// ---- signed out
must((await note(await call("/submit"))).status === 200 && (await (await call("/submit")).text()).includes('href="/auth/login?mode=user&return=%2Fsubmit"'), "signed out, /submit offers the submitter sign-in and returns here afterwards");
must((await call("/submit", { method: "POST", origin: OK, form: { url: "https://github.com/alice/good" } })).status === 401 && rows().length === 0, "posting without signing in is refused and stores nothing");
must((await call("/profile")).status === 200 && (await (await call("/profile")).text()).includes("Sign in"), "/profile needs a sign-in");

// ---- a link typed on the website form is carried through the sign-in
{
  const good = "https://github.com/alice/good";
  const page = await (await note(await call("/submit?url=" + encodeURIComponent(good)))).text();
  must(page.includes("next=" + encodeURIComponent(good)), "signed out, the sign-in link carries the repository from the website form");
  const junk = await (await note(await call("/submit?url=" + encodeURIComponent("javascript:alert(1)")))).text();
  must(!junk.includes("javascript:") && !junk.includes("next="), "anything that is not a github.com repository is dropped, not echoed");
  const evil = await (await note(await call("/submit?url=" + encodeURIComponent("https://evil.example/x/y\"><script>alert(1)</script>")))).text();
  must(!evil.includes("evil.example") && !evil.includes("<script>alert(1)"), "a hostile link is neither kept nor echoed");
  const login = await note(await call("/auth/login?mode=user&next=" + encodeURIComponent(good)));
  must(cookieValue(login, "__Host-praxikit-next") !== undefined && decodeURIComponent(cookieValue(login, "__Host-praxikit-next")) === good, "the repository is kept in a short-lived cookie");
  const noNext = await note(await call("/auth/login?mode=user&next=" + encodeURIComponent("https://evil.example/o/r")));
  must(cookieValue(noNext, "__Host-praxikit-next") === undefined, "a link that is not on github.com is never stored");
  const adminLogin = await note(await call("/auth/login?next=" + encodeURIComponent(good)));
  must(cookieValue(adminLogin, "__Host-praxikit-next") === undefined, "the maintainer sign-in ignores it");
  const loc = new URL(login.headers.get("Location"));
  const cb = await note(await call("/auth/callback?code=u-carol&state=" + encodeURIComponent(loc.searchParams.get("state")), { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state"), "__Host-praxikit-next": cookieValue(login, "__Host-praxikit-next") } }));
  must(cb.headers.get("Location") === "/submit?url=" + encodeURIComponent(good), "after signing in the visitor lands on the form with the link filled in: " + cb.headers.get("Location"));
  const form = await (await note(await call("/submit?url=" + encodeURIComponent(good), { cookies: { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") } }))).text();
  must(form.includes('value="' + good + '"'), "the signed-in form is prefilled");
  const tamper = await note(await call("/auth/callback?code=u-carol&state=" + encodeURIComponent(loc.searchParams.get("state")), { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state"), "__Host-praxikit-next": "https://evil.example/o/r" } }));
  must(tamper.headers.get("Location") === "/profile", "a tampered next cookie is ignored");
}

// ---- submitter sign-in asks only who you are
calls.length = 0;
const carol = await signIn("u-carol", "user");
must(carol.loc.searchParams.get("scope") === "read:user", `submitter sign-in asks for read:user only, got ${carol.loc.searchParams.get("scope")}`);
must(carol.cb.headers.get("Location") === "/profile" && !calls.some((c) => c.url.includes("/user/memberships") || c.url.includes("/user/teams")), "submitter sign-in never reads org membership or teams");
must((await verifyToken(carol.session["__Host-praxikit-session"], SECRET)).role === "user", "a submitter has the user role");
must(carol.loc.searchParams.get("state").startsWith("user."), "the sign-in mode travels in the state");
const formPage = await (await note(await call("/submit", { cookies: carol.session }))).text();
must(formPage.includes('name="url"') && formPage.includes('maxlength="200"') && !formPage.includes("maintainer"), "a signed-in submitter sees the form, as a plain user");
{
  const theirs = await (await note(await call("/submit?url=" + encodeURIComponent("https://github.com/alice/good"), { cookies: carol.session }))).text();
  must(theirs.includes("You do not own alice/good") && theirs.includes("your recommendation"), "before sending, someone who does not own the repository is told it will be listed as their recommendation");
  const blank = await (await note(await call("/submit", { cookies: carol.session }))).text();
  must(!blank.includes("You own ") && !blank.includes("You do not own"), "with no link there is no ownership line");
}

// ---- submitting
calls.length = 0;
let r = await submit(carol.session, "https://github.com/alice/good", "Used it daily, it saves me an hour a week.");
must(r.status === 303 && r.headers.get("Location") === "/profile?ok=1", `a good submission is accepted, got ${r.status}`);
must(pushes.length === 1 && pushes[0].title === "New kit submission" && pushes[0].body.includes("alice/good") && pushes[0].body.includes("@carol") && /\/admin\/submissions\/\d+$/.test(pushes[0].click) && !pushes[0].body.includes("saves me an hour"), "a submission from a member sends one push naming the repository and the person, never their note");
let row = rows()[0];
must(row.source === "recommended" && row.owner === "alice" && row.submitted_by === "carol" && row.license === "MIT" && row.kind_guess === "plugin" && row.commit_sha === SHA, "someone else's repository is a recommendation, with owner, licence, kind and commit read from GitHub");
must(row.readme_url === `https://github.com/alice/good/blob/${SHA}/README.md` && row.readme_excerpt.startsWith("A small tool that does things") && !/[<>@]/.test(row.readme_excerpt), "the README link is built by us and the excerpt is plain text");
must(row.why === "Used it daily, it saves me an hour a week." && row.precheck_status === "pass", "a recommender's note is kept; the quick check passes");
must(row.topics === "claude-code,agents,b-x-b", `GitHub topics become cleaned starting tags: ${row.topics}`);
must(calls.filter((c) => c.url.startsWith("https://api.github.com/repos/alice/good")).every((c) => c.auth === `Bearer ${TOKEN}`), "GitHub lookups use the server's read-only token");

const alice = await signIn("u-alice", "user");
r = await submit(alice.session, "https://github.com/alice/other", "this note is ignored for an author");
row = rows().find((x) => x.repo_key === "alice/other");
must(r.status === 303 && row.source === "community" && row.why === "", "the owner submitting their own repository is a community listing, and the note is not kept");
{
  const mine = await (await note(await call("/submit?url=" + encodeURIComponent("https://github.com/alice/other"), { cookies: alice.session }))).text();
  must(mine.includes("You own alice/other") && mine.includes("community kit"), "before sending, the owner is told it will be listed as a community kit, by them");
}

const bob = await signIn("u-bob", "user");
r = await submit(bob.session, "https://github.com/acme/tool");
row = rows().find((x) => x.repo_key === "acme/tool");
must(r.status === 303 && row.source === "community" && row.owner_type === "Organization", "a public member of the owning organisation counts as the author");
must(row.precheck_status === "fail" && JSON.parse(row.precheck).find((c) => c.title === "Licence").status === "fail", "no licence fails the quick check");
r = await submit(carol.session, "https://github.com/acme/tool");
must(r.status === 409, "the same repository cannot be pending twice");

r = await submit(carol.session, "https://github.com/someone/archived");
row = rows().find((x) => x.repo_key === "someone/archived");
must(r.status === 303 && row.precheck_status === "flag" && JSON.parse(row.precheck).some((c) => /archived/.test(c.note) && /fork/.test(c.note)), "an archived fork is flagged, not refused");

// ---- refused submissions store nothing
const before = rows().length;
for (const [label, url, why, status] of [
  ["not github", "https://gitlab.com/a/b", "", 400], ["http", "http://github.com/a/b", "", 400], ["userinfo", "https://github.com@evil.example/a/b", "", 400], ["no repo", "https://github.com/a", "", 400], ["javascript", "javascript:alert(1)", "", 400], ["junk", "hello", "", 400],
  ["too long", "https://github.com/a/" + "b".repeat(300), "", 400], ["long note", "https://github.com/alice/good", "x".repeat(201), 400],
  ["missing repo", "https://github.com/someone/missing", "", 422], ["private repo", "https://github.com/someone/private", "", 422], ["rate limited by GitHub", "https://github.com/busy/repo", "", 422], ["GitHub unreachable", "https://github.com/flaky/repo", "", 422],
  ["already listed", "https://github.com/listedowner/listed", "", 409],
]) {
  const res = await submit(carol.session, url, why);
  must(res.status === status && rows().length === before, `${label}: status ${res.status} (wanted ${status}) and nothing stored`);
}
{
  const t = await (await submit(carol.session, "https://github.com/busy/repo")).text();
  must(t.includes("GitHub is busy"), "a GitHub rate limit is explained plainly");
  must((await (await submit(carol.session, "https://github.com/flaky/repo")).text()).includes("could not be reached"), "a GitHub outage is explained plainly");
  must((await (await submit(carol.session, "https://github.com/someone/private")).text()).includes("Only public repositories"), "a private repository is explained plainly");
}
downMode = "5xx";
must((await submit(carol.session, "https://github.com/alice/good")).status !== 303 && rows().length === before, "a GitHub server error stores nothing");
downMode = "";

// ---- cross-site requests and tampering
must((await call("/submit", { method: "POST", cookies: carol.session, form: { url: "https://github.com/rate/r1" } })).status === 403, "a submission without an Origin header is refused");
must((await call("/submit", { method: "POST", cookies: carol.session, origin: "https://evil.example", form: { url: "https://github.com/rate/r1" } })).status === 403 && rows().length === before, "a submission from another origin is refused (CSRF)");

// ---- limits
const dave = await signIn("u-dave", "user");
for (let i = 1; i <= 5; i++) must((await submit(dave.session, `https://github.com/rate/r${i}`)).status === 303, `rate test submission ${i} is accepted`);
{
  const res = await submit(dave.session, "https://github.com/rate/r6");
  must(res.status === 429 && (await res.text()).includes("limit of 5") && !rows().some((x) => x.repo_key === "rate/r6"), "the sixth submission in a day is refused");
}

// ---- my submissions: only my own
{
  const mine = await (await note(await call("/profile", { cookies: carol.session }))).text();
  must(mine.includes(">good<") && mine.includes(">archived<") && !mine.includes(">other<") && !mine.includes(">r1<"), "/profile shows only the signed-in person's submissions");
  must((await (await call("/profile?ok=1", { cookies: alice.session })).text()).includes("waiting for review"), "the thank-you note shows after submitting");
}

// ---- the admin queue
const owner = await signIn("good-owner");
must(owner.cb.headers.get("Location") === "/admin", "the maintainer sign-in is unchanged");
{
  await submit(carol.session, "https://github.com/evil/name");
  const t = await (await note(await call("/admin", { cookies: owner.session }))).text();
  must(t.includes("New submissions (") && t.includes("alice/good") === false && t.includes(">good<") && t.includes("Community") === false, "the queue lists the new submissions");
  must(!t.includes("<img src=x onerror") && t.includes("&lt;img src=x onerror=alert(1)&gt;Bad"), "a repository name with markup is escaped in the queue");
  must(t.includes("Fail") && t.includes("Look closer") && t.includes("Pass"), "the queue shows the quick-check result");
  const id = rows().find((x) => x.repo_key === "alice/good").id;
  const d = await (await note(await call(`/admin/submissions/${id}`, { cookies: owner.session }))).text();
  must(d.includes(`https://github.com/alice/good/commit/${SHA}`) && d.includes(`https://github.com/alice/good/blob/${SHA}/README.md`) && d.includes("View the README on GitHub") && d.includes("Recommended (by someone else)") && d.includes("@carol") && d.includes("Used it daily"), "the detail page shows owner, source, commit, README link and the note");
  must(d.includes("A small tool that does things") && !/<img src=x|<script|javascript:|evil.example/.test(d), "the README excerpt is shown as plain text");
  must((await call("/admin/submissions/999999", { cookies: owner.session })).status === 404 && (await call("/admin/submissions/abc", { cookies: owner.session })).status === 404, "unknown or malformed ids are 404");
  must((await call(`/admin/submissions/${id}`, { cookies: carol.session })).status === 403 && (await call("/admin", { cookies: carol.session })).status === 403, "a plain submitter cannot see the queue or a submission");
  must((await (await call(`/admin/submissions/${id}`)).text()).includes("Sign in"), "signed out, the detail page asks for a sign-in");
}

// ---- no database yet: closed, not broken
{
  const e = { ...baseEnv() };
  must((await call("/submit", { cookies: carol.session, e })).status === 503 && (await call("/profile", { cookies: carol.session, e })).status === 503 && (await call("/submit", { method: "POST", cookies: carol.session, origin: OK, form: { url: "https://github.com/alice/good" }, e })).status === 503, "without a database, submitting is closed with a plain message");
  must((await call("/admin", { cookies: owner.session, e })).status === 200, "without a database, the admin page still works");
}

// ---- hygiene
const blob = everything.join("\n");
must(!blob.includes(TOKEN) && !blob.includes("csecret") && !blob.includes(SECRET) && !/tok-(alice|bob|carol|dave|owner)/.test(blob), "no token or secret appears in any response");
for (const t of everything) must(!/<script|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: submit form reads public repos, derives author vs recommender from GitHub, keeps plain-text README excerpts, enforces limits, and shows a review queue to maintainers only");
