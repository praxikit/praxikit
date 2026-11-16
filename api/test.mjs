#!/usr/bin/env node
// Tests the admin API end to end against a fake GitHub. No network, no dependencies.
// Run from the repo root: node api/test.mjs
import worker from "./src/index.mjs";
import { signToken, verifyToken } from "./src/lib/crypto.mjs";

const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const SECRET = "s".repeat(40);
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET };
const TOKENS = ["tok-owner", "tok-team", "tok-member", "tok-outsider", "tok-pending", "tok-wrongorg"];

// ---- a fake GitHub
let issuesMode = "ok";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const USERS = { "tok-owner": { login: "ratul", id: 111 }, "tok-team": { login: "teammate", id: 222 }, "tok-member": { login: "plain-member", id: 333 }, "tok-outsider": { login: "outsider", id: 444 }, "tok-pending": { login: "invited", id: 555 }, "tok-wrongorg": { login: "elsewhere", id: 666 } };
const MEMBERSHIP = { "tok-owner": { state: "active", role: "admin" }, "tok-team": { state: "active", role: "member" }, "tok-member": { state: "active", role: "member" }, "tok-pending": { state: "pending", role: "admin" }, "tok-wrongorg": { state: "active", role: "member" } };
const TEAMS = {
  "tok-team": [{ slug: "maintainers", organization: { login: "praxikit" } }],
  "tok-member": [{ slug: "other", organization: { login: "praxikit" } }],
  "tok-pending": [{ slug: "maintainers", organization: { login: "praxikit" } }],
  "tok-wrongorg": [{ slug: "maintainers", organization: { login: "someone-else" } }],
};
const CODES = { "good-owner": "tok-owner", "good-team": "tok-team", "good-member": "tok-member", "good-outsider": "tok-outsider", "good-pending": "tok-pending", "good-wrongorg": "tok-wrongorg" };
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const bearer = String(init.headers?.Authorization ?? "").replace("Bearer ", "");
  if (u.href === "https://github.com/login/oauth/access_token") {
    const body = JSON.parse(init.body);
    if (body.code === "boom") return json({}, 500);
    if (body.client_secret !== "csecret" || body.redirect_uri !== "https://admin.example.dev/auth/callback") return json({ error: "incorrect_client_credentials" });
    return CODES[body.code] ? json({ access_token: CODES[body.code], token_type: "bearer" }) : json({ error: "bad_verification_code" });
  }
  if (u.origin !== "https://api.github.com") return json({}, 404);
  if (u.pathname === "/user") return USERS[bearer] ? json(USERS[bearer]) : json({}, 401);
  if (u.pathname === "/user/memberships/orgs/praxikit") return MEMBERSHIP[bearer] ? json(MEMBERSHIP[bearer]) : json({}, 404);
  if (u.pathname === "/user/teams") return json(TEAMS[bearer] ?? []);
  // the server's own lookup (GITHUB_ORG_TOKEN): who is in the org and the team, by login
  const orgM = /^\/orgs\/praxikit\/memberships\/([^/]+)$/.exec(u.pathname), orgT = /^\/orgs\/praxikit\/teams\/maintainers\/memberships\/([^/]+)$/.exec(u.pathname);
  if (orgM || orgT) {
    if (bearer !== "orgtok") return json({ message: "Bad credentials" }, 401);
    const who = (orgM ?? orgT)[1];
    if (orgM) return who === "ratul" ? json({ state: "active", role: "admin" }) : who === "teammate" || who === "plain-member" ? json({ state: "active", role: "member" }) : who === "pending-person" ? json({ state: "pending", role: "member" }) : json({}, 404);
    return who === "teammate" ? json({ state: "active", role: "member" }) : json({}, 404);
  }
  if (u.pathname === "/repos/praxikit/praxikit/issues") {
    if (issuesMode === "fail") return json({}, 500);
    return u.searchParams.get("labels") === "submission"
      ? json([{ number: 7, title: "<img src=x onerror=alert(1)> Submit: Thing", user: { login: "alice" }, labels: [{ name: "submission" }, { name: "checks-flagged" }], created_at: "2026-11-15T10:00:00Z" }, { number: 8, title: "a pull request", pull_request: {}, user: { login: "bob" }, labels: [] }])
      : json([]);
  }
  return json({}, 404);
};

// ---- helpers
const call = (path, { method = "GET", cookies = {}, origin, e = env, extra = {} } = {}) => {
  const headers = new Headers(extra);
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  return worker.fetch(new Request(`https://admin.example.dev${path}`, { method, headers }), e);
};
const setCookies = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) => { const c = setCookies(res).find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
const everything = [];
const note = async (res) => { const clone = res.clone(); everything.push(await clone.text(), [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")); return res; };
async function signIn(code) {
  const login = await note(await call("/auth/login"));
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const stateCookie = cookieValue(login, "__Host-praxikit-state");
  const cb = await note(await call(`/auth/callback?code=${code}&state=${state}`, { cookies: { "__Host-praxikit-state": stateCookie } }));
  return { login, state, stateCookie, cb, session: cookieValue(cb, "__Host-praxikit-session") };
}
const asSession = (v) => ({ "__Host-praxikit-session": v });

// ---- not configured: plain 503, no values leaked
for (const [label, e] of [["no secret", { ...env, SESSION_SECRET: undefined }], ["short secret", { ...env, SESSION_SECRET: "short" }], ["placeholder url", { ...env, BASE_URL: "REPLACE_WITH_THE_WORKER_URL" }], ["http url", { ...env, BASE_URL: "http://admin.example.dev" }], ["no client id", { ...env, GITHUB_CLIENT_ID: "" }]]) {
  const r = await call("/admin", { e });
  const t = await r.text();
  must(r.status === 503 && !t.includes("short") && !t.includes(SECRET), `unconfigured (${label}) gives 503 and leaks nothing`);
}
must((await call("/healthz")).status === 200, "healthz works");

// ---- login redirect
{
  const r = await note(await call("/auth/login"));
  const loc = new URL(r.headers.get("Location"));
  must(r.status === 302 && loc.origin === "https://github.com" && loc.pathname === "/login/oauth/authorize", "login redirects to GitHub");
  must(loc.searchParams.get("redirect_uri") === "https://admin.example.dev/auth/callback" && loc.searchParams.get("client_id") === "cid" && loc.searchParams.get("scope") === "read:user read:org" && loc.searchParams.get("state").length >= 40, "login sends fixed redirect, client id, minimal scope and a long random state");
  const sc = setCookies(r)[0];
  must(sc.startsWith("__Host-praxikit-state=") && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\//.test(sc) && /Max-Age=600/.test(sc) && !/Domain=/.test(sc), `state cookie is __Host-, HttpOnly, Secure, SameSite=Lax, short-lived: ${sc}`);
  const r2 = await call("/auth/login");
  must(new URL(r2.headers.get("Location")).searchParams.get("state") !== loc.searchParams.get("state"), "state is different every time");
}

// ---- callback guards
{
  const login = await call("/auth/login");
  const state = new URL(login.headers.get("Location")).searchParams.get("state"), sc = cookieValue(login, "__Host-praxikit-state");
  must((await note(await call(`/auth/callback?code=good-owner&state=${state}`))).status === 400, "callback without the state cookie is refused");
  must((await note(await call("/auth/callback?code=good-owner&state=forged", { cookies: { "__Host-praxikit-state": sc } }))).status === 400, "callback with a state that does not match is refused");
  must((await note(await call(`/auth/callback?state=${state}`, { cookies: { "__Host-praxikit-state": sc } }))).status === 400, "callback without a code is refused");
  must((await note(await call("/auth/callback?error=access_denied"))).status === 400, "GitHub reporting an error is handled with a plain page");
  const bad = await note(await call(`/auth/callback?code=bad&state=${state}`, { cookies: { "__Host-praxikit-state": sc } }));
  must(bad.status === 502 && !cookieValue(bad, "__Host-praxikit-session"), "a rejected code gives no session");
  const boom = await note(await call(`/auth/callback?code=boom&state=${state}`, { cookies: { "__Host-praxikit-state": sc } }));
  must(boom.status === 502 && !cookieValue(boom, "__Host-praxikit-session"), "a GitHub outage gives no session");
}

// ---- who gets in
const owner = await signIn("good-owner");
must(owner.cb.status === 302 && owner.cb.headers.get("Location") === "/admin" && owner.session, "an org owner gets a session");
const sessionCookie = setCookies(owner.cb).find((x) => x.startsWith("__Host-praxikit-session="));
must(/HttpOnly/.test(sessionCookie) && /Secure/.test(sessionCookie) && /SameSite=Lax/.test(sessionCookie) && /Max-Age=14400/.test(sessionCookie) && /Path=\//.test(sessionCookie) && !/Domain=/.test(sessionCookie), "session cookie is __Host-, HttpOnly, Secure, SameSite=Lax and lasts four hours");
must(setCookies(owner.cb).some((x) => x.startsWith("__Host-praxikit-state=;") || /^__Host-praxikit-state=; /.test(x)), "the state cookie is cleared after use");
const payload = await verifyToken(owner.session, SECRET);
must(payload?.sub === "ratul" && payload.role === "admin" && payload.via === "owner" && !JSON.stringify(payload).includes("tok-"), "the session holds the login and role and no GitHub token");

const me = await note(await call("/api/me", { cookies: asSession(owner.session) }));
must(me.status === 200 && (await me.json()).role === "admin", "/api/me reports the owner as admin");

const adminPageRes = await note(await call("/admin", { cookies: asSession(owner.session) }));
const adminHtml = await adminPageRes.text();
must(adminPageRes.status === 200 && adminHtml.includes("an owner of praxikit"), "the owner sees the admin page");
must(adminHtml.includes("#7") && adminHtml.includes("https://github.com/praxikit/praxikit/issues/7") && adminHtml.includes("checks-flagged") && !adminHtml.includes("#8"), "the queue lists open submissions, links to the issue, and leaves out pull requests");
must(!adminHtml.includes("<img src=x") && adminHtml.includes("&lt;img src=x onerror=alert(1)&gt;"), "an issue title with markup is escaped");
must((await (await call("/api/me", { cookies: asSession(owner.session) })).json()).id === 111, "/api/me gives the header what it needs (login, id, role) and nothing more");
must((await call("/auth/logout", { cookies: asSession(owner.session) })).status !== 302, "signing out is not a link: a GET does not do it");

const team = await signIn("good-team");
const teamHtml = await (await note(await call("/admin", { cookies: asSession(team.session) }))).text();
must(teamHtml.includes("a member of praxikit/maintainers") && (await verifyToken(team.session, SECRET)).via === "team", "a maintainers team member gets in");

for (const [code, label] of [["good-member", "an org member not in the team"], ["good-outsider", "someone outside the org"], ["good-pending", "someone whose invitation is still pending"], ["good-wrongorg", "a maintainers member of a different org"]]) {
  const s = await signIn(code);
  const p = await verifyToken(s.session, SECRET);
  must(p?.role === "user", `${label} is signed in with role user`);
  const r = await note(await call("/admin", { cookies: asSession(s.session) }));
  const t = await r.text();
  must(r.status === 403 && t.includes("No access") && !t.includes("Waiting for review"), `${label} is refused the admin page`);
  must((await (await call("/api/me", { cookies: asSession(s.session) })).json()).role === "user", `${label} is reported as user`);
}

// ---- sessions cannot be forged, extended or reused
must((await note(await call("/admin"))).status === 200 && (await (await call("/admin")).text()).includes("Sign in with GitHub"), "no session shows the sign-in page");
must((await call("/api/me")).status === 401, "/api/me without a session is 401");
{
  const [body, sig] = owner.session.split(".");
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), sub: "someone-else" })).toString("base64url");
  must((await call("/api/me", { cookies: asSession(`${evil}.${sig}`) })).status === 401, "a payload changed after signing is rejected");
  const userTok = (await signIn("good-member")).session;
  const [ub, us] = userTok.split(".");
  const promoted = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(ub, "base64url")), role: "admin", via: "owner" })).toString("base64url");
  const promotedPage = await (await call("/admin", { cookies: asSession(`${promoted}.${us}`) })).text();
  must(promotedPage.includes("Sign in with GitHub") && !promotedPage.includes("Catalogue admin"), "a user session promoted to admin by editing it is treated as signed out");
  const expired = await signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", exp: Date.now() - 1000 }, SECRET);
  must((await call("/api/me", { cookies: asSession(expired) })).status === 401, "an expired session is rejected");
  const otherKey = await signToken({ sub: "ratul", id: 111, role: "admin", via: "owner", exp: Date.now() + 100000 }, "x".repeat(40));
  must((await call("/api/me", { cookies: asSession(otherKey) })).status === 401, "a token signed with another key is rejected");
  must((await call("/api/me", { cookies: asSession("garbage") })).status === 401 && (await call("/api/me", { cookies: asSession("a.b.c") })).status === 401, "garbage tokens are rejected");
}

// ---- logout needs the app's own origin
{
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session) })).status === 403, "logout without an Origin header is refused");
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), origin: "https://evil.example" })).status === 403, "logout from another origin is refused (CSRF)");
  const ok = await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), origin: "https://admin.example.dev" });
  must(ok.status === 302 && setCookies(ok).some((c) => c.startsWith("__Host-praxikit-session=;") && /Max-Age=0/.test(c)), "logout from the app clears the session cookie");
  must((await call("/auth/logout", { cookies: asSession(owner.session) })).status === 404, "logout is not available as a GET");
  // browsers send "Origin: null" (or none) on same-origin form posts in some cases; Sec-Fetch-Site tells them apart from cross-site posts
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), origin: "null", extra: { "Sec-Fetch-Site": "same-origin" } })).status === 302, "Origin: null with Sec-Fetch-Site: same-origin is accepted");
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), extra: { "Sec-Fetch-Site": "same-origin" } })).status === 302, "no Origin with Sec-Fetch-Site: same-origin is accepted");
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), origin: "null" })).status === 403, "Origin: null without a same-origin Sec-Fetch-Site is refused");
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), origin: "null", extra: { "Sec-Fetch-Site": "cross-site" } })).status === 403, "Origin: null from a cross-site request is refused");
  must((await call("/auth/logout", { method: "POST", cookies: asSession(owner.session), origin: "https://evil.example", extra: { "Sec-Fetch-Site": "same-origin" } })).status === 403, "a different Origin is refused even if Sec-Fetch-Site claims same-origin");
}

// ---- GitHub being down must not break sign-in pages
issuesMode = "fail";
{
  const r = await call("/admin", { cookies: asSession(owner.session) });
  const t = await r.text();
  must(r.status === 200 && t.includes("could not be loaded"), "if the queue cannot load, the page still works and says so");
}
issuesMode = "ok";

// ---- headers and page hygiene on every response
for (const path of ["/admin", "/auth/login", "/healthz", "/nope", "/assets/app.css"]) {
  const r = await call(path);
  const h = r.headers;
  must(/default-src 'none'/.test(h.get("Content-Security-Policy") ?? "") && /frame-ancestors 'none'/.test(h.get("Content-Security-Policy")) && h.get("X-Content-Type-Options") === "nosniff" && h.get("Referrer-Policy") === "same-origin" && /max-age/.test(h.get("Strict-Transport-Security") ?? ""), `security headers on ${path}`);
}
must((await call("/admin")).headers.get("Cache-Control") === "no-store" && /public/.test((await call("/assets/app.css")).headers.get("Cache-Control")), "pages are never cached, the stylesheet may be");
must((await call("/nope")).status === 404 && (await call("/", { method: "GET" })).headers.get("Location") === "/admin", "unknown paths are 404 and the root goes to /admin");
for (const t of everything) must(!/<script|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");

// ---- the GitHub token and the secrets never reach the browser
const blob = everything.join("\n");
for (const t of TOKENS) must(!blob.includes(t), `GitHub token ${t} never appears in a response`);
must(!blob.includes("csecret") && !blob.includes(SECRET), "the client secret and session secret never appear in a response");

// ---- maintainers are recognised without asking anyone for organisation access (server-side lookup)
{
  const e2 = { ...env, GITHUB_ORG_TOKEN: "orgtok" };
  const userSignIn = async (code, e) => {
    const login = await note(await call("/auth/login?mode=user", { e }));
    const loc = new URL(login.headers.get("Location"));
    const cb = await note(await call(`/auth/callback?code=${code}&state=${loc.searchParams.get("state")}`, { e, cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } }));
    const me = await (await call("/api/me", { e, cookies: asSession(cookieValue(cb, "__Host-praxikit-session")) })).json();
    return { scope: loc.searchParams.get("scope"), me };
  };
  const o = await userSignIn("good-owner", e2);
  must(o.scope === "read:user" && o.me.role === "admin", "an owner who uses the ordinary sign-in is an admin, and GitHub was only asked for read:user");
  must((await userSignIn("good-team", e2)).me.role === "admin", "a team member who uses the ordinary sign-in is an admin");
  must((await userSignIn("good-member", e2)).me.role === "user", "an organisation member outside the team stays a member");
  must((await userSignIn("good-outsider", e2)).me.role === "user", "someone outside the organisation stays a member");
  must((await userSignIn("good-owner", env)).me.role === "user", "without the server token the ordinary sign-in is a member (organisation sign-in is still available)");
  must((await userSignIn("good-owner", { ...e2, GITHUB_ORG_TOKEN: "wrong" })).me.role === "user", "if the server's lookup fails, the person is a member, never an admin");
  must((await userSignIn("good-owner", { ...e2, ORG: "praxikit", TEAM: "other-team" })).me.role === "admin", "an owner needs no team");
}

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: admin API signs in with GitHub, admits owners and team members only, signs short sessions, refuses forged or cross-site requests, escapes everything and never exposes a token");
