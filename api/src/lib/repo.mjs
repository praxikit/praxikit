/**
 * Looking up a public GitHub repository for a submission. Everything that comes back is treated as
 * untrusted: it is validated, cut down to plain text, and escaped again when shown. Nothing from a
 * README is ever rendered as markup or HTML, and nothing here runs code from the repository.
 */
const API = "https://api.github.com";
import { parseTags } from "./tags.mjs";

const UA = "praxikit-admin";
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_.-])?$/;

const headers = (token, extra = {}) => ({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });

export class UserError extends Error {}

/** Only https://github.com/<owner>/<repo>[.git][/anything]. Anything else is refused, never fetched. */
export function parseRepo(text) {
  const m = /https:\/\/[^\s)>\]"']+/.exec(String(text ?? "").trim());
  let u;
  try { u = new URL(m ? m[0] : String(text ?? "").trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password || u.port) return null;
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length < 2) return null;
  const owner = seg[0], repo = seg[1].replace(/\.git$/, "");
  if (!NAME.test(owner) || !NAME.test(repo) || owner.includes("..") || repo.includes("..")) return null;
  return { owner, repo, key: `${owner}/${repo}`.toLowerCase(), url: `https://github.com/${owner}/${repo}` };
}

/** Plain text only: code, HTML, images, links, badges and markup are dropped; at most `max` characters. */
export function readmeExcerpt(md, max = 240) {
  let t = String(md ?? "").slice(0, 200_000);
  t = t.replace(/```[\s\S]*?```/g, "\n").replace(/~~~[\s\S]*?~~~/g, "\n");
  t = t.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ");
  // a link target may contain one level of parentheses, as in javascript:alert(1)
  const target = "\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)";
  t = t.replace(new RegExp(`!\\[[^\\]]*\\]${target}`, "g"), " ").replace(new RegExp(`\\[([^\\]]*)\\]${target}`, "g"), "$1").replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  t = t.replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, " ");
  const paras = t.split(/\n\s*\n/).map((p) => p.replace(/^[#>\-*+\s|=]+/gm, " ").replace(/[*_`~]/g, "").replace(/https?:\/\/\S+/g, " ").replace(/@/g, "(at)").replace(/\s+/g, " ").trim());
  let s = paras.find((p) => p.length >= 40 && /[A-Za-z]{3,}.* [A-Za-z]{2,}/.test(p)) ?? paras.find((p) => p.length >= 15) ?? "";
  if (s.length > max) { s = s.slice(0, max); const cut = s.lastIndexOf(" "); s = s.slice(0, cut > 120 ? cut : max) + "…"; }
  return s.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** What kind of kit the file names suggest. A guess: a maintainer confirms it. */
export function guessKind(paths) {
  const has = (re) => paths.some((p) => re.test(p));
  if (has(/(^|\/)\.claude-plugin\/plugin\.json$/)) return "plugin";
  if (has(/(^|\/)\.mcp\.json$/) || has(/(^|\/)mcp\.json$/)) return "mcp";
  if (has(/(^|\/)SKILL\.md$/)) return "skill";
  if (has(/^\.cursorrules$/) || has(/^AGENTS\.md$/)) return "template";
  return "";
}

async function gh(env, path, extraHeaders) {
  let r;
  try { r = await fetch(`${API}${path}`, { headers: headers(env.GITHUB_TOKEN, extraHeaders) }); } catch { throw new UserError("GitHub could not be reached just now. Try again in a minute."); }
  if (r.status === 403 || r.status === 429) throw new UserError("GitHub is busy right now. Try again in a few minutes.");
  return r;
}

/** Everything the review needs, from public GitHub data. Throws UserError with a message safe to show. */
/** The newest commit on the default branch, or "" when it cannot be read. Two small calls; used to keep "the commit you read" and "the commit that is pinned" the same. */
export async function latestCommit(env, repo) {
  try {
    const r = await gh(env, `/repos/${repo.owner}/${repo.repo}`);
    if (!r.ok) return "";
    const branch = String((await r.json()).default_branch ?? "");
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch)) return "";
    const c = await gh(env, `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(branch)}`);
    if (!c.ok) return "";
    const sha = String((await c.json()).sha ?? "");
    return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
  } catch { return ""; }
}

export async function fetchRepoInfo(env, repo) {
  const r = await gh(env, `/repos/${repo.owner}/${repo.repo}`);
  if (r.status === 404) throw new UserError("That repository was not found, or it is private. Only public repositories can be submitted.");
  if (!r.ok) throw new UserError("GitHub could not tell us about that repository. Try again later.");
  const info = await r.json();
  if (info.private) throw new UserError("That repository is private. Only public repositories can be submitted.");
  const branch = String(info.default_branch ?? "");
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch)) throw new UserError("That repository's default branch has an unusual name, so it cannot be checked automatically.");

  const c = await gh(env, `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(branch)}`);
  if (!c.ok) throw new UserError("The latest commit could not be read. Is the repository empty?");
  const commit = String((await c.json()).sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new UserError("The latest commit could not be read.");

  let paths = [], truncated = false;
  const t = await gh(env, `/repos/${repo.owner}/${repo.repo}/git/trees/${commit}?recursive=1`);
  if (t.ok) { const j = await t.json(); truncated = !!j.truncated; paths = (Array.isArray(j.tree) ? j.tree : []).slice(0, 5000).map((x) => String(x.path ?? "")); }

  let excerpt = "", readmePath = "";
  const rd = await gh(env, `/repos/${repo.owner}/${repo.repo}/readme`);
  if (rd.ok) {
    const j = await rd.json();
    if (typeof j.path === "string" && /^[A-Za-z0-9._/-]{1,100}$/.test(j.path)) readmePath = j.path;
    if (j.encoding === "base64" && typeof j.content === "string" && j.content.length < 400_000) {
      try { excerpt = readmeExcerpt(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0)))); } catch { /* unreadable README: no excerpt */ }
    }
  }

  const ownerLogin = String(info.owner?.login ?? repo.owner);
  return {
    name: String(info.name ?? repo.repo).slice(0, 80), owner: ownerLogin, ownerType: info.owner?.type === "Organization" ? "Organization" : "User",
    license: info.license?.spdx_id && info.license.spdx_id !== "NOASSERTION" ? String(info.license.spdx_id).slice(0, 40) : "",
    archived: !!info.archived, fork: !!info.fork, pushedAt: String(info.pushed_at ?? "").slice(0, 10),
    commit, readmeUrl: readmePath ? `https://github.com/${repo.owner}/${repo.repo}/blob/${commit}/${readmePath}` : "",
    excerpt, kind: guessKind(paths), truncated, topics: parseTags(Array.isArray(info.topics) ? info.topics.slice(0, 30).map((x) => String(x).slice(0, 40)).join(",") : ""),
  };
}

/** Is `login` the owner, or a public member of the owning organisation? (Private members count as recommenders.) */
export async function isAuthor(env, info, login) {
  if (info.owner.toLowerCase() === String(login).toLowerCase()) return true;
  if (info.ownerType !== "Organization") return false;
  try {
    const r = await fetch(`${API}/orgs/${encodeURIComponent(info.owner)}/public_members/${encodeURIComponent(login)}`, { headers: headers(env.GITHUB_TOKEN) });
    return r.status === 204;
  } catch { return false; }
}

/** Is this repository already in the live catalogue? Fails open: if listings cannot be read, it says no. */
export async function alreadyListed(env, key) {
  try {
    const r = await fetch(`${API}/repos/${env.REPO}/contents/site/listings.json`, { headers: headers(env.GITHUB_TOKEN, { Accept: "application/vnd.github.raw+json" }) });
    if (!r.ok) return false;
    const list = JSON.parse(await r.text());
    return Array.isArray(list) && list.some((l) => String(l?.url ?? "").toLowerCase().replace(/\/+$/, "") === `https://github.com/${key}`);
  } catch { return false; }
}

/** The listings that are live right now, cut down to the fields the management page shows. Throws UserError if they cannot be read. */
export async function fetchListings(env) {
  let r;
  try { r = await fetch(`${API}/repos/${env.REPO}/contents/site/listings.json`, { headers: headers(env.GITHUB_TOKEN, { Accept: "application/vnd.github.raw+json" }) }); } catch { throw new UserError("GitHub could not be reached just now. Try again in a minute."); }
  if (!r.ok) throw new UserError("The listings could not be read from GitHub just now. Try again in a minute.");
  let list; try { list = JSON.parse(await r.text()); } catch { throw new UserError("The listings file could not be read."); }
  if (!Array.isArray(list)) throw new UserError("The listings file could not be read.");
  const s = (v, n) => String(v ?? "").slice(0, n);
  return list.map((l) => ({ url: s(l?.url, 200), name: s(l?.name, 80), why: s(l?.why, 400), kind: s(l?.kind, 20), source: s(l?.source, 20), checks: s(l?.checks, 30), pick: !!l?.pick, note: s(l?.note, 200), tags: Array.isArray(l?.tags) ? l.tags.slice(0, 12).map((t) => s(t, 24)) : [], commit: s(l?.commit, 40) })).filter((l) => parseRepo(l.url)?.url === l.url);
}

/** The cheap checks that can run in the app. The full read-only scan runs when a maintainer approves. */
export function precheck(info) {
  const checks = [];
  checks.push({ title: "Licence", status: info.license ? "pass" : "fail", note: info.license ? `GitHub detects ${info.license}` : "GitHub detects no licence. Listing needs a licence that lets others use the work." });
  checks.push({ title: "Recognisable kit contents", status: info.kind ? "pass" : "flag", note: info.kind ? `File names suggest a ${info.kind}` : "No plugin manifest, SKILL.md, .mcp.json or agent rules file found by name. A maintainer needs to check what this is." });
  const old = info.pushedAt && Date.now() - Date.parse(info.pushedAt) > 2 * 365 * 24 * 3600 * 1000;
  const flags = [info.archived ? "the repository is archived" : "", info.fork ? "it is a fork" : "", old ? "no commits in over two years" : "", info.truncated ? "the file list was too large to read fully" : ""].filter(Boolean);
  checks.push({ title: "Repository state", status: flags.length ? "flag" : "pass", note: flags.length ? `Worth a look: ${flags.join(", ")}.` : "Active, not archived, not a fork." });
  const status = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "flag") ? "flag" : "pass";
  return { checks, status };
}
