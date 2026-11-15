/**
 * Praxikit admin API (Cloudflare Worker, no dependencies).
 *
 * Phase 1: sign in with GitHub, decide whether the person may maintain the catalogue (owner of the
 * org, or member of its maintainers team), keep a signed session in a cookie, and show a read-only
 * admin page. The pages live on this origin, so the cookie is first-party and SameSite=Lax is enough.
 *
 * Config (wrangler.toml vars, plus secrets set with `wrangler secret put`):
 *   BASE_URL, ORG, TEAM, REPO, GITHUB_CLIENT_ID    plain values
 *   GITHUB_CLIENT_SECRET, SESSION_SECRET           secrets (SESSION_SECRET: 32+ random characters)
 *   GITHUB_TOKEN                                   optional, only to raise the API rate limit for the queue
 */
import { signToken, verifyToken, randomToken, safeEqual, parseCookies, cookie } from "./lib/crypto.mjs";
import { authorizeUrl, exchangeCode, getUser, decideRole, listPending } from "./lib/github.mjs";
import { CSS, signInPage, messagePage, adminPage } from "./lib/html.mjs";

const SESSION_COOKIE = "__Host-praxikit-session";
const STATE_COOKIE = "__Host-praxikit-state";
const SESSION_SECONDS = 4 * 60 * 60; // short on purpose: a removed maintainer loses access within hours
const STATE_SECONDS = 10 * 60;

const HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src https://avatars.githubusercontent.com; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
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
const sameOrigin = (request, env) => request.headers.get("Origin") === new URL(env.BASE_URL).origin;

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
    const state = randomToken();
    return send("", { status: 302, location: authorizeUrl(env, state), cookies: [cookie(STATE_COOKIE, state, { maxAge: STATE_SECONDS })] });
  }

  if (path === "/auth/callback" && method === "GET") {
    const clearState = cookie(STATE_COOKIE, "", { maxAge: 0 });
    if (url.searchParams.get("error")) return send(signInPage("GitHub did not complete the sign-in."), { status: 400, cookies: [clearState] });
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    const expected = parseCookies(request.headers.get("Cookie"))[STATE_COOKIE];
    if (!code || !state || !expected || !(await safeEqual(state, expected))) return send(signInPage("That sign-in link was not valid or has expired. Start again."), { status: 400, cookies: [clearState] });
    let user, who;
    try {
      const token = await exchangeCode(env, code);
      user = await getUser(token);
      who = await decideRole(token, env); // the token goes no further than this block
    } catch {
      return send(signInPage("Sign-in could not be completed. Try again in a moment."), { status: 502, cookies: [clearState] });
    }
    const session = await signToken({ sub: user.login, id: user.id, role: who.role, via: who.via ?? "", exp: Date.now() + SESSION_SECONDS * 1000 }, env.SESSION_SECRET);
    return send("", { status: 302, location: "/admin", cookies: [clearState, cookie(SESSION_COOKIE, session, { maxAge: SESSION_SECONDS })] });
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

  if (path === "/admin" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage());
    if (s.role !== "admin") return send(messagePage("No access", `You are signed in as @${s.sub}, but only owners of ${env.ORG} and members of ${env.ORG}/${env.TEAM} can maintain the catalogue. Ask an owner to add you to the team, then sign in again.`, false).replace("</div></body>", '<form method="post" action="/auth/logout"><button class="ghost" type="submit">Sign out</button></form></div></body>'), { status: 403 });
    let queue = [], queueError = "";
    try { queue = await listPending(env); } catch { queueError = "The waiting list could not be loaded from GitHub just now. Reload in a minute."; }
    return send(adminPage({ session: s, env, queue, queueError }));
  }

  return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch { return send(messagePage("Something went wrong", "The request could not be handled. Nothing was changed.", false), { status: 500 }); } // never echo the error
  },
};
