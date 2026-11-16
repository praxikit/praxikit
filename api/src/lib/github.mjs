/**
 * The few GitHub calls the app makes. The user's OAuth token is used here, once, to learn who they
 * are and whether they may maintain the catalogue, and is then dropped: it is never stored, put in a
 * cookie, or sent to the browser.
 */
const API = "https://api.github.com";
const UA = "praxikit-admin";

const headers = (token) => ({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

export function authorizeUrl(env, state, scope = "read:user read:org") {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", `${env.BASE_URL.replace(/\/+$/, "")}/auth/callback`); // fixed from config, never from the request
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "false");
  return u.toString();
}

export async function exchangeCode(env, code) {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${env.BASE_URL.replace(/\/+$/, "")}/auth/callback` }),
  });
  if (!r.ok) throw new Error("token exchange failed");
  const j = await r.json();
  if (typeof j.access_token !== "string" || !j.access_token) throw new Error("no token returned");
  return j.access_token;
}

export async function getUser(token) {
  const r = await fetch(`${API}/user`, { headers: headers(token) });
  if (!r.ok) throw new Error("could not read the user");
  const u = await r.json();
  if (typeof u.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(u.login) || !Number.isInteger(u.id)) throw new Error("unexpected user shape");
  return { login: u.login, id: u.id };
}

/** The signed-in user's own membership of the org: { state, role } or null. Works for private members. */
export async function getOrgMembership(token, org) {
  const r = await fetch(`${API}/user/memberships/orgs/${encodeURIComponent(org)}`, { headers: headers(token) });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error("could not read org membership");
  const m = await r.json();
  return { state: m.state, role: m.role };
}

/** Is the signed-in user a member of the named team in the org? Reads up to 300 of their teams. */
export async function inTeam(token, org, team) {
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`${API}/user/teams?per_page=100&page=${page}`, { headers: headers(token) });
    if (!r.ok) throw new Error("could not read teams");
    const teams = await r.json();
    if (!Array.isArray(teams)) return false;
    if (teams.some((t) => t?.slug === team && String(t?.organization?.login ?? "").toLowerCase() === org.toLowerCase())) return true;
    if (teams.length < 100) return false;
  }
  return false;
}

/**
 * Who may maintain the catalogue: an active owner of the org, or a member of its maintainers team.
 * Returns { role: "admin", via: "owner" | "team" } or { role: "user" }.
 */
export async function decideRole(token, env) {
  const org = env.ORG, team = env.TEAM;
  const m = await getOrgMembership(token, org);
  if (m && m.state === "active" && m.role === "admin") return { role: "admin", via: "owner" };
  if (m && m.state === "active" && (await inTeam(token, org, team))) return { role: "admin", via: "team" };
  return { role: "user" };
}

/**
 * The same question asked from the server's side: is this GitHub login an owner of the org or in its maintainers team?
 * Uses GITHUB_ORG_TOKEN (a fine-grained token with the organisation permission "Members: read"), so a person never has to
 * grant organisation access themselves. Returns { role, via } or null if the token is not set or GitHub cannot answer.
 */
export async function decideRoleByLogin(env, login) {
  const tok = env.GITHUB_ORG_TOKEN;
  if (!tok || String(tok).startsWith("REPLACE") || !/^[A-Za-z0-9-]{1,39}$/.test(String(login))) return null;
  const get = async (path) => { const r = await fetch(`${API}${path}`, { headers: headers(tok) }); if (r.status === 404) return null; if (!r.ok) throw new Error("org lookup failed"); return r.json(); };
  try {
    const m = await get(`/orgs/${encodeURIComponent(env.ORG)}/memberships/${encodeURIComponent(login)}`);
    if (!m || m.state !== "active") return { role: "user" };
    if (m.role === "admin") return { role: "admin", via: "owner" };
    const t = await get(`/orgs/${encodeURIComponent(env.ORG)}/teams/${encodeURIComponent(env.TEAM)}/memberships/${encodeURIComponent(login)}`);
    return t && t.state === "active" ? { role: "admin", via: "team" } : { role: "user" };
  } catch { return null; }
}

/** Open submissions and recommendations from the existing issue forms (read only, phase 1). */
export async function listPending(env) {
  const repo = env.REPO;
  const out = [];
  for (const label of ["submission", "recommendation"]) {
    const r = await fetch(`${API}/repos/${repo}/issues?state=open&labels=${label}&per_page=30`, { headers: headers(env.GITHUB_TOKEN) });
    if (!r.ok) throw new Error("could not read issues");
    for (const i of await r.json()) {
      if (i.pull_request || !Number.isInteger(i.number)) continue;
      out.push({ number: i.number, title: String(i.title ?? "").slice(0, 120), by: String(i.user?.login ?? "").slice(0, 39), label, created: String(i.created_at ?? "").slice(0, 10), checks: (i.labels ?? []).map((l) => l?.name).find((n) => ["no-flags-found", "checks-flagged", "checks-failed", "needs-manual-review"].includes(n)) ?? "" });
    }
  }
  return out.sort((a, b) => b.number - a.number);
}
