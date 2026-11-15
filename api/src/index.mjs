/**
 * Praxikit admin API (Cloudflare Worker, no dependencies).
 *
 * Phase 1: sign in with GitHub; owners of the org and members of its maintainers team may maintain
 *          the catalogue. Phase 2: anyone signed in can submit a public repository; the app reads it
 *          from GitHub and keeps the submission in D1 for maintainers to review.
 * The pages live on this origin, so the session cookie is first-party and SameSite=Lax is enough.
 *
 * Config (wrangler.toml vars, plus secrets set with `wrangler secret put`):
 *   BASE_URL, ORG, TEAM, REPO, GITHUB_CLIENT_ID    plain values
 *   GITHUB_CLIENT_SECRET, SESSION_SECRET           secrets (SESSION_SECRET: 32+ random characters)
 *   GITHUB_TOKEN                                   optional secret: a read-only token for public data, which
 *                                                  raises GitHub's rate limit (strongly advised once people submit)
 *   DB                                             the D1 binding (see schema.sql); without it submissions are closed
 */
import { signToken, verifyToken, randomToken, safeEqual, parseCookies, cookie } from "./lib/crypto.mjs";
import { authorizeUrl, exchangeCode, getUser, decideRole, listPending } from "./lib/github.mjs";
import { parseRepo, fetchRepoInfo, isAuthor, alreadyListed, precheck, UserError } from "./lib/repo.mjs";
import { storeFor } from "./lib/store.mjs";
import { dispatchApprove, dispatchScan, syncPublishing, syncScans, publishingConfigured } from "./lib/publish.mjs";
import { CSS, signInPage, messagePage, adminPage, submitPage, minePage, detailPage, FLASH } from "./lib/html.mjs";

const SESSION_COOKIE = "__Host-praxikit-session";
const STATE_COOKIE = "__Host-praxikit-state";
const SESSION_SECONDS = 4 * 60 * 60; // short on purpose: a removed maintainer loses access within hours
const STATE_SECONDS = 10 * 60;
const SUBMISSIONS_PER_DAY = 5, SUBMISSIONS_PER_DAY_MAINTAINER = 30;
const FRESH_MS = 30 * 60 * 1000; // approving, rejecting and publishing need a sign-in from the last 30 minutes
const KINDS = ["plugin", "skill", "mcp", "template", "adapter", "agent", "hook"];

const HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src https://avatars.githubusercontent.com; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin", // "no-referrer" makes browsers send "Origin: null" on same-origin form posts
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function send(body, { status = 200, type = "text/html; charset=utf-8", cookies = [], location, cache = "no-store" } = {}) {
  const h = new Headers({ ...HEADERS, "Content-Type": type, "Cache-Control": cache });
  if (location) h.set("Location", location);
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(body, { status, headers: h });
}

/** Missing or weak configuration is reported plainly, never with a value. */
function configProblem(env) {
  for (const k of ["BASE_URL", "ORG", "TEAM", "REPO", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET"]) if (!env[k] || String(env[k]).startsWith("REPLACE")) return `${k} is not set`;
  if (String(env.SESSION_SECRET).length < 32) return "SESSION_SECRET must be at least 32 characters";
  try { const u = new URL(env.BASE_URL); if (u.protocol !== "https:" && u.hostname !== "localhost") return "BASE_URL must be https"; } catch { return "BASE_URL is not a valid URL"; }
  return "";
}

async function sessionOf(request, env) {
  const raw = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  const s = raw ? await verifyToken(raw, env.SESSION_SECRET) : null;
  return s && typeof s.sub === "string" && Number.isInteger(s.id) && (s.role === "admin" || s.role === "user") ? s : null;
}

/** State-changing requests must come from this app's own origin. */
function sameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (origin === new URL(env.BASE_URL).origin) return true;
  // some browsers send "Origin: null" or none on same-origin form posts; Sec-Fetch-Site cannot be set by a web page
  return (origin === null || origin === "null") && request.headers.get("Sec-Fetch-Site") === "same-origin";
}

const fresh = (s) => Number.isFinite(s?.iat) && Date.now() - s.iat < FRESH_MS;
const back = (path, code) => send("", { status: 303, location: code ? `${path}?m=${code}` : path });
const flashOf = (url) => FLASH[url.searchParams.get("m")] ?? "";
const listed = (env) => (key) => alreadyListed(env, key);

/** Approving, rejecting, retrying: maintainers only, from this site, with a recent sign-in. Returns a Response to stop, or null to go on. */
function gate(request, env, s) {
  if (!s) return send(signInPage(), { status: 401 });
  if (s.role !== "admin") return send(messagePage("No access", "Only maintainers can do that.", false), { status: 403 });
  if (!sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
  if (!fresh(s)) return send(signInPage("For safety, sign in again to confirm this action (your sign-in is older than 30 minutes)."), { status: 401 });
  return null;
}

/** Start the publish job for an approved row and record whether GitHub accepted it. Returns "dispatched" or "blocked". */
async function startPublish(env, store, row) {
  try { await dispatchApprove(env, row); await store.setPublish(row.id, "dispatched"); return "dispatched"; }
  catch (e) { await store.setPublish(row.id, "blocked", e instanceof UserError ? e.message : "The publish job could not be started."); return "blocked"; }
}

const oneLine = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

async function submit(request, env, session) {
  const store = storeFor(env);
  if (!store) return send(messagePage("Submissions are not open yet", "This app has no database connected yet.", false), { status: 503 });
  if (!sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return send(messagePage("Too large", "That submission is too large.", false), { status: 413 });

  let url = "", why = "";
  try { const f = await request.formData(); url = String(f.get("url") ?? "").trim(); why = String(f.get("why") ?? ""); } catch { return send(submitPage({ session, error: "That form could not be read. Try again." }), { status: 400 }); }
  const values = { url: url.slice(0, 200), why: oneLine(why, 200) };
  const fail = (error, status = 400) => send(submitPage({ session, error, values }), { status });

  if (url.length > 200) return fail("That link is too long.");
  if (oneLine(why, 1000).length > 200) return fail("The note is longer than 200 characters.");
  const repo = parseRepo(url);
  if (!repo) return fail("Paste a link like https://github.com/owner/repo. Only public GitHub repositories can be submitted.");

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const limit = session.role === "admin" ? SUBMISSIONS_PER_DAY_MAINTAINER : SUBMISSIONS_PER_DAY;
  if ((await store.countSince(session.id, since)) >= limit) return fail(`You have reached the limit of ${limit} submissions in 24 hours. Try again tomorrow.`, 429);
  if (await alreadyListed(env, repo.key)) return fail("That repository is already in the catalogue.", 409);

  let info;
  try { info = await fetchRepoInfo(env, repo); } catch (e) { return fail(e instanceof UserError ? e.message : "That repository could not be read. Try again later.", e instanceof UserError ? 422 : 502); }

  const author = await isAuthor(env, info, session.sub);
  const source = author ? "community" : "recommended";
  const pre = precheck(info);
  let newId;
  try {
    newId = await store.insert({
      repo_url: repo.url, repo_key: repo.key, name: info.name, owner: info.owner, owner_type: info.ownerType, submitted_by: session.sub, submitted_by_id: session.id,
      source, kind_guess: info.kind, license: info.license, commit_sha: info.commit, readme_url: info.readmeUrl, readme_excerpt: info.excerpt,
      why: source === "recommended" ? values.why : "", precheck: JSON.stringify(pre.checks), precheck_status: pre.status, created_at: new Date().toISOString(),
    });
  } catch (e) {
    if (String(e?.message) === "duplicate") return fail("That repository is already waiting for review.", 409);
    throw e;
  }
  // a maintainer's own submission is published directly, after the same scan. It is held for review if it cannot be.
  if (session.role === "admin") {
    const text = oneLine(source === "recommended" && values.why ? values.why : info.excerpt || `${info.name} by ${info.owner}`, 400);
    if (fresh(session) && info.kind && pre.status !== "fail" && publishingConfigured(env) && (await store.approve(newId, { by: session.sub, name: oneLine(info.name, 80), kind: info.kind, text, at: new Date().toISOString() }))) {
      await startPublish(env, store, { id: newId, repo_url: repo.url, source, owner: info.owner, final_name: oneLine(info.name, 80), final_kind: info.kind, final_text: text, decided_by: session.sub });
      return send("", { status: 303, location: "/mine?ok=direct" });
    }
    return send("", { status: 303, location: "/mine?ok=held" });
  }
  return send("", { status: 303, location: "/mine?ok=1" });
}

async function approveRoute(request, env, s, id) {
  const stop = gate(request, env, s); if (stop) return stop;
  const store = storeFor(env); const base = `/admin/submissions/${id}`;
  if (!store) return send(messagePage("Not available", "This app has no database connected.", false), { status: 503 });
  if (!publishingConfigured(env)) return back(base, "nopublish");
  let f; try { f = await request.formData(); } catch { return back(base, "bad"); }
  const name = oneLine(f.get("name"), 100), kind = String(f.get("kind") ?? ""), text = oneLine(f.get("text"), 500);
  const pick = f.get("pick") === "yes", pickNote = pick ? oneLine(f.get("pick_note"), 300) : "";
  if (!name || name.length > 80 || !KINDS.includes(kind) || !text || text.length > 400 || (pick && (!pickNote || pickNote.length > 200))) return back(base, "bad");
  const row = await store.get(id);
  if (!row || row.status !== "pending") return back(base, "already");
  // approving needs the full checks to have run, on a commit we can pin the listing to
  if (row.scan_state !== "done" || !/^[0-9a-f]{12}$/.test(String(row.scan_commit)) || !["no-flags-found", "checks-flagged"].includes(row.scan_label)) return back(base, "needscan");
  if (row.scan_label === "checks-flagged" && f.get("read") !== "yes") return back(base, "needread");
  if (!(await store.approve(id, { by: s.sub, name, kind, text, at: new Date().toISOString(), pick, note: pickNote }))) return back(base, "already");
  const state = await startPublish(env, store, { ...row, final_name: name, final_kind: kind, final_text: text, final_pick: pick ? 1 : 0, final_note: pickNote, decided_by: s.sub });
  return back(base, state === "dispatched" ? "approved" : "failed");
}

async function rejectRoute(request, env, s, id) {
  const stop = gate(request, env, s); if (stop) return stop;
  const store = storeFor(env); const base = `/admin/submissions/${id}`;
  if (!store) return send(messagePage("Not available", "This app has no database connected.", false), { status: 503 });
  let f; try { f = await request.formData(); } catch { return back(base, "bad"); }
  const note = oneLine(f.get("note"), 400);
  if (!note || note.length > 300) return back(base, "bad");
  return back(base, (await store.reject(id, { by: s.sub, note, at: new Date().toISOString() })) ? "rejected" : "already");
}

async function scanRoute(request, env, s, id) {
  const stop = gate(request, env, s); if (stop) return stop;
  const store = storeFor(env); const base = `/admin/submissions/${id}`;
  if (!store) return send(messagePage("Not available", "This app has no database connected.", false), { status: 503 });
  if (!publishingConfigured(env)) return back(base, "nopublish");
  const row = await store.get(id);
  if (!row || row.status !== "pending") return back(base, "already");
  if (row.scan_state === "running") return back(base, "scanning");
  const at = new Date().toISOString();
  await store.setScan(id, { state: "running", at });
  try { await dispatchScan(env, row); } catch { await store.setScan(id, { state: "failed", at }); return back(base, "scanfail"); }
  return back(base, "scanstarted");
}

async function reopenRoute(request, env, s, id) {
  const stop = gate(request, env, s); if (stop) return stop;
  const store = storeFor(env); const base = `/admin/submissions/${id}`;
  if (!store) return send(messagePage("Not available", "This app has no database connected.", false), { status: 503 });
  try { return back(base, (await store.reopen(id)) ? "reopened" : "already"); } catch (e) { if (/UNIQUE/i.test(String(e?.message))) return back(base, "already"); throw e; }
}

async function retryRoute(request, env, s, id) {
  const stop = gate(request, env, s); if (stop) return stop;
  const store = storeFor(env); const base = `/admin/submissions/${id}`;
  if (!store) return send(messagePage("Not available", "This app has no database connected.", false), { status: 503 });
  if (!publishingConfigured(env)) return back(base, "nopublish");
  if (!(await store.retry(id))) return back(base, "already");
  const row = await store.get(id);
  const state = await startPublish(env, store, { ...row, decided_by: s.sub });
  return back(base, state === "dispatched" ? "retried" : "failed");
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/healthz") return send("ok", { type: "text/plain; charset=utf-8" });
  if (path === "/assets/admin.css") return send(CSS, { type: "text/css; charset=utf-8", cache: "public, max-age=3600" });

  const problem = configProblem(env);
  if (problem) return send(messagePage("Not configured", "This admin app is missing configuration. The owner needs to finish the setup.", false), { status: 503 });

  if (path === "/") return send("", { status: 302, location: "/admin" });

  if (path === "/auth/login" && method === "GET") {
    // "user" asks GitHub only who you are; the default, "admin", also reads org and team membership
    const mode = url.searchParams.get("mode") === "user" ? "user" : "admin";
    const state = `${mode}.${randomToken()}`;
    return send("", { status: 302, location: authorizeUrl(env, state, mode === "user" ? "read:user" : "read:user read:org"), cookies: [cookie(STATE_COOKIE, state, { maxAge: STATE_SECONDS })] });
  }

  if (path === "/auth/callback" && method === "GET") {
    const clearState = cookie(STATE_COOKIE, "", { maxAge: 0 });
    if (url.searchParams.get("error")) return send(signInPage("GitHub did not complete the sign-in."), { status: 400, cookies: [clearState] });
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    const expected = parseCookies(request.headers.get("Cookie"))[STATE_COOKIE];
    if (!code || !state || !expected || !(await safeEqual(state, expected))) return send(signInPage("That sign-in link was not valid or has expired. Start again."), { status: 400, cookies: [clearState] });
    const mode = state.startsWith("user.") ? "user" : "admin"; // the state cookie is ours and was just matched, so this is not attacker-controlled
    let user, who;
    try {
      const token = await exchangeCode(env, code);
      user = await getUser(token);
      who = mode === "admin" ? await decideRole(token, env) : { role: "user" }; // the token goes no further than this block
    } catch {
      return send(signInPage("Sign-in could not be completed. Try again in a moment."), { status: 502, cookies: [clearState] });
    }
    const session = await signToken({ sub: user.login, id: user.id, role: who.role, via: who.via ?? "", iat: Date.now(), exp: Date.now() + SESSION_SECONDS * 1000 }, env.SESSION_SECRET);
    return send("", { status: 302, location: mode === "user" ? "/submit" : "/admin", cookies: [clearState, cookie(SESSION_COOKIE, session, { maxAge: SESSION_SECONDS })] });
  }

  if (path === "/auth/logout" && method === "POST") {
    if (!sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
    return send("", { status: 302, location: "/admin", cookies: [cookie(SESSION_COOKIE, "", { maxAge: 0 })] });
  }

  if (path === "/api/me" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(JSON.stringify({ error: "not signed in" }), { status: 401, type: "application/json" });
    return send(JSON.stringify({ login: s.sub, role: s.role }), { type: "application/json" });
  }

  if (path === "/submit") {
    const s = await sessionOf(request, env);
    if (method === "GET") {
      if (!s) return send(signInPage("", { submit: true }));
      if (!storeFor(env)) return send(messagePage("Submissions are not open yet", "This app has no database connected yet.", false), { status: 503 });
      return send(submitPage({ session: s }));
    }
    if (method === "POST") return s ? submit(request, env, s) : send(signInPage("Sign in first, then submit again.", { submit: true }), { status: 401 });
  }

  if (path === "/mine" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage("", { submit: true }));
    const store = storeFor(env);
    if (!store) return send(messagePage("Submissions are not open yet", "This app has no database connected yet.", false), { status: 503 });
    return send(minePage({ session: s, rows: await store.byUser(s.id), flash: { 1: "Thanks. Your submission is waiting for review.", direct: FLASH.direct, held: FLASH.held }[url.searchParams.get("ok")] ?? "" }));
  }

  if (path === "/admin" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage());
    if (s.role !== "admin") return send(messagePage("No access", `You are signed in as @${s.sub}, but only owners of ${env.ORG} and members of ${env.ORG}/${env.TEAM} can maintain the catalogue. Ask an owner to add you to the team, then sign in again.`, false).replace("</div></body>", '<form method="post" action="/auth/logout"><button class="ghost" type="submit">Sign out</button></form></div></body>'), { status: 403 });
    let queue = [], queueError = "", subs = null;
    try { queue = await listPending(env); } catch { queueError = "The waiting list could not be loaded from GitHub just now. Reload in a minute."; }
    const store = storeFor(env);
    let recent = [];
    if (store) {
      try { await syncPublishing(env, store, listed(env)); await syncScans(env, store); subs = await store.pending(); recent = await store.recent(); } catch { queueError = queueError || "The submissions database could not be read just now."; }
    }
    return send(adminPage({ session: s, env, queue, queueError, subs, recent, flash: flashOf(url) }));
  }

  const detail = /^\/admin\/submissions\/(\d{1,9})$/.exec(path);
  if (detail && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage());
    if (s.role !== "admin") return send(messagePage("No access", "Only maintainers can see submissions.", false), { status: 403 });
    const store = storeFor(env);
    if (store) { try { await syncPublishing(env, store, listed(env)); await syncScans(env, store); } catch { /* the page still works without a refresh */ } }
    const row = store ? await store.get(Number(detail[1])) : null;
    return row ? send(detailPage({ session: s, s: row, flash: flashOf(url), canPublish: publishingConfigured(env) })) : send(messagePage("Not found", "There is no such submission.", false), { status: 404 });
  }

  const action = /^\/admin\/submissions\/(\d{1,9})\/(approve|reject|retry|scan|reopen)$/.exec(path);
  if (action && method === "POST") {
    const s = await sessionOf(request, env), id = Number(action[1]);
    return { approve: approveRoute, reject: rejectRoute, retry: retryRoute, scan: scanRoute, reopen: reopenRoute }[action[2]](request, env, s, id);
  }

  return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch { return send(messagePage("Something went wrong", "The request could not be handled. Nothing was changed.", false), { status: 500 }); } // never echo the error
  },
};
