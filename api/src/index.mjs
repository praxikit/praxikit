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
import { CSS, signInPage, messagePage, adminPage, submitPage, minePage, detailPage } from "./lib/html.mjs";

const SESSION_COOKIE = "__Host-praxikit-session";
const STATE_COOKIE = "__Host-praxikit-state";
const SESSION_SECONDS = 4 * 60 * 60; // short on purpose: a removed maintainer loses access within hours
const STATE_SECONDS = 10 * 60;
const SUBMISSIONS_PER_DAY = 5, SUBMISSIONS_PER_DAY_MAINTAINER = 30;

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
  try {
    await store.insert({
      repo_url: repo.url, repo_key: repo.key, name: info.name, owner: info.owner, owner_type: info.ownerType, submitted_by: session.sub, submitted_by_id: session.id,
      source, kind_guess: info.kind, license: info.license, commit_sha: info.commit, readme_url: info.readmeUrl, readme_excerpt: info.excerpt,
      why: source === "recommended" ? values.why : "", precheck: JSON.stringify(pre.checks), precheck_status: pre.status, created_at: new Date().toISOString(),
    });
  } catch (e) {
    if (String(e?.message) === "duplicate") return fail("That repository is already waiting for review.", 409);
    throw e;
  }
  return send("", { status: 303, location: "/mine?ok=1" });
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
    const session = await signToken({ sub: user.login, id: user.id, role: who.role, via: who.via ?? "", exp: Date.now() + SESSION_SECONDS * 1000 }, env.SESSION_SECRET);
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
    return send(minePage({ session: s, rows: await store.byUser(s.id), flash: url.searchParams.get("ok") ? "Thanks. Your submission is waiting for review." : "" }));
  }

  if (path === "/admin" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage());
    if (s.role !== "admin") return send(messagePage("No access", `You are signed in as @${s.sub}, but only owners of ${env.ORG} and members of ${env.ORG}/${env.TEAM} can maintain the catalogue. Ask an owner to add you to the team, then sign in again.`, false).replace("</div></body>", '<form method="post" action="/auth/logout"><button class="ghost" type="submit">Sign out</button></form></div></body>'), { status: 403 });
    let queue = [], queueError = "", subs = null;
    try { queue = await listPending(env); } catch { queueError = "The waiting list could not be loaded from GitHub just now. Reload in a minute."; }
    const store = storeFor(env);
    if (store) { try { subs = await store.pending(); } catch { queueError = queueError || "The submissions database could not be read just now."; } }
    return send(adminPage({ session: s, env, queue, queueError, subs }));
  }

  const detail = /^\/admin\/submissions\/(\d{1,9})$/.exec(path);
  if (detail && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage());
    if (s.role !== "admin") return send(messagePage("No access", "Only maintainers can see submissions.", false), { status: 403 });
    const store = storeFor(env);
    const row = store ? await store.get(Number(detail[1])) : null;
    return row ? send(detailPage({ session: s, s: row })) : send(messagePage("Not found", "There is no such submission.", false), { status: 404 });
  }

  return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch { return send(messagePage("Something went wrong", "The request could not be handled. Nothing was changed.", false), { status: 500 }); } // never echo the error
  },
};
