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
import { signToken, verifyToken, randomToken, safeEqual, parseCookies, cookie, hintCookie } from "./lib/crypto.mjs";
import { authorizeUrl, exchangeCode, getUser, decideRole, decideRoleByLogin } from "./lib/github.mjs";
import { parseRepo, fetchRepoInfo, isAuthor, alreadyListed, fetchListings, precheck, UserError } from "./lib/repo.mjs";
import { storeFor } from "./lib/store.mjs";
import { parseTags } from "./lib/tags.mjs";
import { dispatchApprove, dispatchEdit, dispatchRemove, dispatchScan, syncPublishing, syncScans, publishingConfigured } from "./lib/publish.mjs";
import { notifyOwner, rememberContext } from "./lib/notify.mjs";
import { COMMUNITY, cleanNote, notesAdminPage } from "./lib/community.mjs";
import { REQUESTS, cleanRequest, FLASH_REQUESTS, requestsPage, requestsAdminPage } from "./lib/requests.mjs";
import { boardFor, contributionsFor, contributorsPage, contributorProfilePage } from "./lib/contributors.mjs";
import { cleanItem, cleanLabel, fetchCatalogue, LIMITS, FLASH_ACCOUNT, savePage, collectionPage, profilePage, settingsPage } from "./lib/account.mjs";
import { CSS, setShell, signInPage, messagePage, listingsPage, adminPage, submitPage, minePage, detailPage, FLASH } from "./lib/html.mjs";

const SESSION_COOKIE = "__Host-praxikit-session";
const STATE_COOKIE = "__Host-praxikit-state";
const RETURN_COOKIE = "__Host-praxikit-return"; // the page the person was on when they pressed Sign in
/** A path on this site only: starts with one slash, plain characters, never an auth or api path. Anything else is "". */
const cleanReturn = (t) => {
  const s = String(t ?? "").slice(0, 200);
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("..") || s.includes("\\")) return "";
  if (!/^[A-Za-z0-9_.~%=&?\/-]+$/.test(s)) return "";
  if (s.startsWith("/auth/") || s.startsWith("/api/") || s === "/auth") return "";
  return s;
};
const hereOf = (request) => { const u = new URL(request.url); return cleanReturn(u.pathname + u.search); };
const SAVE_COOKIE = "__Host-praxikit-save"; // a kit the visitor pressed Save on, kept across the GitHub sign-in
const NEXT_COOKIE = "__Host-praxikit-next"; // the repository link a visitor typed on the website, kept across the GitHub sign-in
/** A repository link that is safe to carry around: only the cleaned https://github.com/owner/repo form survives. */
const cleanRepo = (text) => { const r = parseRepo(String(text ?? "").slice(0, 200)); return r ? r.url : ""; };
const SESSION_SECONDS = 4 * 60 * 60; // short on purpose: a removed maintainer loses access within hours
const STATE_SECONDS = 10 * 60;
const SUBMISSIONS_PER_DAY = 5, SUBMISSIONS_PER_DAY_MAINTAINER = 30;
const FRESH_MS = 30 * 60 * 1000; // approving, rejecting and publishing need a sign-in from the last 30 minutes
const KINDS = ["plugin", "skill", "mcp", "template", "adapter", "agent", "hook"];

// Headers for the static site pages (the app's own pages use HEADERS below). Scripts and styles only from this address.
const SITE_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' https://cloudflareinsights.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};
// What the app answers itself. Everything else is a page of the site.
const APP_EXACT = new Set(["/healthz", "/submit", "/requests", "/contributors", "/api/collection", "/collection", "/profile", "/settings", "/admin", "/api/me"]);
const APP_PREFIX = ["/requests/", "/u/", "/api/", "/auth/", "/admin/", "/collection/", "/settings/", "/account/", "/assets/"];
const isAppPath = (p) => APP_EXACT.has(p) || APP_PREFIX.some((x) => p.startsWith(x));

let shellAt = 0;
/** Reads the site's frame (app-shell.html) so the app's pages look like the rest of the site. Cached for a few minutes. */
async function loadShell(env, request) {
  if (!env.ASSETS || Date.now() - shellAt < 5 * 60 * 1000) return;
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/app-shell.html", request.url)));
    if (r.ok) { setShell(await r.text()); shellAt = Date.now(); }
  } catch { /* the plain frame is used */ }
}

async function serveSite(request, env) {
  const r = await env.ASSETS.fetch(request);
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(SITE_HEADERS)) h.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

const HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' https://cloudflareinsights.com; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
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
  if (!(s && typeof s.sub === "string" && Number.isInteger(s.id) && (s.role === "admin" || s.role === "user"))) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const st = storeFor(env);
    if (st) { try { if (await st.recentlyDeleted(s.id, new Date().toISOString())) return null; } catch { /* the check is an extra; the signed session still stands */ } }
  }
  return s;
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

const safeDecode = (s) => { try { return decodeURIComponent(String(s ?? "")); } catch { return ""; } };
const store0Public = async (env, s) => { const st = storeFor(env); return st ? st.isPublic(s.id) : false; };
const oneLine = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

async function submit(request, env, session) {
  const store = storeFor(env);
  if (!store) return send(messagePage("Submissions are not open yet", "This app has no database connected yet.", false), { status: 503 });
  if (!sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return send(messagePage("Too large", "That submission is too large.", false), { status: 413 });

  let url = "", why = "";
  try { const f = await request.formData(); url = String(f.get("url") ?? "").trim(); why = String(f.get("why") ?? ""); } catch { return send(submitPage({ session, error: "That form could not be read. Try again." }), { status: 400 }); }
  const values = { url: url.slice(0, 200), why: oneLine(why, 200) };
  const isPublic = await store.isPublic(session.id);
  const fail = (error, status = 400) => send(submitPage({ session, error, values, isPublic }), { status });

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
      source, kind_guess: info.kind, license: info.license, commit_sha: info.commit, readme_url: info.readmeUrl, readme_excerpt: info.excerpt, topics: info.topics.join(","),
      why: source === "recommended" ? values.why : "", precheck: JSON.stringify(pre.checks), precheck_status: pre.status, created_at: new Date().toISOString(),
    });
  } catch (e) {
    if (String(e?.message) === "duplicate") return fail("That repository is already waiting for review.", 409);
    throw e;
  }
  await store.record(session.id, "submission", new Date().toISOString());
  if (session.role !== "admin") await notifyOwner(env, { title: "New kit submission", message: `${repo.key} from @${session.sub} is waiting for review.`, path: `/admin/submissions/${newId}` });
  // a maintainer's own submission is published directly, after the same scan. It is held for review if it cannot be.
  if (session.role === "admin") {
    const text = oneLine(source === "recommended" && values.why ? values.why : info.excerpt || `${info.name} by ${info.owner}`, 400);
    if (fresh(session) && info.kind && pre.status !== "fail" && publishingConfigured(env) && (await store.approve(newId, { by: session.sub, name: oneLine(info.name, 80), kind: info.kind, text, at: new Date().toISOString(), tags: info.topics.join(",") }))) {
      await startPublish(env, store, { final_tags: info.topics.join(","), id: newId, repo_url: repo.url, source, owner: info.owner, final_name: oneLine(info.name, 80), final_kind: info.kind, final_text: text, decided_by: session.sub });
      return send("", { status: 303, location: "/profile?ok=direct" });
    }
    return send("", { status: 303, location: "/profile?ok=held" });
  }
  return send("", { status: 303, location: "/profile?ok=1" });
}

const REMOVE_REASONS = ["malicious", "secret", "licence", "misleading", "unmaintained", "owner-request", "other"];

/** Edit or remove a live listing. The target must be in the live list, so the form cannot name anything else. */
async function listingRoute(request, env, s, kind) {
  const stop = gate(request, env, s); if (stop) return stop;
  const base = "/admin/listings";
  if (!publishingConfigured(env)) return back(base, "nopublish");
  let f; try { f = await request.formData(); } catch { return back(base, "bad"); }
  const url = cleanRepo(f.get("url"));
  let live; try { live = await fetchListings(env); } catch { return back(base, "unread"); }
  const target = live.find((l) => l.url === url);
  if (!url || !target) return back(base, "gone");
  try {
    if (kind === "edit") {
      const name = oneLine(f.get("name"), 100), why = oneLine(f.get("why"), 500), note = oneLine(f.get("note"), 300);
      const tags = parseTags(oneLine(f.get("tags"), 400)).join(",");
      if (!name || name.length > 80 || !why || why.length > 400 || note.length > 200) return back(base, "badedit");
      await dispatchEdit(env, { url, name, why, tags, note, by: s.sub });
      return back(base, "edited");
    }
    const reason = String(f.get("reason") ?? ""), note = oneLine(f.get("note"), 200);
    if (!REMOVE_REASONS.includes(reason) || note.length > 160 || f.get("confirm") !== "yes") return back(base, "badremove");
    await dispatchRemove(env, { url, reason, note });
    return back(base, "removed");
  } catch { return back(base, "joberr"); }
}

/** Signed-in people only (any role), requests from this site only. Returns { s, store } or a Response to stop. */
async function personGate(request, env, method, { forPage = false, item = "" } = {}) {
  const s = await sessionOf(request, env);
  if (!s) return forPage ? send(signInPage("", { submit: true, save: item, what: "collection", return: item ? "" : hereOf(request) })) : send(signInPage("Sign in first.", { submit: true, what: "collection" }), { status: 401 });
  if (method === "POST" && !sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
  const store = storeFor(env);
  if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
  return { s, store };
}
const flashAccount = (url) => FLASH_ACCOUNT[url.searchParams.get("m")] ?? "";

async function accountRoutes(request, env, url, path, method) {
  const isPost = method === "POST";
  const item = cleanItem(isPost ? "" : url.searchParams.get("item"));
  if (path === "/collection" && method === "GET") {
    const g = await personGate(request, env, method, { forPage: true }); if (g instanceof Response) return g;
    let catalogue = null; try { catalogue = await fetchCatalogue(env); } catch { /* names are not shown; the list still is */ }
    return send(collectionPage({ session: g.s, env, rows: await g.store.collectionOf(g.s.id), catalogue, flash: flashAccount(url), user: await g.store.getUser(g.s.id) }));
  }
  if (path === "/api/collection" && method === "GET") {
    const s = await sessionOf(request, env), store = storeFor(env);
    if (!s || !store) return send(JSON.stringify({ error: "not signed in" }), { status: 401, type: "application/json" });
    return send(JSON.stringify({ items: (await store.collectionOf(s.id)).map((r) => r.item) }), { type: "application/json" });
  }
  if (path === "/collection/toggle" && isPost) {
    const J = (o, status = 200) => send(JSON.stringify(o), { status, type: "application/json" });
    const s = await sessionOf(request, env), store = storeFor(env);
    if (!s || !store) return J({ error: "not signed in", message: "Sign in to save kits." }, 401);
    if (!sameOrigin(request, env)) return J({ error: "refused", message: "That request did not come from this site." }, 403);
    let f; try { f = await request.formData(); } catch { return J({ error: "bad", message: FLASH_ACCOUNT.bad }, 400); }
    const key = cleanItem(f.get("item"));
    if (!key) return J({ error: "bad", message: FLASH_ACCOUNT.bad }, 400);
    if (await store.hasItem(s.id, key)) { await store.removeItem(s.id, key); return J({ saved: false }); }
    if ((await store.collectionCount(s.id)) >= LIMITS.total) return J({ error: "limit", message: FLASH_ACCOUNT.limit }, 409);
    if ((await store.collectionSince(s.id, new Date(Date.now() - 3600_000).toISOString())) >= LIMITS.perHour) return J({ error: "slow", message: FLASH_ACCOUNT.slow }, 429);
    let catalogue; try { catalogue = await fetchCatalogue(env); } catch { return J({ error: "down", message: FLASH_ACCOUNT.down }, 503); }
    if (!catalogue.has(key)) return J({ error: "gone", message: FLASH_ACCOUNT.gone }, 404);
    await store.touchUser(s.id, s.sub, new Date().toISOString());
    await store.record(s.id, "save", new Date().toISOString());
    await store.saveItem(s.id, key, "", new Date().toISOString());
    return J({ saved: true });
  }
  if (path === "/profile" && method === "GET") {
    const g = await personGate(request, env, method, { forPage: true }); if (g instanceof Response) return g;
    let contrib = null;
    try { contrib = (await contributionsFor(g.store, await fetchCatalogue(env))).get(g.s.id) ?? { id: g.s.id, count: 0, picked: 0, author: 0, items: [] }; } catch { /* the block is left out if the catalogue cannot be read */ }
    return send(profilePage({ contrib, pending: await g.store.pendingCountFor(g.s.id), isPublic: await g.store.isPublic(g.s.id), session: g.s, rows: await g.store.byUser(g.s.id), count: await g.store.collectionCount(g.s.id), user: await g.store.getUser(g.s.id), flash: { 1: "Thanks. Your submission is waiting for review.", direct: FLASH.direct, held: FLASH.held }[url.searchParams.get("ok")] ?? flashAccount(url) }));
  }
  if (path === "/settings" && method === "GET") {
    const g = await personGate(request, env, method, { forPage: true }); if (g instanceof Response) return g;
    return send(settingsPage({ session: g.s, user: await g.store.getUser(g.s.id), flash: flashAccount(url), isPublic: await g.store.isPublic(g.s.id) }));
  }
  if (path === "/settings/public" && isPost) {
    const g = await personGate(request, env, method); if (g instanceof Response) return g;
    let f; try { f = await request.formData(); } catch { return back("/settings", "bad"); }
    const on = f.get("public") === "yes";
    const at = new Date().toISOString();
    await g.store.touchUser(g.s.id, g.s.sub, at);
    await g.store.setPublic(g.s.id, on, at);
    return back("/settings", on ? "publicOn" : "publicOff");
  }
  if (path === "/collection/save" && method === "GET") {
    const g = await personGate(request, env, method, { forPage: true, item }); if (g instanceof Response) return g;
    if (!item) return send(messagePage("Nothing to save", "That link does not name a kit.", false), { status: 400 });
    let catalogue; try { catalogue = await fetchCatalogue(env); } catch { return send(messagePage("Try again", FLASH_ACCOUNT.down, false), { status: 503 }); }
    const info = catalogue.get(item);
    if (!info) return send(messagePage("Not found", FLASH_ACCOUNT.gone, false), { status: 404 });
    const mine = (await g.store.collectionOf(g.s.id)).find((r) => r.item === item);
    return send(savePage({ session: g.s, env, item, info, saved: !!mine, label: mine?.label ?? "" }));
  }
  if (path === "/collection/save" && isPost) {
    const g = await personGate(request, env, method); if (g instanceof Response) return g;
    let f; try { f = await request.formData(); } catch { return back("/collection", "bad"); }
    const key = cleanItem(f.get("item")), label = cleanLabel(f.get("label"));
    if (!key || String(f.get("label") ?? "").length > 200) return back("/collection", "bad");
    const isNew = !(await g.store.hasItem(g.s.id, key));
    if (isNew) {
      if ((await g.store.collectionCount(g.s.id)) >= LIMITS.total) return back("/collection", "limit");
      if ((await g.store.collectionSince(g.s.id, new Date(Date.now() - 3600_000).toISOString())) >= LIMITS.perHour) return back("/collection", "slow");
    }
    let catalogue; try { catalogue = await fetchCatalogue(env); } catch { return back("/collection", "down"); }
    if (!catalogue.has(key)) return back("/collection", "gone");
    if (isNew) await g.store.record(g.s.id, "save", new Date().toISOString());
    await g.store.touchUser(g.s.id, g.s.sub, new Date().toISOString());
    await g.store.saveItem(g.s.id, key, label, new Date().toISOString());
    return back("/collection", "saved");
  }
  if (path === "/collection/remove" && isPost) {
    const g = await personGate(request, env, method); if (g instanceof Response) return g;
    let f; try { f = await request.formData(); } catch { return back("/collection", "bad"); }
    const key = cleanItem(f.get("item"));
    if (key) await g.store.removeItem(g.s.id, key);
    return back("/collection", "removed");
  }
  if (path === "/account/export" && method === "GET") {
    const g = await personGate(request, env, method, { forPage: true }); if (g instanceof Response) return g;
    const user = await g.store.getUser(g.s.id), subs = await g.store.byUser(g.s.id, 200);
    const data = { public_credit: await g.store.isPublic(g.s.id), github_login: g.s.sub, github_id: g.s.id, account_created: user?.created_at ?? null, last_seen: user?.last_seen ?? null,
      collection: (await g.store.collectionOf(g.s.id)).map((r) => ({ item: r.item, group: r.label, saved: r.added_at })),
      requests: (await g.store.requestsOf(g.s.id)).map((r) => ({ title: r.title, details: r.body, status: r.status, asked: r.created_at })),
      needed_too: (await g.store.needsOf(g.s.id)).map((r) => ({ request: r.request_id, at: r.created_at })),
      helped_me: (await g.store.votesOf(g.s.id)).map((r) => ({ item: r.item, at: r.created_at })),
      notes: (await g.store.notesOf(g.s.id)).map((r) => ({ item: r.item, text: r.text, status: r.status, written: r.created_at })),
      submissions: subs.map((r) => ({ repository: r.repo_url, status: r.status, submitted: r.created_at, note: r.why })) };
    const res = send(JSON.stringify(data, null, 2), { type: "application/json" });
    res.headers.set("Content-Disposition", 'attachment; filename="praxikit-my-data.json"');
    return res;
  }
  if (path === "/account/delete" && isPost) {
    const g = await personGate(request, env, method); if (g instanceof Response) return g;
    let f; try { f = await request.formData(); } catch { return back("/collection", "bad"); }
    if (String(f.get("confirm") ?? "").trim().toLowerCase() !== g.s.sub.toLowerCase()) return back("/settings", "confirm");
    await g.store.deleteAccount(g.s.id);
    return send(messagePage("Account deleted", "Your collection, your waiting submissions and your account record are gone. Decided submissions stay in the catalogue's history without your name. You are signed out.", false), { cookies: [cookie(SESSION_COOKIE, "", { maxAge: 0 }), hintCookie(false)] });
  }
  return send(messagePage("Not found", "There is no such page.", false), { status: 404 });
}

/** Answers from the edge cache when it can, so a busy home page does not read the database on every visit. Works only where the Cache API exists. */
async function edgeCached(request, seconds, produce, keySuffix = "") {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const u = new URL(request.url);
  const key = new Request(u.origin + u.pathname + (keySuffix ? "?item=" + encodeURIComponent(keySuffix) : ""), { method: "GET" }); // ignores the query and the cookies: these answers are the same for everyone
  if (cache) { try { const hit = await cache.match(key); if (hit) return hit; } catch { /* fall through to a fresh answer */ } }
  const res = await produce();
  if (cache && res.status === 200) { try { const copy = new Response(res.clone().body, res); copy.headers.set("Cache-Control", `public, max-age=${seconds}`); await cache.put(key, copy); } catch { /* the answer is still returned */ } }
  return res;
}

const jsonRes = (o, status = 200, cache = "no-store") => send(JSON.stringify(o), { status, type: "application/json", cache });

/**
 * "This helped me" votes and short notes. Reading counts is public; everything that changes something needs a sign-in from this
 * site. A note is plain text, no links, one per person per kit; a person's first note waits for a maintainer, later ones show at once;
 * two different people reporting a note hides it until a maintainer looks.
 */
async function communityRoutes(request, env, url, path, method) {
  const store = storeFor(env);
  if (!store) return jsonRes({ error: "closed", message: "This is not open yet." }, 503);

  if (path === "/api/counts" && method === "GET") {
    return edgeCached(request, 60, async () => {
      const votes = {}, saves = {};
      for (const r of await store.voteCounts()) votes[r.item] = Number(r.n);
      for (const r of await store.saveCounts()) if (Number(r.n) >= COMMUNITY.savesShownFrom) saves[r.item] = Number(r.n);
      return jsonRes({ votes, saves }, 200, "public, max-age=60");
    });
  }

  if (path === "/api/community" && method === "GET") {
    // the home page's strip: the top three contributors and the three most wanted requests (names only for people who have not hidden theirs)
    return edgeCached(request, 60, async () => {
      let contributors = [];
      try { contributors = (await boardFor(store, await fetchCatalogue(env))).slice(0, 3).map((r) => ({ login: r.login, id: r.id, count: r.count })); } catch { /* an empty list is shown */ }
      const requests = (await store.requestsPublic()).filter((r) => r.status === "open").slice(0, 3).map((r) => ({ id: r.id, title: r.title, needs: Number(r.needs) }));
      return jsonRes({ contributors, requests }, 200, "public, max-age=60");
    });
  }

  const itemAnswer = async (item, s) => {
    const saves = await store.saveCountFor(item);
    const notes = (await store.approvedNotes(item, COMMUNITY.listMax)).map((n) => ({ id: n.id, login: n.login, text: n.text, at: String(n.created_at).slice(0, 10), mine: !!s && n.user_id === s.id }));
    const mine = s ? await store.myNote(s.id, item) : null;
    const by = item.startsWith("https://") ? await store.creditFor(item) : null;
    return jsonRes({ credit: by ? { login: by.login } : null, signedIn: !!s, votes: await store.voteCountFor(item), voted: s ? await store.hasVote(s.id, item) : false, saves: saves >= COMMUNITY.savesShownFrom ? saves : 0, notes, mine: mine ? { text: mine.text, status: mine.status } : null });
  };
  if (path === "/api/item" && method === "GET") {
    const item = cleanItem(url.searchParams.get("item"));
    if (!item) return jsonRes({ error: "bad", message: "That is not a kit." }, 400);
    if (!parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE]) return edgeCached(request, 30, () => itemAnswer(item, null), item);
    return itemAnswer(item, await sessionOf(request, env));
  }

  if (method !== "POST") return jsonRes({ error: "method" }, 405);
  const s = await sessionOf(request, env);
  if (!s) return jsonRes({ error: "not signed in", message: "Sign in first." }, 401);
  if (!sameOrigin(request, env)) return jsonRes({ error: "refused", message: "That request did not come from this site." }, 403);
  let f; try { f = await request.formData(); } catch { return jsonRes({ error: "bad", message: "That did not look right." }, 400); }
  const now = new Date();

  if (path === "/api/note/report") {
    const id = Number(f.get("id"));
    if (!Number.isInteger(id) || id < 1) return jsonRes({ error: "bad", message: "That did not look right." }, 400);
    if ((await store.eventsSince(s.id, "report", new Date(now - 86400_000).toISOString())) >= 20) return jsonRes({ error: "slow", message: "That is a lot of reports for one day." }, 429);
    await store.record(s.id, "report", now.toISOString());
    const state = await store.reportNote(id, s.id, now.toISOString());
    if (state === "hidden-now") await notifyOwner(env, { title: "A note was hidden", message: "Two people reported a note, so it is hidden until you decide.", path: "/admin/notes" });
    return state ? jsonRes({ reported: true }) : jsonRes({ error: "gone", message: "That note is gone." }, 404);
  }

  const item = cleanItem(f.get("item"));
  if (!item) return jsonRes({ error: "bad", message: "That is not a kit." }, 400);

  if (path === "/api/note/delete") return jsonRes({ deleted: await store.deleteOwnNote(s.id, item) });

  const inCatalogue = async () => { try { return (await fetchCatalogue(env)).has(item) ? "yes" : "gone"; } catch { return "down"; } };
  const refused = (where) => (where === "down" ? jsonRes({ error: "down", message: FLASH_ACCOUNT.down }, 503) : jsonRes({ error: "gone", message: FLASH_ACCOUNT.gone }, 404));

  if (path === "/api/vote") {
    if (await store.hasVote(s.id, item)) { await store.removeVote(s.id, item); return jsonRes({ voted: false, votes: await store.voteCountFor(item) }); }
    if ((await store.votesSince(s.id, new Date(now - 3600_000).toISOString())) >= COMMUNITY.votesPerHour) return jsonRes({ error: "slow", message: "That is a lot of votes in an hour. Try again later." }, 429);
    const where = await inCatalogue(); if (where !== "yes") return refused(where);
    await store.record(s.id, "vote", now.toISOString());
    await store.touchUser(s.id, s.sub, now.toISOString());
    await store.addVote(s.id, item, now.toISOString());
    return jsonRes({ voted: true, votes: await store.voteCountFor(item) });
  }

  if (path === "/api/note") {
    const c = cleanNote(f.get("text"));
    if (!c.ok) return jsonRes({ error: "bad", message: c.error }, 400);
    if ((await store.notesSince(s.id, new Date(now - 86400_000).toISOString())) >= COMMUNITY.notesPerDay) return jsonRes({ error: "slow", message: "That is a lot of notes for one day. Try again tomorrow." }, 429);
    const where = await inCatalogue(); if (where !== "yes") return refused(where);
    const trusted = s.role === "admin" || ((await store.hasApprovedNote(s.id)) && !(await store.hasRecentStrike(s.id, now.toISOString())));
    const status = trusted ? "approved" : "pending";
    await store.record(s.id, "note", now.toISOString());
    await store.touchUser(s.id, s.sub, now.toISOString());
    await store.saveNote(s.id, s.sub, item, c.text, status, now.toISOString());
    if (status === "pending") await notifyOwner(env, { title: "A note is waiting", message: `A first note from @${s.sub} is waiting for review.`, path: "/admin/notes" });
    return jsonRes({ saved: true, status });
  }
  return jsonRes({ error: "not found" }, 404);
}

async function notesAdmin(request, env, url, path, method) {
  const s = await sessionOf(request, env);
  const store = storeFor(env);
  if (path === "/admin/notes" && method === "GET") {
    if (!s) return send(signInPage("", { return: "/admin/notes" }));
    if (s.role !== "admin") return send(messagePage("No access", "Only maintainers can review notes.", false), { status: 403 });
    if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
    return send(notesAdminPage({ session: s, rows: await store.notesToReview(), flash: FLASH_ACCOUNT[url.searchParams.get("m")] ?? "" }));
  }
  if (path === "/admin/notes/decide" && method === "POST") {
    const stop = gate(request, env, s); if (stop) return stop;
    if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
    let f; try { f = await request.formData(); } catch { return back("/admin/notes", "bad"); }
    const id = Number(f.get("id")), action = String(f.get("action") ?? "");
    if (!Number.isInteger(id) || id < 1 || !["approve", "hide", "delete"].includes(action)) return back("/admin/notes", "bad");
    await store.decideNote(id, action);
    return back("/admin/notes", "noteDone");
  }
  return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
}

/** The public Contributors board and a person's public page. Only people who switched it on appear; counts are of listings that are live now. */
async function contributorRoutes(request, env, path, method) {
  const s = await sessionOf(request, env), store = storeFor(env);
  if (method !== "GET") return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
  if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
  let catalogue; try { catalogue = await fetchCatalogue(env); } catch { return send(messagePage("Try again", FLASH_ACCOUNT.down, false), { status: 503 }); }
  if (path === "/contributors") return send(contributorsPage({ session: s, rows: await boardFor(store, catalogue) }));
  const m = /^\/u\/([A-Za-z0-9-]{1,39})\/?$/.exec(path);
  const user = m ? await store.userByLogin(m[1]) : null;
  const c = user && Number(user.public) === 1 ? (await contributionsFor(store, catalogue)).get(user.id) : null;
  if (!user || !c || c.count < 1) return send(messagePage("No public profile", "There is no public contributor profile at this address.", false), { status: 404 });
  return send(contributorProfilePage({ session: s, user, c }));
}

/** Kit requests: read by anyone; asking and "I need this too" need a sign-in from this site. Maintainers show, hide, delete and solve (see requestsAdmin). */
async function requestRoutes(request, env, url, path, method) {
  const store = storeFor(env);
  if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
  const s = await sessionOf(request, env);
  const render = async (extra = {}, status = 200) => {
    let catalogue = null; try { catalogue = await fetchCatalogue(env); } catch { /* names of solving kits are left generic */ }
    const all = await store.requestsPublic();
    return send(requestsPage({ session: s, open: all.filter((r) => r.status === "open"), solved: all.filter((r) => r.status === "solved"), mine: s ? await store.myRequests(s.id) : [], needed: new Set(s ? await store.neededBy(s.id) : []), catalogue, flash: FLASH_REQUESTS[url.searchParams.get("m")] ?? "", signedIn: !!s, ...extra }), { status });
  };
  if (path === "/requests" && method === "GET") return render();
  if (method !== "POST") return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
  if (!s) return send(signInPage("Sign in first.", { return: "/requests" }), { status: 401 });
  if (!sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
  let f; try { f = await request.formData(); } catch { return back("/requests", "bad"); }
  const now = new Date();

  if (path === "/requests/new") {
    const values = { title: String(f.get("title") ?? "").slice(0, 300), body: String(f.get("body") ?? "").slice(0, 2000) };
    const c = cleanRequest(f.get("title"), f.get("body"));
    if (!c.ok) return render({ error: c.error, values }, 400);
    if ((await store.requestsSince(s.id, new Date(now - 86400_000).toISOString())) >= REQUESTS.perDay) return render({ error: FLASH_REQUESTS.slow, values }, 429);
    const status = s.role === "admin" || ((await store.hasShownRequest(s.id)) && !(await store.hasRecentStrike(s.id, now.toISOString()))) ? "open" : "pending";
    await store.record(s.id, "request", now.toISOString());
    await store.touchUser(s.id, s.sub, now.toISOString());
    await store.addRequest(s.id, s.sub, c.title, c.body, status, now.toISOString());
    if (status === "pending") await notifyOwner(env, { title: "A request is waiting", message: `A first request from @${s.sub} is waiting for review.`, path: "/admin/requests" });
    return back("/requests", status === "open" ? "posted" : "waiting");
  }
  const id = Number(f.get("id"));
  if (!Number.isInteger(id) || id < 1) return back("/requests", "bad");
  if (path === "/requests/need") {
    if ((await store.needsSince(s.id, new Date(now - 3600_000).toISOString())) >= REQUESTS.needsPerHour) return back("/requests", "slow");
    const r = await store.toggleNeed(s.id, id, now.toISOString());
    if (r && r.needed) await store.record(s.id, "need", now.toISOString());
    return back("/requests", r ? (r.needed ? "needed" : "unneeded") : "gone");
  }
  if (path === "/requests/delete") return back("/requests", (await store.deleteOwnRequest(s.id, id)) ? "deleted" : "gone");
  return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
}

async function requestsAdmin(request, env, url, path, method) {
  const s = await sessionOf(request, env), store = storeFor(env);
  if (path === "/admin/requests" && method === "GET") {
    if (!s) return send(signInPage("", { return: "/admin/requests" }));
    if (s.role !== "admin") return send(messagePage("No access", "Only maintainers can review requests.", false), { status: 403 });
    if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
    return send(requestsAdminPage({ session: s, rows: await store.requestsToReview(), flash: FLASH_REQUESTS[url.searchParams.get("m")] ?? "" }));
  }
  if (path === "/admin/requests/decide" && method === "POST") {
    const stop = gate(request, env, s); if (stop) return stop;
    if (!store) return send(messagePage("Not open yet", "This app has no database connected yet.", false), { status: 503 });
    let f; try { f = await request.formData(); } catch { return back("/admin/requests", "bad"); }
    const id = Number(f.get("id")), action = String(f.get("action") ?? "");
    if (!Number.isInteger(id) || id < 1 || !["show", "hide", "delete", "solve"].includes(action)) return back("/admin/requests", "bad");
    let item = "";
    if (action === "solve") {
      item = cleanItem(f.get("item"));
      let catalogue; try { catalogue = await fetchCatalogue(env); } catch { return back("/admin/requests", "bad"); }
      if (!item || !catalogue.has(item)) return back("/admin/requests", "unsolved");
    }
    await store.decideRequest(id, action, item);
    return back("/admin/requests", "decided");
  }
  return send(messagePage("Not found", "There is nothing here.", false), { status: 404 });
}

async function approveRoute(request, env, s, id) {
  const stop = gate(request, env, s); if (stop) return stop;
  const store = storeFor(env); const base = `/admin/submissions/${id}`;
  if (!store) return send(messagePage("Not available", "This app has no database connected.", false), { status: 503 });
  if (!publishingConfigured(env)) return back(base, "nopublish");
  let f; try { f = await request.formData(); } catch { return back(base, "bad"); }
  const name = oneLine(f.get("name"), 100), kind = String(f.get("kind") ?? ""), text = oneLine(f.get("text"), 500);
  const pick = f.get("pick") === "yes", pickNote = pick ? oneLine(f.get("pick_note"), 300) : "";
  const tags = parseTags(oneLine(f.get("tags"), 400)).join(",");
  if (!name || name.length > 80 || !KINDS.includes(kind) || !text || text.length > 400 || (pick && (!pickNote || pickNote.length > 200))) return back(base, "bad");
  const row = await store.get(id);
  if (!row || row.status !== "pending") return back(base, "already");
  // approving needs the full checks to have run, on a commit we can pin the listing to. The one exception: a repository the checks could not read
  // (too large) may be approved by hand, pinned to the commit the app read when it was submitted. A failed scan can never be approved this way.
  const asked = f.get("by_hand") === "yes";
  const byHand = asked && row.scan_state === "done" && row.scan_label === "needs-manual-review" && /^[0-9a-f]{40}$/.test(String(row.commit_sha ?? ""));
  if (asked && !byHand) return back(base, "needscan");
  if (byHand) { if (f.get("hand_read") !== "yes") return back(base, "needread"); }
  else {
    if (row.scan_state !== "done" || !/^[0-9a-f]{12}$/.test(String(row.scan_commit)) || !["no-flags-found", "checks-flagged"].includes(row.scan_label)) return back(base, "needscan");
    if (row.scan_label === "checks-flagged" && f.get("read") !== "yes") return back(base, "needread");
  }
  if (!(await store.approve(id, { by: s.sub, name, kind, text, at: new Date().toISOString(), pick, note: pickNote, tags }))) return back(base, "already");
  const state = await startPublish(env, store, { ...row, final_name: name, final_kind: kind, final_text: text, final_pick: pick ? 1 : 0, final_note: pickNote, final_tags: tags, decided_by: s.sub, by_hand: byHand });
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

/** True if this visitor is over the rate limit for public reads. Needs the LIMITER binding; without it nothing is limited here (Cloudflare's own rules still apply). */
async function overLimit(env, request) {
  if (!env.LIMITER || typeof env.LIMITER.limit !== "function") return false;
  try { const { success } = await env.LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" }); return !success; } catch { return false; }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // www goes to the main address, so cookies and links never split between two names
  if (url.hostname.startsWith("www.") && env.BASE_URL) return send("", { status: 301, location: String(env.BASE_URL).replace(/\/+$/, "") + "/" + url.pathname.replace(/^\/+/, "") + url.search });
  // two pages that no longer exist: old links still land somewhere useful
  if (path === "/picks" || path === "/picks/") return send("", { status: 301, location: "/kits/?show=pick" });
  if (path === "/updates" || path === "/updates/") { const kit = url.searchParams.get("kit") ?? ""; return send("", { status: 301, location: /^[a-z0-9-]{1,40}$/.test(kit) ? `/k/${kit}/` : "/kits/" }); }
  if (env.ASSETS && !isAppPath(path)) return serveSite(request, env);
  await loadShell(env, request);

  if (path === "/healthz") return send("ok", { type: "text/plain; charset=utf-8" });
  if (path === "/assets/app.css") return send(CSS, { type: "text/css; charset=utf-8", cache: "public, max-age=3600" });

  if ((path.startsWith("/api/") || path === "/auth/login") && (await overLimit(env, request))) return send(JSON.stringify({ error: "slow", message: "Too many requests. Try again in a minute." }), { status: 429, type: "application/json" });
  if (method === "POST" && Number(request.headers.get("Content-Length") ?? 0) > 20_000) return send(messagePage("Too large", "That request is too large.", false), { status: 413 });
  const problem = configProblem(env);
  if (problem) return send(messagePage("Not configured", "This admin app is missing configuration. The owner needs to finish the setup.", false), { status: 503 });

  if (path === "/" && !env.ASSETS) return send("", { status: 302, location: "/admin" });

  if (path === "/auth/login" && method === "GET") {
    // "user" asks GitHub only who you are; the default, "admin", also reads org and team membership
    const mode = url.searchParams.get("mode") === "user" ? "user" : "admin";
    const state = `${mode}.${randomToken()}`;
    const next = mode === "user" ? cleanRepo(url.searchParams.get("next")) : "";
    const save = mode === "user" ? cleanItem(url.searchParams.get("save")) : "";
    const ret = cleanReturn(url.searchParams.get("return"));
    return send("", { status: 302, location: authorizeUrl(env, state, mode === "user" ? "read:user" : "read:user read:org"), cookies: [cookie(STATE_COOKIE, state, { maxAge: STATE_SECONDS }), ...(next ? [cookie(NEXT_COOKIE, next, { maxAge: STATE_SECONDS })] : []), ...(save ? [cookie(SAVE_COOKIE, encodeURIComponent(save), { maxAge: STATE_SECONDS })] : []), ...(ret ? [cookie(RETURN_COOKIE, encodeURIComponent(ret), { maxAge: STATE_SECONDS })] : [])] });
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
      who = mode === "admin" ? await decideRole(token, env) : (await decideRoleByLogin(env, user.login)) ?? { role: "user" }; // the token goes no further than this block
    } catch {
      return send(signInPage("Sign-in could not be completed. Try again in a moment."), { status: 502, cookies: [clearState] });
    }
    const session = await signToken({ sub: user.login, id: user.id, role: who.role, via: who.via ?? "", iat: Date.now(), exp: Date.now() + SESSION_SECONDS * 1000 }, env.SESSION_SECRET);
    const carried = mode === "user" ? cleanRepo(parseCookies(request.headers.get("Cookie"))[NEXT_COOKIE]) : "";
    const savedItem = mode === "user" ? cleanItem(safeDecode(parseCookies(request.headers.get("Cookie"))[SAVE_COOKIE])) : "";
    const back0 = cleanReturn(safeDecode(parseCookies(request.headers.get("Cookie"))[RETURN_COOKIE]));
    const store0 = storeFor(env);
    if (store0) { try { await store0.touchUser(user.id, user.login, new Date().toISOString()); } catch { /* the account record is a convenience; signing in still works */ } }
    const where = mode === "user" ? (savedItem ? `/collection/save?item=${encodeURIComponent(savedItem)}` : carried ? `/submit?url=${encodeURIComponent(carried)}` : (back0 || "/profile")) : (back0 || "/admin");
    return send("", { status: 302, location: where, cookies: [clearState, cookie(NEXT_COOKIE, "", { maxAge: 0 }), cookie(SAVE_COOKIE, "", { maxAge: 0 }), cookie(RETURN_COOKIE, "", { maxAge: 0 }), cookie(SESSION_COOKIE, session, { maxAge: SESSION_SECONDS }), hintCookie(true, SESSION_SECONDS)] });
  }

  if (path === "/auth/logout" && method === "POST") {
    if (!sameOrigin(request, env)) return send(messagePage("Refused", "That request did not come from this site."), { status: 403 });
    return send("", { status: 302, location: "/", cookies: [cookie(SESSION_COOKIE, "", { maxAge: 0 }), hintCookie(false)] });
  }

  if (path === "/api/me" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(JSON.stringify({ error: "not signed in" }), { status: 401, type: "application/json" });
    return send(JSON.stringify({ login: s.sub, id: s.id, role: s.role }), { type: "application/json" });
  }

  if (path === "/submit") {
    const s = await sessionOf(request, env);
    if (method === "GET") {
      const prefill = cleanRepo(url.searchParams.get("url")); // a link from the website form; anything that is not a github.com repository is dropped
      if (!s) return send(signInPage("", { submit: true, next: prefill, return: "/submit" }));
      if (!storeFor(env)) return send(messagePage("Submissions are not open yet", "This app has no database connected yet.", false), { status: 503 });
      let relation = null; // does this person own the repository? GitHub decides, and we say so before they send anything
      const asked = prefill ? parseRepo(prefill) : null;
      if (asked) { try { const info = await fetchRepoInfo(env, asked); relation = { repo: `${info.owner}/${info.name}`, author: await isAuthor(env, info, s.sub) }; } catch { relation = null; } }
      return send(submitPage({ session: s, values: { url: prefill }, isPublic: await store0Public(env, s), relation }));
    }
    if (method === "POST") return s ? submit(request, env, s) : send(signInPage("Sign in first, then submit again.", { submit: true }), { status: 401 });
  }


  if (path === "/collection" || path === "/settings/public" || path === "/api/collection" || path === "/collection/toggle" || path === "/profile" || path === "/settings" || path === "/collection/save" || path === "/collection/remove" || path === "/account/export" || path === "/account/delete") {
    return accountRoutes(request, env, url, path, method);
  }
  if (["/api/counts", "/api/community", "/api/item", "/api/vote", "/api/note", "/api/note/delete", "/api/note/report"].includes(path)) return communityRoutes(request, env, url, path, method);
  if (path === "/admin/notes" || path === "/admin/notes/decide") return notesAdmin(request, env, url, path, method);
  if (path === "/contributors" || path.startsWith("/u/")) return contributorRoutes(request, env, path, method);
  if (path === "/requests" || path.startsWith("/requests/")) return requestRoutes(request, env, url, path, method);
  if (path === "/admin/requests" || path === "/admin/requests/decide") return requestsAdmin(request, env, url, path, method);


  if (path === "/admin" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage("", { return: hereOf(request) }));
    if (s.role !== "admin") return send(messagePage("No access", `You are signed in as @${s.sub}, but only owners of ${env.ORG} and members of ${env.ORG}/${env.TEAM} can maintain the catalogue. If you are one of them, sign in again with organisation access. Ask an owner to add you to the team, then sign in again.`, false, { href: "/auth/login", text: "Sign in with organisation access" }), { status: 403 });
    let queueError = "", subs = null;
    const store = storeFor(env);
    let recent = [], noteCount = 0, requestCount = 0;
    if (store) {
      try { noteCount = await store.notesToReviewCount(); requestCount = await store.requestsToReviewCount(); } catch { /* the count is a convenience */ }
      try { await syncPublishing(env, store, listed(env)); await syncScans(env, store); subs = await store.pending(); recent = await store.recent(); } catch { queueError = queueError || "The submissions database could not be read just now."; }
    }
    return send(adminPage({ session: s, env, queueError, noteCount, requestCount, subs, recent, flash: flashOf(url) }));
  }

  if (path === "/admin/listings" && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage("", { return: hereOf(request) }));
    if (s.role !== "admin") return send(messagePage("No access", "Only maintainers can manage listings.", false), { status: 403 });
    let listings = [], error = "";
    try { listings = await fetchListings(env); } catch (e) { error = e instanceof UserError ? e.message : "The listings could not be loaded."; }
    return send(listingsPage({ session: s, listings, error, flash: flashOf(url), canPublish: publishingConfigured(env) }));
  }
  if ((path === "/admin/listings/edit" || path === "/admin/listings/remove") && method === "POST") return listingRoute(request, env, await sessionOf(request, env), path.endsWith("edit") ? "edit" : "remove");

  const detail = /^\/admin\/submissions\/(\d{1,9})$/.exec(path);
  if (detail && method === "GET") {
    const s = await sessionOf(request, env);
    if (!s) return send(signInPage("", { return: hereOf(request) }));
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
  async fetch(request, env, ctx) {
    rememberContext(ctx);
    try { return await route(request, env); }
    catch { return send(messagePage("Something went wrong", "The request could not be handled. Nothing was changed.", false), { status: 500 }); } // never echo the error
  },
};
