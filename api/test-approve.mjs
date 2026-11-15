#!/usr/bin/env node
// Phase 3 tests: approve, reject, retry and direct publishing from the admin app. A fake GitHub (including
// workflow dispatch and run status) and a real SQLite database running api/schema.sql. No network.
// Run from the repo root: node api/test-approve.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { signToken, verifyToken } from "./src/lib/crypto.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return { raw: db, prepare(sql) { const st = db.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; } }; return api; } };
}

const SECRET = "s".repeat(40);
const READ = "ghp_readonlytoken_must_never_leak", DISPATCH = "github_pat_dispatch_secret_must_never_leak";
const D1 = makeD1();
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, GITHUB_TOKEN: READ, GITHUB_DISPATCH_TOKEN: DISPATCH, DB: D1 };
const OK = "https://admin.example.dev";

// ---- fake GitHub
const SHA = "a".repeat(40);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const USERS = { "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 }, "tok-owner": { login: "ratul", id: 111 } };
const CODES = { "u-carol": "tok-carol", "u-dave": "tok-dave", "good-owner": "tok-owner" };
const repoBody = (owner, name, over = {}) => ({ name, owner: { login: owner, type: "User" }, private: false, archived: false, fork: false, license: { spdx_id: "MIT" }, default_branch: "main", pushed_at: "2026-11-01T00:00:00Z", ...over });
const REPOS = {
  "alice/good": { body: repoBody("alice", "good"), tree: [".claude-plugin/plugin.json"], readme: "A small tool that does a useful thing for agents, described in a full sentence here." },
  "alice/second": { body: repoBody("alice", "second"), tree: ["SKILL.md"], readme: "A second tool by the same author, with enough words to make an excerpt." },
  "alice/third": { body: repoBody("alice", "third"), tree: ["SKILL.md"], readme: "A third tool, used to test blocked publishing and retries over here." },
  "alice/fourth": { body: repoBody("alice", "fourth"), tree: ["SKILL.md"], readme: "A fourth tool, used to test a publish job that never started at all." },
  "alice/fifth": { body: repoBody("alice", "fifth"), tree: ["SKILL.md"], readme: "A fifth tool, used to test dispatch failures from GitHub right here." },
  "alice/direct": { body: repoBody("alice", "direct"), tree: ["SKILL.md"], readme: "A tool submitted directly by a maintainer, published after the scan." },
  "alice/direct2": { body: repoBody("alice", "direct2"), tree: ["SKILL.md"], readme: "Another directly submitted tool, used with a stale maintainer sign-in." },
  "alice/unknown": { body: repoBody("alice", "unknown"), tree: ["notes.txt"], readme: "A repository whose files do not show what kind of kit it is at all." },
  "alice/nolicence": { body: repoBody("alice", "nolicence", { license: null }), tree: ["SKILL.md"], readme: "A repository with no licence, so the quick check fails for it." },
  "alice/xss": { body: repoBody("alice", "xss"), tree: ["SKILL.md"], readme: "A repository used to check that approved card text is shown escaped." },
  "alice/reject": { body: repoBody("alice", "reject"), tree: ["SKILL.md"], readme: "A repository that will be rejected with a reason the submitter sees." },
};
let LISTED = []; // repository urls in the fake live catalogue
let RUNS = [];
let dispatchMode = "ok";
const dispatches = [];
const scanDispatches = [];
let SCAN_RUNS = [];
const JOBS = {};
let scanDispatchMode = "ok";
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const auth = String(init.headers?.Authorization ?? "");
  const bearer = auth.replace("Bearer ", "");
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.origin !== "https://api.github.com") return json({}, 404);
  const p = u.pathname;
  if (p === "/user") return USERS[bearer] ? json(USERS[bearer]) : json({}, 401);
  if (p === "/user/memberships/orgs/praxikit") return bearer === "tok-owner" ? json({ state: "active", role: "admin" }) : json({}, 404);
  if (p === "/user/teams") return json([]);
  if (p.startsWith("/orgs/")) return new Response(null, { status: 404 });
  if (p === "/repos/praxikit/praxikit/contents/site/listings.json") return new Response(JSON.stringify(LISTED.map((url) => ({ url }))), { status: 200 });
  if (p === "/repos/praxikit/praxikit/issues") return json([]);
  if (p === "/repos/praxikit/praxikit/actions/workflows/approve-submission.yml/dispatches" && init.method === "POST") {
    dispatches.push({ auth, body: JSON.parse(init.body) });
    return dispatchMode === "ok" ? new Response(null, { status: 204 }) : json({ message: "Resource not accessible" }, 403);
  }
  if (p === "/repos/praxikit/praxikit/actions/workflows/scan-submission.yml/dispatches" && init.method === "POST") {
    scanDispatches.push({ auth, body: JSON.parse(init.body) });
    return scanDispatchMode === "ok" ? new Response(null, { status: 204 }) : json({ message: "Resource not accessible" }, 403);
  }
  if (p === "/repos/praxikit/praxikit/actions/workflows/scan-submission.yml/runs") return json({ workflow_runs: SCAN_RUNS });
  const jobsMatch = /^\/repos\/praxikit\/praxikit\/actions\/runs\/(\d+)\/jobs$/.exec(p);
  if (jobsMatch) return json({ jobs: JOBS[jobsMatch[1]] ?? [] });
  if (p === "/repos/praxikit/praxikit/actions/workflows/approve-submission.yml/runs") return json({ workflow_runs: RUNS });
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
const setCookies = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) => { const c = setCookies(res).find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
const everything = [];
const note = async (res) => { everything.push(await res.clone().text(), [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")); return res; };
async function signIn(code, mode) {
  const login = await call(mode ? `/auth/login?mode=${mode}` : "/auth/login");
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const cb = await note(await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } }));
  return { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") };
}
const sessionWithAge = (ageMinutes) => signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", iat: Date.now() - ageMinutes * 60000, exp: Date.now() + 3600000 }, SECRET).then((t) => ({ "__Host-praxikit-session": t }));
const rows = () => D1.raw.prepare("SELECT * FROM submissions ORDER BY id").all();
const byKey = (k) => rows().find((r) => r.repo_key === k);
const submit = async (session, url, why = "") => note(await call("/submit", { method: "POST", cookies: session, origin: OK, form: { url, why } }));
const act = async (session, id, what, form = {}, extra = {}) => note(await call(`/admin/submissions/${id}/${what}`, { method: "POST", cookies: session, origin: OK, form, ...extra }));
const approveForm = (over = {}) => ({ name: "Good kit", kind: "plugin", text: "Does a useful thing for agents.", ...over });

let runSeq = 7000;
/** Pretends the scan job finished. The result is carried by the result job's name. */
const finishScan = async (id, { label = "no-flags-found", commit = SHA.slice(0, 12), conclusion = "success", jobName } = {}) => {
  const runId = ++runSeq;
  SCAN_RUNS = SCAN_RUNS.filter((r) => r.display_title !== `scan #${id}`).concat([{ id: runId, display_title: `scan #${id}`, status: "completed", conclusion, created_at: new Date().toISOString() }]);
  JOBS[runId] = [{ name: "scan" }, { name: jobName ?? `result ${label} ${commit}` }];
  await call(`/admin/submissions/${id}`, { cookies: owner });
  return runId;
};
const runScan = async (id, opts) => { const r = await act(owner, id, "scan"); await finishScan(id, opts); return r; };

const owner = await signIn("good-owner");
const carol = await signIn("u-carol", "user");
const dave = await signIn("u-dave", "user"); // carol reaches her daily limit of five submissions, so later cases use dave
must((await verifyToken(owner["__Host-praxikit-session"], SECRET)).iat > 0, "a new session records when it was issued");

// ---- a submission to work on
await submit(carol, "https://github.com/alice/good", "Used it for weeks.");
const good = byKey("alice/good");
const detail = await (await note(await call(`/admin/submissions/${good.id}`, { cookies: owner }))).text();
must(detail.includes('action="/admin/submissions/' + good.id + '/approve"') && detail.includes('value="Good"') === false && detail.includes('name="name"') && detail.includes('<option value="plugin" selected>') && detail.includes("Used it for weeks."), "the detail page offers Approve with name, type (preselected from the guess) and the card text");
must(detail.includes('action="/admin/submissions/' + good.id + '/reject"') && detail.includes("Reject"), "and a Reject form");
must(detail.includes("Run the full checks") && detail.includes("Not run yet") && /<button type="submit" disabled>Approve and publish/.test(detail), "before the checks have run, Approve is switched off and the page says to run them");

// ---- who may decide, and how
const noToken = { ...env }; delete noToken.GITHUB_DISPATCH_TOKEN;
let r = await act(owner, good.id, "approve", approveForm(), { e: noToken });
must(r.status === 303 && r.headers.get("Location").endsWith("?m=nopublish") && byKey("alice/good").status === "pending" && dispatches.length === 0, "with no dispatch token, approving is refused and nothing changes");
r = await act(await sessionWithAge(31), good.id, "approve", approveForm());
must(r.status === 401 && (await r.text()).includes("sign in again") && byKey("alice/good").status === "pending", "a sign-in older than 30 minutes cannot approve");
r = await act(carol, good.id, "approve", approveForm());
must(r.status === 403 && byKey("alice/good").status === "pending", "a plain user cannot approve");
r = await act({}, good.id, "approve", approveForm());
must(r.status === 401 && byKey("alice/good").status === "pending", "signed out, approving is refused");
r = await call(`/admin/submissions/${good.id}/approve`, { method: "POST", cookies: owner, form: approveForm() });
must(r.status === 403, "approving without an Origin header is refused");
r = await call(`/admin/submissions/${good.id}/approve`, { method: "POST", cookies: owner, origin: "https://evil.example", form: approveForm() });
must(r.status === 403 && byKey("alice/good").status === "pending", "approving from another origin is refused (CSRF)");
must((await call(`/admin/submissions/${good.id}/approve`, { cookies: owner })).status === 404, "approve is not available as a GET");
for (const [label, over] of [["bad type", { kind: "malware" }], ["empty name", { name: "  " }], ["long name", { name: "n".repeat(81) }], ["empty text", { text: "" }], ["long text", { text: "t".repeat(401) }]]) {
  r = await act(owner, good.id, "approve", approveForm(over));
  must(r.headers.get("Location").endsWith("?m=bad") && byKey("alice/good").status === "pending" && dispatches.length === 0, `${label} is refused and nothing changes`);
}

// ---- approving
// ---- the full checks come first
r = await act(owner, good.id, "approve", approveForm());
must(r.headers.get("Location").endsWith("?m=needscan") && byKey("alice/good").status === "pending" && dispatches.length === 0, "approving before the checks have run is refused");
for (const [label, who, extra] of [["a plain user", carol, {}], ["a stale sign-in", await sessionWithAge(31), {}], ["no Origin", owner, { origin: "" }]]) {
  const res = label === "no Origin" ? await call(`/admin/submissions/${good.id}/scan`, { method: "POST", cookies: who }) : await act(who, good.id, "scan");
  must([401, 403].includes(res.status) && scanDispatches.length === 0 && byKey("alice/good").scan_state === "", `${label} cannot start the checks`);
}
{
  const e = { ...env }; delete e.GITHUB_DISPATCH_TOKEN;
  must((await act(owner, good.id, "scan", {}, { e })).headers.get("Location").endsWith("?m=nopublish") && scanDispatches.length === 0, "with no token the checks cannot be started");
}
scanDispatchMode = "forbidden";
r = await act(owner, good.id, "scan");
must(r.headers.get("Location").endsWith("?m=scanfail") && byKey("alice/good").scan_state === "failed", "if GitHub refuses to start the checks, the state says so and they can be run again");
scanDispatchMode = "ok";
r = await act(owner, good.id, "scan");
must(r.headers.get("Location").endsWith("?m=scanstarted") && byKey("alice/good").scan_state === "running" && scanDispatches.length === 2, "starting the checks marks them running");
must(scanDispatches.at(-1).auth === `Bearer ${DISPATCH}` && scanDispatches.at(-1).body.inputs.submission_id === String(good.id) && scanDispatches.at(-1).body.inputs.url === "https://github.com/alice/good" && Object.keys(scanDispatches.at(-1).body.inputs).length === 2, "the check job gets only the submission number and the repository link");
r = await act(owner, good.id, "scan");
must(r.headers.get("Location").endsWith("?m=scanning") && scanDispatches.length === 2, "asking again while they run does not start a second job");
// a finished run from before this request must not answer for it
SCAN_RUNS = [{ id: 6999, display_title: `scan #${good.id}`, status: "completed", conclusion: "success", created_at: new Date(Date.now() - 3600_000).toISOString() }]; JOBS[6999] = [{ name: "result no-flags-found aaaaaaaaaaaa" }];
await call(`/admin/submissions/${good.id}`, { cookies: owner });
must(byKey("alice/good").scan_state === "running", "an older run for the same submission does not answer for a new request");
SCAN_RUNS = [{ id: 7000, display_title: `scan #${good.id}`, status: "in_progress", conclusion: null, created_at: new Date().toISOString() }];
await call(`/admin/submissions/${good.id}`, { cookies: owner });
must(byKey("alice/good").scan_state === "running", "a run still in progress leaves it running");
await finishScan(good.id, { label: "checks-flagged" });
const scanRow = byKey("alice/good");
must(scanRow.scan_state === "done" && scanRow.scan_label === "checks-flagged" && scanRow.scan_commit === SHA.slice(0, 12) && scanRow.scan_run_url.startsWith("https://github.com/praxikit/praxikit/actions/runs/"), "a finished run is read from its result job: label, commit and the report link");
{
  const t2 = await (await note(await call(`/admin/submissions/${good.id}`, { cookies: owner }))).text();
  must(t2.includes("found things to look at") && t2.includes("Open the full report") && t2.includes('name="read"') && !/<button type="submit" disabled>Approve and publish/.test(t2), "a flagged result shows the report link and a read-it box, and unlocks Approve");
}
r = await act(owner, good.id, "approve", approveForm());
must(r.headers.get("Location").endsWith("?m=needread") && byKey("alice/good").status === "pending" && dispatches.length === 0, "a flagged result cannot be approved without confirming the report was read");
r = await act(owner, good.id, "approve", approveForm({ name: "Edited name", kind: "skill", text: "<script>alert(1)</script> Edited card text.", read: "yes" }));
must(r.status === 303 && r.headers.get("Location").endsWith("?m=approved"), `a valid approval is accepted, got ${r.status} ${r.headers.get("Location")}`);
let row = byKey("alice/good");
must(row.status === "approved" && row.decided_by === "ratul" && row.final_name === "Edited name" && row.final_kind === "skill" && row.final_text.includes("Edited card text") && row.publish_state === "dispatched", "the decision records who, and what the maintainer confirmed (not what the submitter guessed)");
must(dispatches.length === 1 && dispatches[0].auth === `Bearer ${DISPATCH}`, "the publish job is started once, with the dedicated token (not the read-only one)");
{
  const d = dispatches[0].body;
  must(d.ref === "main" && d.inputs.submission_id === String(good.id) && d.inputs.url === "https://github.com/alice/good" && d.inputs.name === "Edited name" && d.inputs.kind === "skill" && d.inputs.source === "recommended" && d.inputs.author === "alice" && d.inputs.why.includes("Edited card text") && d.inputs.decided_by === "ratul" && d.inputs.expected_commit === SHA.slice(0, 12) && d.inputs.require_clean === "false" && !("allow_failed" in d.inputs), "the workflow gets exactly the confirmed fields, pinned to the commit whose checks were read, and no way to skip the scan");
}
r = await act(owner, good.id, "approve", approveForm());
must(r.headers.get("Location").endsWith("?m=already") && dispatches.length === 1, "approving twice is refused and does not start a second job");
r = await act(owner, good.id, "reject", { note: "changed my mind" });
must(r.headers.get("Location").endsWith("?m=already") && byKey("alice/good").status === "approved", "an approved submission cannot then be rejected");

// ---- following the publish job
RUNS = [{ id: 9001, display_title: `approve #${good.id}`, status: "in_progress", conclusion: null, created_at: "2026-11-15T10:00:00Z" }];
await call("/admin", { cookies: owner });
must(byKey("alice/good").publish_state === "dispatched", "a job still running leaves the state alone");
RUNS = [{ id: 9001, display_title: `approve #${good.id}`, status: "completed", conclusion: "success", created_at: "2026-11-15T10:00:00Z" }];
await call("/admin", { cookies: owner });
must(byKey("alice/good").publish_state === "dispatched", "a finished job whose listing is not live yet is checked again later");
LISTED = ["https://github.com/alice/good"];
const adminHtml = await (await note(await call("/admin", { cookies: owner }))).text();
must(byKey("alice/good").publish_state === "listed" && adminHtml.includes("Recently decided") && adminHtml.includes("Listed. It is on the catalogue."), "a finished job whose listing is live becomes Listed");
must(!adminHtml.includes("<script>alert(1)</script>") && (await (await call(`/admin/submissions/${good.id}`, { cookies: owner })).text()).includes("&lt;script&gt;alert(1)&lt;/script&gt; Edited card text."), "card text is shown escaped");
must((await (await call("/mine", { cookies: carol })).text()).includes("Listed"), "the submitter sees that it is listed");

// ---- blocked jobs and retry
await submit(carol, "https://github.com/alice/third");
const third = byKey("alice/third");
await runScan(third.id);
await act(owner, third.id, "approve", approveForm({ name: "Third" }));
RUNS = [{ id: 9002, display_title: `approve #${third.id}`, status: "completed", conclusion: "failure", created_at: "2026-11-15T11:00:00Z" }];
const blockedHtml = await (await note(await call(`/admin/submissions/${third.id}`, { cookies: owner }))).text();
row = byKey("alice/third");
must(row.publish_state === "blocked" && row.publish_note.includes("https://github.com/praxikit/praxikit/actions/runs/9002") && blockedHtml.includes("Try publishing again"), "a failed job is Blocked, links to its run, and offers a retry");
must((await (await call("/mine", { cookies: carol })).text()).includes("stopped it"), "the submitter is told it was held up, without details");
r = await act(owner, third.id, "retry");
must(r.headers.get("Location").endsWith("?m=retried") && dispatches.length === 3 && byKey("alice/third").publish_state === "dispatched", "retry starts the job again");
r = await act(owner, third.id, "retry");
must(r.headers.get("Location").endsWith("?m=already") && dispatches.length === 3, "retry only works on a blocked submission");
r = await act(carol, third.id, "retry");
must(r.status === 403, "a plain user cannot retry");

// ---- a job that was never started
await submit(carol, "https://github.com/alice/fourth");
const fourth = byKey("alice/fourth");
await runScan(fourth.id);
await act(owner, fourth.id, "approve", approveForm({ name: "Fourth" }));
D1.raw.prepare("UPDATE submissions SET publish_state = 'dispatching', decided_at = ? WHERE id = ?").run(new Date(Date.now() - 5 * 60000).toISOString(), fourth.id);
await call("/admin", { cookies: owner });
must(byKey("alice/fourth").publish_state === "blocked" && /never started/.test(byKey("alice/fourth").publish_note), "a job the app never managed to start is reported, not left spinning");
D1.raw.prepare("UPDATE submissions SET publish_state = 'dispatched', decided_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * 60000).toISOString(), fourth.id);
RUNS = [];
await call("/admin", { cookies: owner });
must(byKey("alice/fourth").publish_state === "blocked" && /did not start/.test(byKey("alice/fourth").publish_note), "a job that never appears on GitHub is reported after a while");

// ---- GitHub refusing to start the job
await submit(carol, "https://github.com/alice/fifth");
const fifth = byKey("alice/fifth");
dispatchMode = "forbidden";
await runScan(fifth.id);
r = await act(owner, fifth.id, "approve", approveForm({ name: "Fifth" }));
row = byKey("alice/fifth");
must(r.headers.get("Location").endsWith("?m=failed") && row.status === "approved" && row.publish_state === "blocked" && /token|permission/.test(row.publish_note) && !row.publish_note.includes(DISPATCH), "if GitHub refuses, the submission is Blocked with a plain reason and a retry is offered");
dispatchMode = "ok";
r = await act(owner, fifth.id, "retry");
must(r.headers.get("Location").endsWith("?m=retried") && byKey("alice/fifth").publish_state === "dispatched", "after fixing the cause, retry works");

// ---- rejecting
await submit(carol, "https://github.com/alice/reject");
const rej = byKey("alice/reject");
for (const note_ of ["", "x".repeat(301)]) {
  r = await act(owner, rej.id, "reject", { note: note_ });
  must(r.headers.get("Location").endsWith("?m=bad") && byKey("alice/reject").status === "pending", "a rejection needs a reason of 1 to 300 characters");
}
r = await act(carol, rej.id, "reject", { note: "I am not a maintainer" });
must(r.status === 403 && byKey("alice/reject").status === "pending", "a plain user cannot reject");
r = await act(owner, rej.id, "reject", { note: "No licence file yet. Add one and submit again." });
row = byKey("alice/reject");
must(r.headers.get("Location").endsWith("?m=rejected") && row.status === "rejected" && row.decided_by === "ratul" && row.decision_note.startsWith("No licence file yet"), "a rejection records who and why");
must((await (await call("/mine", { cookies: carol })).text()).includes("Not listed: No licence file yet. Add one and submit again."), "the submitter sees the reason");
r = await act(owner, rej.id, "reject", { note: "again" });
must(r.headers.get("Location").endsWith("?m=already"), "rejecting twice is refused");
await submit(dave, "https://github.com/alice/reject");
must(rows().filter((x) => x.repo_key === "alice/reject").length === 2, "after a rejection the same repository can be submitted again");

// ---- a maintainer's own submission is published directly
const before = dispatches.length;
r = await submit(owner, "https://github.com/alice/direct");
row = byKey("alice/direct");
must(r.headers.get("Location") === "/mine?ok=direct" && row.status === "approved" && row.decided_by === "ratul" && row.final_kind === "skill" && row.publish_state === "dispatched" && dispatches.length === before + 1 && dispatches.at(-1).body.inputs.decided_by === "ratul" && dispatches.at(-1).body.inputs.require_clean === "true" && dispatches.at(-1).body.inputs.expected_commit === "", "a maintainer's submission is approved and sent to the publish job directly");
must((await (await call("/mine?ok=direct", { cookies: owner })).text()).includes("being published now"), "and says so");
const held = [["a stale sign-in", await sessionWithAge(31), "https://github.com/alice/direct2"], ["no recognisable type", owner, "https://github.com/alice/unknown"], ["a failed quick check", owner, "https://github.com/alice/nolicence"]];
for (const [label, who, url] of held) {
  const n = dispatches.length;
  r = await submit(who, url);
  const key = url.replace("https://github.com/", "");
  must(r.headers.get("Location") === "/mine?ok=held" && byKey(key).status === "pending" && dispatches.length === n, `${label}: held for review, not published`);
}
{
  const n = dispatches.length;
  const e = { ...env }; delete e.GITHUB_DISPATCH_TOKEN;
  await note(await call("/submit", { method: "POST", cookies: owner, origin: OK, form: { url: "https://github.com/alice/xss" }, e }));
  must(byKey("alice/xss").status === "pending" && dispatches.length === n, "without a dispatch token a maintainer's submission is held, not lost");
}
must(byKey("alice/direct") && (await submit(dave, "https://github.com/alice/second")).headers.get("Location") === "/mine?ok=1" && byKey("alice/second").status === "pending", "an ordinary submitter's submission is never published directly");

// ---- a retry keeps the pin; a direct publish stays clean-only
{
  await act(owner, third.id, "retry");
  D1.raw.prepare("UPDATE submissions SET publish_state = 'blocked' WHERE id = ?").run(byKey("alice/direct").id);
  await act(owner, byKey("alice/direct").id, "retry");
  must(dispatches.at(-1).body.inputs.require_clean === "true" && dispatches.at(-1).body.inputs.expected_commit === "", "retrying a direct publish keeps it clean-only");
  D1.raw.prepare("UPDATE submissions SET publish_state = 'blocked' WHERE id = ?").run(third.id);
  await act(owner, third.id, "retry");
  must(dispatches.at(-1).body.inputs.expected_commit === SHA.slice(0, 12) && dispatches.at(-1).body.inputs.require_clean === "false", "retrying an approval keeps the pin to the commit whose checks were read");
}

// ---- back to review: a blocked direct publish goes through the normal path
{
  const id = byKey("alice/direct").id;
  D1.raw.prepare("UPDATE submissions SET publish_state = 'blocked', publish_note = 'The publish job stopped.' WHERE id = ?").run(id);
  const page = await (await call(`/admin/submissions/${id}`, { cookies: owner })).text();
  must(page.includes("Back to review") && page.includes("Try publishing again"), "a blocked publish offers both a retry and a way back to review");
  must((await act(carol, id, "reopen")).status === 403 && byKey("alice/direct").status === "approved", "a plain user cannot reopen");
  const r2 = await act(owner, id, "reopen");
  row = byKey("alice/direct");
  must(r2.headers.get("Location").endsWith("?m=reopened") && row.status === "pending" && row.publish_state === "" && row.decided_by === "", "reopening puts it back in review");
  must((await act(owner, id, "reopen")).headers.get("Location").endsWith("?m=already"), "only a blocked publish can be reopened");
  must((await act(owner, id, "approve", approveForm())).headers.get("Location").endsWith("?m=needscan"), "after reopening, the checks must be run before approving");
}

// ---- checks that fail, cannot be read, or did not finish
{
  const nonok = [["failed", { label: "checks-failed" }], ["could not be read", { label: "needs-manual-review", commit: "none" }]];
  await submit(dave, "https://github.com/alice/xss");
  const id = byKey("alice/xss").id;
  for (const [label, opts] of nonok) {
    await runScan(id, opts);
    must(byKey("alice/xss").scan_state === "done" && (await act(owner, id, "approve", approveForm())).headers.get("Location").endsWith("?m=needscan"), `a scan that ${label} cannot be approved`);
  }
  await runScan(id, { conclusion: "failure" });
  must(byKey("alice/xss").scan_state === "failed", "a check job that crashed is reported as not finished");
  await runScan(id, { jobName: "result looks-great ../../etc" });
  must(byKey("alice/xss").scan_state === "failed", "a result job name that is not exactly what we expect is not trusted");
  await runScan(id, { label: "no-flags-found" });
  must(byKey("alice/xss").scan_label === "no-flags-found" && !(await (await call(`/admin/submissions/${id}`, { cookies: owner })).text()).includes('name="read"'), "a clean result needs no read-it box");
}

// ---- flashes are fixed strings, never echoed
{
  const t = await (await note(await call(`/admin/submissions/${good.id}?m=%3Cscript%3Ealert(1)%3C/script%3E`, { cookies: owner }))).text();
  must(!t.includes("<script>alert(1)</script>") && !t.includes("%3Cscript") && !t.includes('class="ok"'), "an unknown message key shows nothing and echoes nothing");
  must((await (await call(`/admin?m=approved`, { cookies: owner })).text()).includes("Approved. The publish job has started"), "a known message key shows its fixed text");
}

// ---- hygiene
const blob = everything.join("\n");
must(!blob.includes(DISPATCH) && !blob.includes(READ) && !blob.includes("csecret") && !blob.includes(SECRET) && !/tok-(carol|owner)/.test(blob), "no token or secret appears in any response");
for (const t of everything) must(!/<script|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: maintainers approve, reject and retry from the app with fresh sign-ins and fixed inputs; the app only starts the publish workflow; blocked, never-started and refused jobs are reported; maintainer submissions publish directly");
