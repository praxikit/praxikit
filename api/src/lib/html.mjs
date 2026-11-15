/** Pages are plain HTML with no scripts at all; the CSP forbids them anyway. Everything dynamic goes through esc(). */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const CSS = `
:root{color-scheme:light dark;--bg:#fafaf7;--fg:#17201f;--muted:#58645f;--line:#dcdad1;--card:#fff;--accent:#0b6b63;--accent-fg:#fff;--warn:#8a4b0c;--warn-bg:#fbf0e0}
@media (prefers-color-scheme:dark){:root{--bg:#0e1514;--fg:#e8f0ee;--muted:#9aaba8;--line:#25332f;--card:#121b1a;--accent:#4fc3b5;--accent-fg:#062320;--warn:#f0a45c;--warn-bg:#2b2114}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{width:min(100% - 32px,960px);margin-inline:auto;padding-block:24px 56px}
a{color:var(--accent)}h1{font-size:1.7rem;margin:.2rem 0 .8rem}h2{font-size:1.15rem;margin:2rem 0 .6rem}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:20px}
.who{display:flex;align-items:center;gap:10px}.who img{width:32px;height:32px;border-radius:50%}
.muted{color:var(--muted);font-size:.93rem}.badge{font-size:.78rem;font-weight:600;padding:2px 8px;border-radius:4px;background:var(--accent);color:var(--accent-fg)}
.note{background:var(--warn-bg);border-left:3px solid var(--warn);padding:9px 13px;margin:1rem 0}
.btn,button{font:inherit;font-size:.95rem;padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);text-decoration:none;cursor:pointer;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--accent)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);font-size:.93rem}th{color:var(--muted);font-weight:600}
ul.links{padding-left:1.2rem}ul.links li{margin:.35rem 0}
`;

export const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/admin.css"></head>
<body><div class="wrap">${body}</div></body></html>`;

export const signInPage = (note = "") => page("Sign in — Praxikit admin", `
<div class="top"><strong>Praxikit admin</strong></div>
<h1>Sign in</h1>
<p>Sign in with GitHub. Maintainers of the catalogue are the owners of the <code>praxikit</code> organisation and the members of its <code>maintainers</code> team.</p>
${note ? `<p class="note">${esc(note)}</p>` : ""}
<p><a class="btn" href="/auth/login">Sign in with GitHub</a></p>
<p class="muted">The app asks GitHub who you are and which organisation and teams you belong to. It does not keep your GitHub token.</p>`);

export const messagePage = (title, text, withHome = true) => page(title, `<div class="top"><strong>Praxikit admin</strong></div><h1>${esc(title)}</h1><p>${esc(text)}</p>${withHome ? '<p><a class="btn ghost" href="/admin">Back</a></p>' : ""}`);

const REPO_LINK = (repo, path) => `https://github.com/${repo}${path}`;

export function adminPage({ session, env, queue, queueError }) {
  const who = esc(session.sub);
  const via = session.via === "owner" ? `an owner of ${esc(env.ORG)}` : `a member of ${esc(env.ORG)}/${esc(env.TEAM)}`;
  const rows = queue.map((q) => `<tr><td><a href="${esc(REPO_LINK(env.REPO, `/issues/${q.number}`))}" rel="noopener noreferrer">#${q.number}</a></td><td>${esc(q.title)}</td><td>${esc(q.by)}</td><td>${esc(q.label)}</td><td>${esc(q.checks || "waiting")}</td><td>${esc(q.created)}</td></tr>`).join("");
  return page("Admin — Praxikit", `
<div class="top"><strong>Praxikit admin</strong>
<div class="who"><img src="https://avatars.githubusercontent.com/u/${Number(session.id)}?s=64" alt="" width="32" height="32"><span>@${who} <span class="badge">maintainer</span></span>
<form method="post" action="/auth/logout"><button class="ghost" type="submit">Sign out</button></form></div></div>
<h1>Catalogue admin</h1>
<p class="muted">You can maintain the catalogue because you are ${via}.</p>
<p class="note">Phase 1: sign-in and this read-only view. Approving, rejecting and adding still happen on GitHub (label an issue, or run the workflows below). Doing it here comes next.</p>
<h2>Waiting for review</h2>
${queueError ? `<p class="note">${esc(queueError)}</p>` : rows ? `<table><thead><tr><th>Issue</th><th>Title</th><th>By</th><th>Kind</th><th>Checks</th><th>Opened</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nothing is waiting.</p>'}
<h2>Shortcuts</h2>
<ul class="links">
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/add-listing.yml"))}" rel="noopener noreferrer">Add a listing</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/remove-listing.yml"))}" rel="noopener noreferrer">Remove a listing</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/listing-drift.yml"))}" rel="noopener noreferrer">Re-check listings for changes</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/issues?q=is%3Aissue+is%3Aopen+label%3Areport"))}" rel="noopener noreferrer">Reports</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/blob/main/docs/removals.md"))}" rel="noopener noreferrer">Removal log</a></li>
</ul>`);
}
