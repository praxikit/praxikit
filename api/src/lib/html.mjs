/** Pages are plain HTML with no scripts at all; the CSP forbids them anyway. Everything dynamic goes through esc(). */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const CSS = `
:root{color-scheme:light dark;--bg:#fafaf7;--fg:#17201f;--muted:#58645f;--line:#dcdad1;--card:#fff;--accent:#0b6b63;--accent-fg:#fff;--warn:#8a4b0c;--warn-bg:#fbf0e0;--bad:#a3261f}
@media (prefers-color-scheme:dark){:root{--bg:#0e1514;--fg:#e8f0ee;--muted:#9aaba8;--line:#25332f;--card:#121b1a;--accent:#4fc3b5;--accent-fg:#062320;--warn:#f0a45c;--warn-bg:#2b2114;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{width:min(100% - 32px,960px);margin-inline:auto;padding-block:24px 56px}
a{color:var(--accent)}h1{font-size:1.7rem;margin:.2rem 0 .8rem}h2{font-size:1.15rem;margin:2rem 0 .6rem}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:20px}
.who{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.who img{width:32px;height:32px;border-radius:50%}
.muted{color:var(--muted);font-size:.93rem}.badge{font-size:.78rem;font-weight:600;padding:2px 8px;border-radius:4px;background:var(--accent);color:var(--accent-fg)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.bad{background:var(--bad);color:#fff}
.note{background:var(--warn-bg);border-left:3px solid var(--warn);padding:9px 13px;margin:1rem 0}
.ok{background:var(--card);border-left:3px solid var(--accent);padding:9px 13px;margin:1rem 0}
.btn,button{font:inherit;font-size:.95rem;padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);text-decoration:none;cursor:pointer;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--accent)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);font-size:.93rem;vertical-align:top}th{color:var(--muted);font-weight:600}
ul.links{padding-left:1.2rem}ul.links li{margin:.35rem 0}
label{display:block;font-weight:600;margin:1rem 0 .3rem}input[type=text],input[type=url],textarea{width:100%;font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
textarea{min-height:5rem;resize:vertical}.hint{font-weight:400;color:var(--muted);font-size:.88rem}
blockquote{margin:.5rem 0;padding:.4rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:6px 18px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
`;

// the stylesheet is cached for an hour, so its address changes whenever its content does
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
export const CSS_V = hash(CSS);

export const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/admin.css?v=${CSS_V}"></head>
<body><div class="wrap">${body}</div></body></html>`;

const logoutForm = '<form method="post" action="/auth/logout"><button class="ghost" type="submit">Sign out</button></form>';
const nav = (s) => `<div class="top"><strong>Praxikit</strong><div class="who">${s ? `<img src="https://avatars.githubusercontent.com/u/${Number(s.id)}?s=64" alt="" width="32" height="32"><span>@${esc(s.sub)}${s.role === "admin" ? ' <span class="badge">maintainer</span>' : ""}</span>${logoutForm}` : ""}</div></div>`;

export const signInPage = (note = "", opts = {}) => page("Sign in — Praxikit", `
<div class="top"><strong>Praxikit</strong></div>
<h1>${opts.submit ? "Sign in to submit a kit" : "Sign in"}</h1>
${opts.submit
    ? `<p>Sign in with GitHub, then paste the link to a public repository. We ask GitHub only who you are (your username); nothing else is read or kept.</p>
${note ? `<p class="note">${esc(note)}</p>` : ""}<p><a class="btn" href="/auth/login?mode=user">Sign in with GitHub to submit</a></p>
<p class="muted">Maintainers: <a href="/auth/login">sign in here</a>.</p>`
    : `<p>Sign in with GitHub. Maintainers of the catalogue are the owners of the <code>praxikit</code> organisation and the members of its <code>maintainers</code> team.</p>
${note ? `<p class="note">${esc(note)}</p>` : ""}<p><a class="btn" href="/auth/login">Sign in with GitHub</a></p>
<p class="muted">The app asks GitHub who you are and which organisation and teams you belong to. It does not keep your GitHub token. To submit a kit, <a href="/submit">go here</a>.</p>`}`);

export const messagePage = (title, text, withHome = true) => page(title, `<div class="top"><strong>Praxikit</strong></div><h1>${esc(title)}</h1><p>${esc(text)}</p>${withHome ? '<p><a class="btn ghost" href="/admin">Back</a></p>' : ""}`);

const REPO_LINK = (repo, path) => `https://github.com/${repo}${path}`;
const SRC = { community: "Community (by its author)", recommended: "Recommended (by someone else)" };
const checks = (json) => { try { const a = JSON.parse(json); return Array.isArray(a) ? a.map((c) => ({ title: String(c?.title ?? ""), status: String(c?.status ?? ""), note: String(c?.note ?? "") })) : []; } catch { return []; } };
const status = (s) => (s === "pass" ? "Pass" : s === "flag" ? "Look closer" : s === "fail" ? "Fail" : esc(s));

export function submitPage({ session, flash, error, values = {} }) {
  return page("Submit a kit — Praxikit", `${nav(session)}
<h1>Submit a kit</h1>
<p>Paste the link to a public GitHub repository. We read its name, owner, licence and README from GitHub; you do not need to describe it. A person reviews every submission before anything is listed, and nothing is listed for payment.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${error ? `<p class="note">${esc(error)}</p>` : ""}
<form method="post" action="/submit">
<label for="url">Repository link</label><input id="url" name="url" type="url" required maxlength="200" placeholder="https://github.com/owner/repo" value="${esc(values.url ?? "")}">
<label for="why">Note <span class="hint">(optional, up to 200 characters; shown if you are recommending someone else's kit)</span></label><textarea id="why" name="why" maxlength="200">${esc(values.why ?? "")}</textarea>
<p><button type="submit">Submit for review</button> <a class="btn ghost" href="/mine">My submissions</a></p>
</form>
<p class="muted">If you are the repository's owner (or a public member of its organisation), it is listed as a community kit by its author. Otherwise it is a recommendation. GitHub decides which, not the form.</p>`);
}

export function minePage({ session, rows, flash }) {
  const body = rows.length
    ? `<table><thead><tr><th>Repository</th><th>As</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="${esc(r.repo_url)}" rel="noopener noreferrer">${esc(r.name)}</a></td><td>${esc(r.source)}</td><td>${esc(r.status)}</td><td>${esc(String(r.created_at).slice(0, 10))}</td></tr>`).join("")}</tbody></table>`
    : '<p class="muted">You have not submitted anything yet.</p>';
  return page("My submissions — Praxikit", `${nav(session)}<h1>My submissions</h1>${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${body}<p><a class="btn" href="/submit">Submit another</a></p>`);
}

export function adminPage({ session, env, queue, queueError, subs }) {
  const via = session.via === "owner" ? `an owner of ${esc(env.ORG)}` : `a member of ${esc(env.ORG)}/${esc(env.TEAM)}`;
  const issueRows = queue.map((q) => `<tr><td><a href="${esc(REPO_LINK(env.REPO, `/issues/${q.number}`))}" rel="noopener noreferrer">#${q.number}</a></td><td>${esc(q.title)}</td><td>${esc(q.by)}</td><td>${esc(q.label)}</td><td>${esc(q.checks || "waiting")}</td><td>${esc(q.created)}</td></tr>`).join("");
  const subRows = (subs ?? []).map((s) => `<tr><td><a href="/admin/submissions/${Number(s.id)}">${esc(s.name)}</a><br><span class="muted">${esc(s.owner)}</span></td><td>${esc(s.kind_guess || "?")}</td><td>${esc(s.source)}</td><td>${esc(s.license || "none")}</td><td>${status(s.precheck_status)}</td><td>${esc(s.submitted_by)}</td><td>${esc(String(s.created_at).slice(0, 10))}</td></tr>`).join("");
  return page("Admin — Praxikit", `${nav(session)}
<h1>Catalogue admin</h1>
<p class="muted">You can maintain the catalogue because you are ${via}.</p>
<p class="note">Phase 2: submissions from the new form are collected and shown here, read-only. Approving, rejecting and adding still happen on GitHub (label an issue, or run the workflows below). Doing it here comes next.</p>
${subs ? `<h2>New submissions (${subs.length})</h2>${subRows ? `<table><thead><tr><th>Repository</th><th>Type</th><th>As</th><th>Licence</th><th>Quick check</th><th>By</th><th>Opened</th></tr></thead><tbody>${subRows}</tbody></table>` : '<p class="muted">Nothing is waiting.</p>'}` : ""}
<h2>Waiting for review${subs ? " (issue forms)" : ""}</h2>
${queueError ? `<p class="note">${esc(queueError)}</p>` : issueRows ? `<table><thead><tr><th>Issue</th><th>Title</th><th>By</th><th>Kind</th><th>Checks</th><th>Opened</th></tr></thead><tbody>${issueRows}</tbody></table>` : '<p class="muted">Nothing is waiting.</p>'}
<h2>Shortcuts</h2>
<ul class="links">
<li><a href="/submit">Open the submit form</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/add-listing.yml"))}" rel="noopener noreferrer">Add a listing</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/remove-listing.yml"))}" rel="noopener noreferrer">Remove a listing</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/listing-drift.yml"))}" rel="noopener noreferrer">Re-check listings for changes</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/issues?q=is%3Aissue+is%3Aopen+label%3Areport"))}" rel="noopener noreferrer">Reports</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/blob/main/docs/removals.md"))}" rel="noopener noreferrer">Removal log</a></li>
</ul>`);
}

export function detailPage({ session, s }) {
  const cs = checks(s.precheck);
  const commitUrl = `${s.repo_url}/commit/${s.commit_sha}`;
  return page(`${s.name} — Praxikit admin`, `${nav(session)}
<p class="muted"><a href="/admin">All submissions</a></p>
<h1>${esc(s.name)} <span class="badge${s.precheck_status === "fail" ? " bad" : s.precheck_status === "flag" ? " warn" : ""}">${status(s.precheck_status)}</span></h1>
<dl>
<dt>Repository</dt><dd><a href="${esc(s.repo_url)}" rel="noopener noreferrer">${esc(s.repo_url)}</a></dd>
<dt>Created by</dt><dd>${esc(s.owner)} (${esc(s.owner_type)})</dd>
<dt>Submitted by</dt><dd>@${esc(s.submitted_by)} on ${esc(String(s.created_at).slice(0, 10))}</dd>
<dt>Would be listed as</dt><dd>${esc(SRC[s.source] ?? s.source)}</dd>
<dt>Type (a guess)</dt><dd>${esc(s.kind_guess || "not recognised")}</dd>
<dt>Licence</dt><dd>${esc(s.license || "none detected")}</dd>
<dt>Commit looked at</dt><dd><a href="${esc(commitUrl)}" rel="noopener noreferrer"><code>${esc(String(s.commit_sha).slice(0, 7))}</code></a></dd>
<dt>Status</dt><dd>${esc(s.status)}</dd>
</dl>
<h2>README (first part, plain text)</h2>
${s.readme_excerpt ? `<blockquote>${esc(s.readme_excerpt)}</blockquote>` : '<p class="muted">No README text could be read.</p>'}
${s.readme_url ? `<p><a href="${esc(s.readme_url)}" rel="noopener noreferrer">View the README on GitHub</a></p>` : ""}
${s.why ? `<h2>Note from the submitter</h2><blockquote>${esc(s.why)}</blockquote>` : ""}
<h2>Quick checks</h2>
<table><thead><tr><th>Check</th><th>Result</th><th>Note</th></tr></thead><tbody>${cs.map((c) => `<tr><td>${esc(c.title)}</td><td>${status(c.status)}</td><td>${esc(c.note)}</td></tr>`).join("")}</tbody></table>
<p class="muted">These are quick checks from GitHub's own data. The full read-only scan of the code (secrets, auto-run code, network access, hidden instructions) runs when a maintainer approves.</p>`);
}
