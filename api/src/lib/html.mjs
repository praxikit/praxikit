/** Pages are plain HTML with no scripts at all; the CSP forbids them anyway. Everything dynamic goes through esc(). */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const APP_CSS = `
.app{padding-block:var(--s6) var(--s8)}
.app h1{font-size:clamp(1.6rem,1rem + 1.6vw,2.2rem);margin:0 0 var(--s4);max-width:none;letter-spacing:-.02em}
.app h2{font-size:1.25rem;margin:var(--s7) 0 var(--s3)}
.app p{max-width:70ch}
.app .muted{color:var(--muted);font-size: var(--fs-sm)}
.app .badge{font-size: var(--fs-xs);font-weight:600;padding:2px 8px;border-radius:8px;background:var(--accent);color:var(--accent-fg)}
.app .badge.warn{background:var(--warn-bg);color:var(--warn)}.app .badge.bad{background:var(--bad);color:#fff}
.app .note{background:var(--warn-bg);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);padding:var(--s3) var(--s4);margin:var(--s4) 0;border-radius:var(--radius-sm)}
.app .ok{background:var(--card);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);padding:var(--s3) var(--s4);margin:var(--s4) 0;border-radius:var(--radius-sm)}
.app .btn,.app button{font:inherit;font-size: var(--fs-sm);min-height:var(--control);padding:0 var(--s4);border-radius:var(--radius-sm);display:inline-flex;align-items:center;justify-content:center;font-weight:600;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);text-decoration:none;cursor:pointer}
.app button.ghost,.app .btn.ghost{background:transparent;color:var(--accent)}
.app button.ghost:hover,.app .btn.ghost:hover{background:var(--accent-bg);filter:none}
.app .btn.ghost{border:0;box-shadow:inset 0 0 0 2px var(--accent)}
.app button[disabled]{opacity:.5;cursor:not-allowed}
.app .table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.app table{width:100%;border-collapse:collapse;background:transparent;border:0}
.app th,.app td{text-align:left;padding:var(--s3) var(--s4);border-bottom:1px solid var(--line);font-size: var(--fs-sm);vertical-align:top}
.app th{color:var(--muted);font-weight:600;font-size:var(--fs-xs);letter-spacing:.02em}.app tbody tr:last-child td{border-bottom:0}
.app ul.links{padding-left:1.2rem}.app ul.links li{margin:var(--s2) 0}
.app label{display:block;font-weight:600;margin:var(--s5) 0 var(--s2)}
.app label.check{font-weight:400;display:flex;gap:8px;align-items:center}
.app input[type=text],.app input[type=url],.app textarea{width:100%;max-width:640px;font:inherit;min-height:var(--control);padding:0 var(--s4);border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--fg)}
.app textarea{min-height:6rem;padding:var(--s3) var(--s4);resize:vertical}
.app select{font:inherit;min-height:var(--control);padding:0 var(--s3);border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--fg)}
.app .hint{font-weight:400;color:var(--muted);font-size: var(--fs-sm)}
.app blockquote{margin:.5rem 0;padding:.4rem 1rem;border-left:1px solid var(--line);color:var(--muted)}
.app dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:6px 18px}.app dt{color:var(--muted)}.app dd{margin:0;overflow-wrap:anywhere}
.app ul.plain{list-style:none;padding:0;margin:0}
.app .listing{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);padding:var(--s4) var(--s5);margin:var(--s3) 0}
.app .listing summary{cursor:pointer}.app .listing .danger{margin-top:18px;padding-top:6px;border-top:1px dashed var(--line)}
.app .profile-head{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.app .profile-head img{width:72px;height:72px;border-radius:50%;border:1px solid var(--line)}
.app .profile-head h1{margin:0}
.app .cards{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin:var(--s4) 0}
.app .cards a{display:block;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);padding:var(--s4) var(--s5);text-decoration:none;color:var(--fg)}
.app .cards a:hover{border-color:var(--accent)}
.app .cards strong{display:block}
.app .requests{list-style:none;padding:0;margin:0 0 1.5rem;display:grid;gap:12px}
.app .request{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:var(--s4) var(--s5);box-shadow:none}
.app .request h3{margin:0 0 .25rem;font-size: var(--fs-lg)}.app .request p{margin:.2rem 0}
.app .request.solved{border-color:var(--accent)}
.app .req-main{min-width:0}
.app .need-btn{flex:none;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-weight:650;font-size: var(--fs-sm);text-decoration:none;cursor:pointer}
.app .need-btn:hover{border-color:var(--accent);color:var(--accent)}
.app .need-btn[aria-pressed="true"]{background:var(--accent-bg);border-color:var(--accent);color:var(--accent)}
.app .need-btn .count{padding:0 8px;border-radius:99px;background:var(--code-bg);color:var(--muted);font-size: var(--fs-sm)}
.app .req-form{max-width:640px;margin:1rem 0 2rem}
@media (max-width:560px){.app .request{flex-direction:column}}
.app .adm-tabs{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s3)}
.app .adm-tabs a{display:inline-flex;align-items:center;gap:var(--s2);min-height:var(--control);padding:0 var(--s4);border-radius:99px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);color:var(--fg);text-decoration:none;font-weight:650}
.app .adm-tabs a:hover{box-shadow:inset 0 0 0 2px var(--accent)}
.app .adm-tabs a[aria-current="page"]{background:var(--fg);color:var(--bg);box-shadow:none}
.app .adm-tabs .n{min-width:1.6em;padding:0 var(--s2);border-radius:99px;background:var(--accent);color:var(--accent-fg);font-size:var(--fs-xs);text-align:center}
.app .chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:var(--fs-xs);font-weight:650;white-space:nowrap}
.app .chip.ok{background:var(--accent-bg);color:var(--accent)}.app .chip.flag{background:var(--warn-bg);color:var(--warn)}.app .chip.bad{background:var(--bad);color:#fff}.app .chip.muted{background:var(--bg2);color:var(--muted)}
.app table.queue tbody tr:hover,.app table.queue tbody tr:has(a.row-link:focus-visible){background:var(--bg2)}
.app a.row-link{font-weight:650}.app a.row-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.app ul.toolgrid{list-style:none;padding:0;margin:var(--s3) 0;display:grid;gap:var(--s3);grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.app ul.toolgrid li{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:var(--s4);font-size:var(--fs-sm);color:var(--muted)}
.app ul.toolgrid li a{display:block;font-weight:650;font-size:var(--fs-md);margin-bottom:var(--s1)}
.app .sub-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s6);align-items:start}
.app .sub-decide h2:first-child{margin-top:0}
@media(min-width:1040px){.app .sub-layout{grid-template-columns:minmax(0,1.1fr) minmax(380px,.9fr)}.app .sub-decide{position:sticky;top:84px;max-height:calc(100vh - 104px);overflow:auto;padding:var(--s5);background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}}
.app .lb{background:linear-gradient(165deg,#0c786e 0%,#0a4f49 55%,#062f2c 100%);color:#fff;border-radius:22px;padding:clamp(18px,3.5vw,34px) clamp(14px,3.5vw,34px);max-width:760px;margin:1.2rem auto 2rem;box-shadow:var(--shadow-md)}
.app .lb-title{text-align:center;font-size: var(--fs-md);letter-spacing:.24em;text-transform:uppercase;font-weight:800;margin:0 0 1.4rem;color:#fff}
.app .podium{list-style:none;padding:0;margin:0 auto 1.6rem;max-width:560px;display:flex;justify-content:center;align-items:flex-end;gap:clamp(8px,3vw,28px)}
.app .place{flex:0 1 31%;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px}
.app .place-1{order:2;padding-bottom:12px}.app .place-2{order:1}.app .place-3{order:3}
.app .place .posn{font-weight:800;font-size: var(--fs-lg);color:#fff}
.app .crown{width:36px;height:auto;color:#f5b73b;margin-bottom:-2px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
.app .place .ring{display:block;border-radius:50%;padding:3px;background:rgba(255,255,255,.8)}
.app .place-1 .ring{background:#f5b73b;padding:4px}
.app .place img{display:block;border-radius:50%;background:#fff;width:clamp(54px,14vw,84px);height:clamp(54px,14vw,84px)}
.app .place-1 img{width:clamp(74px,19vw,116px);height:clamp(74px,19vw,116px)}
.app .place .login{color:#fff;font-weight:700;font-size: var(--fs-sm);text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app .place .login:hover{text-decoration:underline}
.app .place .pts{color:#ffc24d;font-weight:800;font-size: var(--fs-sm)}
.app .lb-list{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.app .lb-list > li{display:grid;grid-template-columns:1.9rem 44px minmax(0,1fr) auto;align-items:center;gap:12px;background:rgba(255,255,255,.1);border-radius:14px;padding:6px 6px 6px 12px}
.app .lb-list .rank{font-weight:800;color:#ffc24d;text-align:center;font-variant-numeric:tabular-nums}
.app .lb-list img{border-radius:50%;border:2px solid rgba(255,255,255,.85);background:#fff}
.app .lb-list .who{min-width:0}
.app .lb-list .login{color:#fff;font-weight:700;text-decoration:none;overflow-wrap:anywhere}
.app .lb-list .login:hover{text-decoration:underline}
.app .lb-list .score{background:rgba(0,0,0,.24);border-radius:10px;padding:12px 18px;min-width:4.6rem;text-align:center;color:#ffc24d;font-weight:800;font-size: var(--fs-lg);font-variant-numeric:tabular-nums}
.app .lb .badge-row{margin-top:.2rem}
.app .lb .badge-chip{background:rgba(255,255,255,.16);color:#fff}
.app .lb a:focus-visible{outline-color:#fff}
.app .lb-empty{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.3);color:#fff}.app .lb-empty a{color:#ffc24d}
@media (max-width:420px){.app .lb-list > li{grid-template-columns:1.5rem 38px minmax(0,1fr) auto;gap:8px}.app .lb-list .score{padding:10px 12px;min-width:3.4rem}}
.app .badge-row,.app .badge-list{list-style:none;padding:0;margin:.3rem 0 0;display:flex;flex-wrap:wrap;gap:6px}
.app .badge-chip{font-size: var(--fs-xs);font-weight:650;padding:2px 10px;border-radius:99px;background:var(--accent-bg);color:var(--accent)}
.app .badge-list{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))}
.app .badge-list li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column}
.app .danger-zone{border:1px solid var(--bad);border-radius:8px;padding:6px 16px 14px;margin-top:2rem}
`;
// the app's rules are the last cascade layer, after the site's three (the order is declared here too, because this file loads first)
export const CSS = `@layer tokens, base, site, app;
@layer app {
${APP_CSS}
}
`;

// the stylesheet is cached for an hour, so its address changes whenever its content does
const hash = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };
export const CSS_V = hash(CSS);

// The frame is the site's own page (app-shell.html, built by site/build.mjs): same header, account menu and footer.
// If it cannot be read, a plain page is used so the app still works.
let SHELL = "";
export const setShell = (text) => { SHELL = typeof text === "string" && text.includes("<!--@@BODY@@-->") && text.includes("@@TITLE@@") ? text : ""; };
const HEAD_EXTRA = `<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/assets/app.css?v=${CSS_V}">`;
// every table, with or without attributes, gets a frame that scrolls sideways on a narrow screen
const wrapTables = (b) => b.split("<table").map((part, i) => (i > 0 && (part[0] === ">" || part[0] === " ") ? `<div class="table-wrap"><table${part}` : i > 0 ? `<table${part}` : part)).join("").split("</table>").join("</table></div>");
const newTab = (html) => html.replace(/<a\b[^>]*>/g, (tag) => (/href="https?:\/\//.test(tag) && /rel="noopener noreferrer"/.test(tag) && !/target=/.test(tag) ? tag.replace("<a", '<a target="_blank"') : tag));
export const page = (title, rawBody) => { const body = newTab(wrapTables(rawBody)); return SHELL
  ? SHELL.split("@@TITLE@@").join(esc(title)).replace("<!--@@HEAD@@-->", () => HEAD_EXTRA).replace("<!--@@BODY@@-->", () => `<div class="wrap app">${body}</div>`)
  : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${HEAD_EXTRA}<link rel="stylesheet" href="/style.css"></head>
<body><main class="wrap app"><p><a href="/">Praxikit</a></p>${body}</main></body></html>`; };

// the site header already shows who is signed in, so pages no longer draw their own bar
export const nav = () => "";
/** The two community pages share one nav entry (Community); this strip moves between them. */
export const communityTabs = (current) => `<nav class="adm-tabs" aria-label="Community"><a href="/contributors"${current === "contributors" ? ' aria-current="page"' : ""}>Contributors</a><a href="/requests"${current === "requests" ? ' aria-current="page"' : ""}>Requests</a></nav>`;

export const signInPage = (note = "", opts = {}) => {
  const q = (k, v) => (v ? `&${k}=${encodeURIComponent(v)}` : "");
  const heading = opts.what === "collection" ? "Sign in to keep a collection" : opts.submit ? "Sign in to submit a kit" : "Sign in";
  const intro = opts.what === "collection" ? "Sign in with GitHub to save kits to a private collection and submit your own." : opts.submit ? "Sign in with GitHub, then paste the link to a public repository." : "Sign in with GitHub. Maintainers of the catalogue are recognised automatically.";
  return page("Sign in — Praxikit", `<h1>${heading}</h1>
<p>${intro} We ask GitHub only who you are (your username); nothing else is read or kept. <a href="/privacy/">Privacy</a>.</p>
${note ? `<p class="note">${esc(note)}</p>` : ""}<p><a class="btn" href="/auth/login?mode=user${q("next", opts.next)}${q("save", opts.save)}${q("return", opts.return)}">Sign in with GitHub</a></p>${opts.next ? `<p class="muted">After signing in you will land back here with <code>${esc(opts.next)}</code> filled in.</p>` : ""}
<p class="muted">A maintainer who is not recognised can <a href="/auth/login${opts.return ? "?return=" + encodeURIComponent(opts.return) : ""}">sign in with organisation access</a>.</p>`);
};

export const messagePage = (title, text, withHome = true, link = null) => page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>${link ? `<p><a class="btn" href="${esc(link.href)}">${esc(link.text)}</a></p>` : ""}${withHome ? '<p><a class="btn ghost" href="/admin">Back</a></p>' : ""}`);

const REPO_LINK = (repo, path) => `https://github.com/${repo}${path}`;
const SRC = { community: "Community (by its author)", recommended: "Recommended (by someone else)" };
const checks = (json) => { try { const a = JSON.parse(json); return Array.isArray(a) ? a.map((c) => ({ title: String(c?.title ?? ""), status: String(c?.status ?? ""), note: String(c?.note ?? "") })) : []; } catch { return []; } };
const status = (s) => (s === "pass" ? "Pass" : s === "flag" ? "Look closer" : s === "fail" ? "Fail" : esc(s));

export function submitPage({ session, flash, error, values = {}, isPublic = false, relation = null }) {
  // what GitHub says about the link, shown before anything is sent: owner or not decides how it is listed
  const who = relation ? (relation.author
    ? `<p class="ok"><strong>You own ${esc(relation.repo)}</strong> (or you are a public member of its organisation), so it will be listed as a community kit, by you.</p>`
    : `<p class="note"><strong>You do not own ${esc(relation.repo)}</strong>, so it will be listed as your recommendation. Say in the note below why it is worth listing.</p>`) : "";
  return page("Submit a kit — Praxikit", `${nav(session)}
<h1>Submit a kit</h1>
<p>Paste the link to a public GitHub repository. We read its name, owner, licence and README from GitHub; you do not need to describe it. A person reviews every submission before anything is listed, and nothing is listed for payment.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${error ? `<p class="note">${esc(error)}</p>` : ""}${who}
<form method="post" action="/submit">
<label for="url">Repository link</label><input id="url" name="url" type="url" required maxlength="200" placeholder="https://github.com/owner/repo" value="${esc(values.url ?? "")}">
<label for="why">Note <span class="hint">(optional, up to 200 characters; shown if you are recommending someone else's kit)</span></label><textarea id="why" name="why" maxlength="200">${esc(values.why ?? "")}</textarea>
<p class="muted">${isPublic ? "Your GitHub username is shown on the listing and on the Contributors board if this is listed." : "Your name is hidden, so you will not be named on the listing or the board."} You can change this in <a href="/settings">Settings</a>.</p>
<p><button type="submit">Submit for review</button> <a class="btn ghost" href="/profile">My profile</a></p>
</form>
<p class="muted">If you are the repository's owner (or a public member of its organisation), it is listed as a community kit by its author. Otherwise it is a recommendation. GitHub decides which, not the form.</p>`);
}

const REMOVE_OPTIONS = [["malicious", "Malicious"], ["secret", "Exposed secret"], ["licence", "Licence problem"], ["misleading", "Misleading"], ["unmaintained", "Unmaintained"], ["owner-request", "Owner asked"], ["other", "Other"]];

/** The live listings, each with an edit form and a remove form. Everything shown is escaped. */
export function listingsPage({ session, listings, error, flash, canPublish }) {
  const item = (l) => `<details class="listing"><summary><strong>${esc(l.name)}</strong> <span class="muted">${esc(l.kind)} · ${l.pick ? "my pick" : esc(l.source)} · ${esc(l.checks)}</span></summary>
<p class="muted"><a href="${esc(l.url)}" rel="noopener noreferrer">${esc(l.url)}</a> · reviewed at <code>${esc(l.commit.slice(0, 7))}</code>. What was reviewed does not change here; to change that, run the checks again from a new submission.</p>
<form method="post" action="/admin/listings/edit"><input type="hidden" name="url" value="${esc(l.url)}">
<label>Name <input type="text" name="name" maxlength="80" required value="${esc(l.name)}"></label>
<label>Card text <textarea name="why" maxlength="400" required>${esc(l.why)}</textarea></label>
<label>Tags <span class="hint">(comma-separated, up to 12)</span> <input type="text" name="tags" maxlength="400" value="${esc(l.tags.join(", "))}"></label>
<label>How I use it <span class="hint">(a note makes it one of my picks; empty means it is just listed)</span> <input type="text" name="note" maxlength="200" value="${esc(l.note)}"></label>
<p><button type="submit"${canPublish ? "" : " disabled"}>Save changes</button></p></form>
<form method="post" action="/admin/listings/remove" class="danger"><input type="hidden" name="url" value="${esc(l.url)}">
<label>Remove for <select name="reason">${REMOVE_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
<label>Public note <span class="hint">(optional, shown in the removal log)</span> <input type="text" name="note" maxlength="160"></label>
<label class="check"><input type="checkbox" name="confirm" value="yes"> Yes, remove it and log it publicly</label>
<p><button type="submit" class="ghost"${canPublish ? "" : " disabled"}>Remove listing</button></p></form></details>`;
  return page("Listings — Praxikit", `${nav(session)}
<h1>Live listings</h1>
<p class="muted"><a href="/admin">Back to the admin</a>. These are the kits on the public site now. Edits and removals run as jobs on GitHub, are recorded in the repository's history, and need a sign-in from the last 30 minutes.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${error ? `<p class="note">${esc(error)}</p>` : ""}
${canPublish ? "" : '<p class="note">Publishing is not connected, so changes are switched off.</p>'}
${listings.length ? listings.map(item).join("") : error ? "" : '<p class="muted">Nothing is listed yet.</p>'}`);
}

const KIND_OPTIONS = [["plugin", "Plugin"], ["skill", "Skill"], ["mcp", "MCP config"], ["template", "Template"], ["adapter", "Adapter"], ["agent", "Agent"], ["hook", "Hook"]];
/** Fixed messages only: a query string picks one by key and is never echoed. */
export const FLASH = {
  approved: "Approved. The publish job has started; its result shows here in a minute or two.",
  rejected: "Rejected. The submitter will see your reason.",
  retried: "Trying again. The publish job has started.",
  already: "That submission was already decided.",
  stale: "For safety, sign in again before approving or rejecting (your sign-in is older than 30 minutes).",
  bad: "Check the fields: a name up to 80 characters, a type from the list, card text up to 400 characters, and, if you tick that you use it, a note of up to 200 characters. A rejection needs a reason up to 300 characters.",
  nopublish: "Publishing is not connected yet: the app has no token to start the publish job. Nothing was changed.",
  failed: "Approved, but GitHub would not start the publish job. You can try again from this page.",
  direct: "Saved, and since you are a maintainer it is being published now (after the usual scan).",
  needscan: "Run the full checks first. Approving is only possible after they have run and found nothing that blocks it.",
  moved: "The repository has new commits since you were shown it. This page now shows the newest commit: read that one, then approve again.",
  needread: "Tick the box to confirm you have opened and read the full report: this one has things to look at.",
  scanning: "The checks are already running. Reload in a minute.",
  scanstarted: "The full checks have started on GitHub. Reload in a minute or two.",
  scanfail: "GitHub would not start the check job. Try again.",
  reopened: "Back in review. Run the full checks and read them before approving.",
  edited: "Saved. The edit is being applied and the site redeploys; this page shows the change in a minute or two.",
  removed: "Removal started. It is logged publicly in the removal log and the site redeploys; this page updates in a minute or two.",
  badedit: "Check the fields: a name up to 80 characters, card text up to 400, and a note of up to 200 characters if it is a pick.",
  badremove: "Pick a reason from the list, tick the confirmation, and keep the note under 160 characters.",
  gone: "That repository is not in the live listings (it may have just been removed).",
  unread: "The live listings could not be read from GitHub just now. Nothing was changed.",
  joberr: "GitHub would not start the job. Nothing was changed; try again.",
  held: "Saved for review. It could not be published directly (no recognisable type, a failed quick check, or your sign-in is older than 30 minutes); open it to decide.",
};
const PUBLISH = {
  dispatching: "Starting the publish job…", dispatched: "Publishing: the scan and the commit are running on GitHub.",
  listed: "Listed. It is on the catalogue.", blocked: "Blocked. The publish job did not complete.",
};
const mineStatus = (r) => (r.status === "pending" ? "Waiting for review" : r.status === "rejected" ? `Not listed${r.decision_note ? `: ${r.decision_note}` : ""}` : r.status === "approved" ? (r.publish_state === "listed" ? "Listed" : r.publish_state === "blocked" ? "Approved, but the automatic scan or publish step stopped it. A maintainer will look." : "Approved, being published") : r.status);

export const mineTable = (rows) => rows.length
    ? `<table><thead><tr><th>Repository</th><th>As</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="${esc(r.repo_url)}" rel="noopener noreferrer">${esc(r.name)}</a></td><td>${esc(r.source)}</td><td>${esc(mineStatus(r))}</td><td>${esc(String(r.created_at).slice(0, 10))}</td></tr>`).join("")}</tbody></table>`
    : '<p class="muted">You have not submitted anything yet.</p>';
export function minePage({ session, rows, flash }) {
  const body = mineTable(rows);
  return page("My submissions — Praxikit", `${nav(session)}<h1>My submissions</h1>${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${body}<p><a class="btn" href="/submit">Submit another</a></p>`);
}

const CHECK_CHIP = { "no-flags-found": ["Nothing found", "ok"], "checks-flagged": ["Read the report", "flag"], "checks-failed": ["Failed", "bad"], "needs-manual-review": ["Too large: read by hand", "flag"] };
/** The full-check result of a submission in a few plain words, as [text, tone]. */
export const scanChip = (s) => (s.scan_state === "done" ? (CHECK_CHIP[s.scan_label] ?? [String(s.scan_label), "muted"]) : s.scan_state === "running" ? ["Running", "muted"] : s.scan_state === "failed" ? ["Did not finish", "bad"] : ["Not run yet", "muted"]);
const chip = ([text, tone]) => `<span class="chip ${tone}">${esc(text)}</span>`;
/** "today", "yesterday", "3 days ago" for an ISO date, with the date itself on hover. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return "";
  const d = Math.floor((now - t) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : String(iso).slice(0, 10);
}

export function adminPage({ session, env, queueError, noteCount = 0, requestCount = 0, subs, recent, flash }) {
  const via = session.via === "owner" ? `an owner of ${esc(env.ORG)}` : `a member of ${esc(env.ORG)}/${esc(env.TEAM)}`;
  const subRows = (subs ?? []).map((s) => `<tr><td><a class="row-link" href="/admin/submissions/${Number(s.id)}">${esc(s.name)}</a><br><span class="muted">${esc(s.owner)}</span></td><td>${esc(s.kind_guess || "?")}</td><td>${esc(s.source)}</td><td>${esc(s.license || "none")}</td><td>${status(s.precheck_status)}</td><td>${chip(scanChip(s))}</td><td>${esc(s.submitted_by)}</td><td title="${esc(String(s.created_at).slice(0, 10))}">${esc(ago(s.created_at))}</td></tr>`).join("");
  const recentRows = (recent ?? []).map((s) => `<tr><td><a class="row-link" href="/admin/submissions/${Number(s.id)}">${esc(s.name)}</a></td><td>${chip([s.status, s.status === "approved" ? "ok" : "muted"])}</td><td>${esc(s.status === "approved" ? (PUBLISH[s.publish_state] ?? s.publish_state) : s.status === "rejected" ? s.decision_note : "")}</td><td>${esc(s.decided_by)}</td><td title="${esc(String(s.decided_at).slice(0, 10))}">${esc(ago(s.decided_at))}</td></tr>`).join("");
  return page("Admin — Praxikit", `${nav(session)}
<h1>Catalogue admin</h1>
<nav class="adm-tabs" aria-label="Maintainer areas"><a href="/admin" aria-current="page">Submissions${subs ? ` <span class="n">${subs.length}</span>` : ""}</a><a href="/admin/notes">Notes${noteCount ? ` <span class="n">${Number(noteCount)}</span>` : ""}</a><a href="/admin/requests">Requests${requestCount ? ` <span class="n">${Number(requestCount)}</span>` : ""}</a><a href="/admin/listings">Live listings</a></nav>
<p class="muted">You can maintain the catalogue because you are ${via}. Keys: <kbd>j</kbd> and <kbd>k</kbd> move down and up the list, <kbd>Enter</kbd> opens.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
${subs ? `<h2>New submissions (${subs.length})</h2>${subRows ? `<table class="queue" data-rows><thead><tr><th>Repository</th><th>Type</th><th>As</th><th>Licence</th><th>Quick check</th><th>Full checks</th><th>By</th><th>Opened</th></tr></thead><tbody>${subRows}</tbody></table><p class="muted">Open one to approve or reject it.</p>` : '<p class="muted">Nothing is waiting.</p>'}` : ""}
${recentRows ? `<h2>Recently decided</h2><table class="queue" data-rows><thead><tr><th>Repository</th><th>Decision</th><th>Result</th><th>By</th><th>Decided</th></tr></thead><tbody>${recentRows}</tbody></table>` : ""}

${subs ? "" : `<p class="note">${esc(queueError || "The submissions database is not connected, so there is nothing to review here.")}</p>`}
<h2>Shortcuts</h2>
<ul class="toolgrid">
<li><a href="/submit">Open the submit form</a> (as a maintainer, what you submit is published directly after the scan)</li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/add-listing.yml"))}" rel="noopener noreferrer">Add a listing</a> on GitHub (also the only way to list something whose checks failed)</li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/remove-listing.yml"))}" rel="noopener noreferrer">Remove a listing</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/listing-drift.yml"))}" rel="noopener noreferrer">Re-check listings for changes</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/issues?q=is%3Aissue+is%3Aopen+label%3Areport"))}" rel="noopener noreferrer">Reports</a></li>
<li><a href="/removals/">Removal log</a> (public: every removal, with the date and the reason)</li>
</ul>`);
}

const SCAN_TEXT = {
  "no-flags-found": "The full checks found nothing to look at.",
  "checks-flagged": "The full checks found things to look at. Open the full report and read it before approving.",
  "checks-failed": "The full checks failed. This cannot be approved. Reject it with a reason, or ask the submitter to fix it and submit again.",
  "needs-manual-review": "The checks could not read this repository automatically (for example, it is over the 100 MB limit, so it is too large to scan). You can read it yourself and approve it by hand below. It will be listed as reviewed by hand, not scanned.",
};
const SCAN_OK = ["no-flags-found", "checks-flagged"];

export function detailPage({ session, s, flash, canPublish }) {
  const cs = checks(s.precheck);
  const commitUrl = `${s.repo_url}/commit/${s.commit_sha}`;
  const defaultText = s.source === "recommended" && s.why ? s.why : s.readme_excerpt;
  const kindSelect = (sel) => `<select id="kind" name="kind" required>${KIND_OPTIONS.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  const scanned = s.scan_state === "done" && /^[0-9a-f]{12}$/.test(s.scan_commit) && SCAN_OK.includes(s.scan_label);
  const flagged = s.scan_label === "checks-flagged";
  const report = s.scan_run_url ? `<a href="${esc(s.scan_run_url)}" rel="noopener noreferrer">Open the full report</a> (on GitHub: open the <em>scan</em> job, then its Summary)` : "";
  const scanPanel = s.status !== "pending" ? "" : `<h2>Full checks</h2>
${s.scan_state === "running" ? '<p class="note">Running on GitHub. Reload this page in a minute.</p>'
    : s.scan_state === "done" ? `<p class="${s.scan_label === "no-flags-found" ? "ok" : "note"}">${esc(SCAN_TEXT[s.scan_label] ?? s.scan_label)} <span class="muted">Checked at commit <code>${esc(s.scan_commit || "unknown")}</code>.</span></p><p>${report}</p>`
    : s.scan_state === "failed" ? `<p class="note">The check job did not complete.${s.scan_run_url ? ` <a href="${esc(s.scan_run_url)}" rel="noopener noreferrer">See the run</a>.` : ""} Run it again.</p>`
    : '<p class="muted">Not run yet. Run the full read-only checks, read the result, then decide. Approving is only possible after they have run.</p>'}
${s.scan_state === "running" ? "" : `<form method="post" action="/admin/submissions/${Number(s.id)}/scan"><p><button type="submit"${canPublish ? "" : " disabled"}>${s.scan_state ? "Run the full checks again" : "Run the full checks"}</button></p></form>`}`;
  const byHand = s.scan_state === "done" && s.scan_label === "needs-manual-review" && /^[0-9a-f]{40}$/.test(String(s.commit_sha ?? ""));
  const approveOk = canPublish && (scanned || byHand);
  const decide = s.status === "pending"
    ? `${scanPanel}
<h2>Decide</h2>
${canPublish ? "" : '<p class="note">Publishing is not connected yet (the app has no token to start GitHub jobs), so checks and approving are switched off. You can still reject.</p>'}
${scanned || byHand ? "" : '<p class="muted">Approving unlocks after the full checks have run and found nothing that blocks it.</p>'}
<form method="post" action="/admin/submissions/${Number(s.id)}/approve">
<label for="name">Name on the card</label><input id="name" name="name" type="text" required maxlength="80" value="${esc(s.name)}">
<label for="kind">Type</label>${kindSelect(s.kind_guess || "plugin")}${s.kind_guess ? "" : '<p class="hint">The file names did not show what this is; choose carefully.</p>'}
<label for="text">Card text <span class="hint">(up to 400 characters; the README excerpt, or the recommender's note, to start with)</span></label><textarea id="text" name="text" required maxlength="400">${esc(defaultText)}</textarea>
<label for="tags">Tags <span class="hint">(comma-separated, up to 12; they help people find it. Starting from the repository's own GitHub topics)</span></label><input id="tags" name="tags" type="text" maxlength="400" value="${esc(s.topics)}" placeholder="for example planning, marketing">
<label class="check"><input type="checkbox" name="pick" value="yes"> I use this kit (list it as one of my picks)</label>
<label for="pick_note">How I use it <span class="hint">(one line, up to 200 characters; needed if you ticked the box above, and shown on the card)</span></label><input id="pick_note" name="pick_note" type="text" maxlength="200">
${flagged ? '<label class="check"><input type="checkbox" name="read" value="yes" required> I have opened and read the full report above</label>' : ""}
${byHand ? `<input type="hidden" name="by_hand" value="yes"><input type="hidden" name="commit" value="${esc(String(s.commit_sha))}"><label class="check"><input type="checkbox" name="hand_read" value="yes" required> I have read <a href="${esc(commitUrl)}" rel="noopener noreferrer">this repository at commit <code>${esc(String(s.commit_sha).slice(0, 12))}</code></a> myself. It was not scanned, and the listing will say so.</label>` : ""}
<p><button type="submit"${approveOk ? "" : " disabled"}>Approve and publish</button> <span class="muted">It is listed at the commit that was checked. If the repository changes first, publishing stops and the checks must be run again.</span></p>
</form>
<form method="post" action="/admin/submissions/${Number(s.id)}/reject">
<label for="note">Reject, with a reason the submitter will see <span class="hint">(up to 300 characters)</span></label><textarea id="note" name="note" required maxlength="300"></textarea>
<p><button class="ghost" type="submit">Reject</button></p>
</form>`
    : `<h2>Decision</h2>
<dl><dt>Status</dt><dd>${esc(s.status)}${s.decided_by ? ` by @${esc(s.decided_by)} on ${esc(String(s.decided_at).slice(0, 10))}` : ""}</dd>
${s.status === "approved" ? `<dt>Listed as</dt><dd>${esc(s.final_name)} (${esc(s.final_kind)}): ${esc(s.final_text)}</dd>${s.final_pick ? `<dt>My pick</dt><dd>${esc(s.final_note)}</dd>` : ""}${s.final_tags ? `<dt>Tags</dt><dd>${esc(s.final_tags.split(",").join(", "))}</dd>` : ""}<dt>Publishing</dt><dd>${esc(PUBLISH[s.publish_state] ?? s.publish_state)}${s.publish_note ? `<br><span class="muted">${esc(s.publish_note)}</span>` : ""}</dd>${s.scan_commit ? `<dt>Checks read at</dt><dd><code>${esc(s.scan_commit)}</code> (${esc(s.scan_label)})</dd>` : ""}` : ""}
${s.status === "rejected" ? `<dt>Reason</dt><dd>${esc(s.decision_note)}</dd>` : ""}</dl>
${s.status === "approved" && s.publish_state === "blocked" ? `<form method="post" action="/admin/submissions/${Number(s.id)}/retry"><p><button type="submit"${canPublish ? "" : " disabled"}>Try publishing again</button></p></form>
<form method="post" action="/admin/submissions/${Number(s.id)}/reopen"><p><button class="ghost" type="submit">Back to review</button> <span class="muted">If the repository changed after you read it, publishing stops. Go back to review, read the newest commit, and approve again.</span></p></form>` : ""}`;
  return page(`${s.name} — Praxikit admin`, `${nav(session)}
<p class="muted"><a href="/admin">All submissions</a></p>
<h1>${esc(s.name)} <span class="badge${s.precheck_status === "fail" ? " bad" : s.precheck_status === "flag" ? " warn" : ""}">${status(s.precheck_status)}</span></h1>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
<div class="sub-layout"><div class="sub-evidence">
<dl>
<dt>Repository</dt><dd><a href="${esc(s.repo_url)}" rel="noopener noreferrer">${esc(s.repo_url)}</a></dd>
<dt>Created by</dt><dd>${esc(s.owner)} (${esc(s.owner_type)})</dd>
<dt>Submitted by</dt><dd>@${esc(s.submitted_by)} on ${esc(String(s.created_at).slice(0, 10))}</dd>
<dt>Would be listed as</dt><dd>${esc(SRC[s.source] ?? s.source)}</dd>
<dt>Type (a guess)</dt><dd>${esc(s.kind_guess || "not recognised")}</dd>
<dt>Licence</dt><dd>${esc(s.license || "none detected")}</dd>
<dt>Commit looked at</dt><dd><a href="${esc(commitUrl)}" rel="noopener noreferrer"><code>${esc(String(s.commit_sha).slice(0, 7))}</code></a></dd>
</dl>
<h2>README (first part, plain text)</h2>
${s.readme_excerpt ? `<blockquote>${esc(s.readme_excerpt)}</blockquote>` : '<p class="muted">No README text could be read.</p>'}
${s.readme_url ? `<p><a href="${esc(s.readme_url)}" rel="noopener noreferrer">View the README on GitHub</a></p>` : ""}
${s.why ? `<h2>Note from the submitter</h2><blockquote>${esc(s.why)}</blockquote>` : ""}
<h2>Quick checks</h2>
<table><thead><tr><th>Check</th><th>Result</th><th>Note</th></tr></thead><tbody>${cs.map((c) => `<tr><td>${esc(c.title)}</td><td>${status(c.status)}</td><td>${esc(c.note)}</td></tr>`).join("")}</tbody></table>
<p class="muted">These are quick checks from GitHub's own data. The full read-only scan of the code is a separate step below.</p>
</div><aside class="sub-decide" aria-label="Decision">${decide}</aside></div>`);
}
