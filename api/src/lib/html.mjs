/** Pages are plain HTML with no scripts at all; the CSP forbids them anyway. Everything dynamic goes through esc(). */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const CSS = `
.app{padding-block:36px 72px}
.app h1{font-size:clamp(1.6rem,1rem + 1.6vw,2.2rem);margin:0 0 .8rem;max-width:none;letter-spacing:-.01em}
.app h2{font-size:1.15rem;margin:2rem 0 .6rem}
.app p{max-width:70ch}
.app .muted{color:var(--muted);font-size:.93rem}
.app .badge{font-size:.78rem;font-weight:600;padding:2px 8px;border-radius:4px;background:var(--accent);color:var(--accent-fg)}
.app .badge.warn{background:var(--warn-bg);color:var(--warn)}.app .badge.bad{background:var(--bad);color:#fff}
.app .note{background:var(--warn-bg);border-left:3px solid var(--warn);padding:9px 13px;margin:1rem 0}
.app .ok{background:var(--card);border-left:3px solid var(--accent);padding:9px 13px;margin:1rem 0}
.app .btn,.app button{font:inherit;font-size:.95rem;padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);text-decoration:none;cursor:pointer;display:inline-block}
.app button.ghost,.app .btn.ghost{background:transparent;color:var(--accent)}
.app button.ghost:hover,.app .btn.ghost:hover{background:var(--accent-bg);filter:none}
.app button[disabled]{opacity:.5;cursor:not-allowed}
.app .table-wrap{overflow-x:auto}
.app table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}
.app th,.app td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);font-size:.93rem;vertical-align:top}
.app th{color:var(--muted);font-weight:600}
.app ul.links{padding-left:1.2rem}.app ul.links li{margin:.35rem 0}
.app label{display:block;font-weight:600;margin:1rem 0 .3rem}
.app label.check{font-weight:400;display:flex;gap:8px;align-items:center}
.app input[type=text],.app input[type=url],.app textarea{width:100%;max-width:640px;font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
.app textarea{min-height:5rem;resize:vertical}
.app select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
.app .hint{font-weight:400;color:var(--muted);font-size:.88rem}
.app blockquote{margin:.5rem 0;padding:.4rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
.app dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:6px 18px}.app dt{color:var(--muted)}.app dd{margin:0;overflow-wrap:anywhere}
.app ul.plain{list-style:none;padding:0;margin:0}
.app .listing{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:10px 14px;margin:10px 0}
.app .listing summary{cursor:pointer}.app .listing .danger{margin-top:18px;padding-top:6px;border-top:1px dashed var(--line)}
.app .profile-head{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.app .profile-head img{width:72px;height:72px;border-radius:50%;border:1px solid var(--line)}
.app .profile-head h1{margin:0}
.app .cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin:12px 0}
.app .cards a{display:block;border:1px solid var(--line);border-radius:8px;background:var(--card);padding:12px 14px;text-decoration:none;color:var(--fg)}
.app .cards a:hover{border-color:var(--accent)}
.app .cards strong{display:block}
.app .danger-zone{border:1px solid var(--bad);border-radius:8px;padding:6px 16px 14px;margin-top:2rem}
`;

// the stylesheet is cached for an hour, so its address changes whenever its content does
const hash = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };
export const CSS_V = hash(CSS);

// The frame is the site's own page (app-shell.html, built by site/build.mjs): same header, account menu and footer.
// If it cannot be read, a plain page is used so the app still works.
let SHELL = "";
export const setShell = (text) => { SHELL = typeof text === "string" && text.includes("<!--@@BODY@@-->") && text.includes("@@TITLE@@") ? text : ""; };
const HEAD_EXTRA = `<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/assets/app.css?v=${CSS_V}">`;
export const page = (title, body) => SHELL
  ? SHELL.split("@@TITLE@@").join(esc(title)).replace("<!--@@HEAD@@-->", () => HEAD_EXTRA).replace("<!--@@BODY@@-->", () => `<div class="wrap app">${body}</div>`)
  : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${HEAD_EXTRA}<link rel="stylesheet" href="/style.css"></head>
<body><main class="wrap app"><p><a href="/">Praxikit</a></p>${body}</main></body></html>`;

// the site header already shows who is signed in, so pages no longer draw their own bar
export const nav = () => "";

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

export function submitPage({ session, flash, error, values = {} }) {
  return page("Submit a kit — Praxikit", `${nav(session)}
<h1>Submit a kit</h1>
<p>Paste the link to a public GitHub repository. We read its name, owner, licence and README from GitHub; you do not need to describe it. A person reviews every submission before anything is listed, and nothing is listed for payment.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${error ? `<p class="note">${esc(error)}</p>` : ""}
<form method="post" action="/submit">
<label for="url">Repository link</label><input id="url" name="url" type="url" required maxlength="200" placeholder="https://github.com/owner/repo" value="${esc(values.url ?? "")}">
<label for="why">Note <span class="hint">(optional, up to 200 characters; shown if you are recommending someone else's kit)</span></label><textarea id="why" name="why" maxlength="200">${esc(values.why ?? "")}</textarea>
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
  needread: "Tick the box to confirm you have opened and read the full report: this one has things to look at.",
  scanning: "The checks are already running. Reload in a minute.",
  scanstarted: "The full checks have started on GitHub. Reload in a minute or two.",
  scanfail: "GitHub would not start the check job. Try again.",
  reopened: "Back in review. Run the full checks and read them before approving.",
  edited: "Saved. The edit is being applied and the site redeploys; this page shows the change in a minute or two.",
  removed: "Removal started. It is logged publicly in docs/removals.md and the site redeploys; this page updates in a minute or two.",
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

export function adminPage({ session, env, queue, queueError, subs, recent, flash }) {
  const via = session.via === "owner" ? `an owner of ${esc(env.ORG)}` : `a member of ${esc(env.ORG)}/${esc(env.TEAM)}`;
  const issueRows = queue.map((q) => `<tr><td><a href="${esc(REPO_LINK(env.REPO, `/issues/${q.number}`))}" rel="noopener noreferrer">#${q.number}</a></td><td>${esc(q.title)}</td><td>${esc(q.by)}</td><td>${esc(q.label)}</td><td>${esc(q.checks || "waiting")}</td><td>${esc(q.created)}</td></tr>`).join("");
  const subRows = (subs ?? []).map((s) => `<tr><td><a href="/admin/submissions/${Number(s.id)}">${esc(s.name)}</a><br><span class="muted">${esc(s.owner)}</span></td><td>${esc(s.kind_guess || "?")}</td><td>${esc(s.source)}</td><td>${esc(s.license || "none")}</td><td>${status(s.precheck_status)}</td><td>${esc(s.scan_state === "done" ? (s.scan_label === "no-flags-found" ? "nothing found" : s.scan_label === "checks-flagged" ? "read the report" : s.scan_label) : s.scan_state === "running" ? "running" : s.scan_state === "failed" ? "did not finish" : "not run")}</td><td>${esc(s.submitted_by)}</td><td>${esc(String(s.created_at).slice(0, 10))}</td></tr>`).join("");
  const recentRows = (recent ?? []).map((s) => `<tr><td><a href="/admin/submissions/${Number(s.id)}">${esc(s.name)}</a></td><td>${esc(s.status)}</td><td>${esc(s.status === "approved" ? (PUBLISH[s.publish_state] ?? s.publish_state) : s.status === "rejected" ? s.decision_note : "")}</td><td>${esc(s.decided_by)}</td><td>${esc(String(s.decided_at).slice(0, 10))}</td></tr>`).join("");
  return page("Admin — Praxikit", `${nav(session)}
<h1>Catalogue admin</h1>
<p><a class="btn ghost" href="/admin/listings">Manage live listings</a></p>
<p class="muted">You can maintain the catalogue because you are ${via}.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
${subs ? `<h2>New submissions (${subs.length})</h2>${subRows ? `<table><thead><tr><th>Repository</th><th>Type</th><th>As</th><th>Licence</th><th>Quick check</th><th>Full checks</th><th>By</th><th>Opened</th></tr></thead><tbody>${subRows}</tbody></table><p class="muted">Open one to approve or reject it.</p>` : '<p class="muted">Nothing is waiting.</p>'}` : ""}
${recentRows ? `<h2>Recently decided</h2><table><thead><tr><th>Repository</th><th>Decision</th><th>Result</th><th>By</th><th>Date</th></tr></thead><tbody>${recentRows}</tbody></table>` : ""}
<h2>Waiting for review${subs ? " (old issue forms)" : ""}</h2>
${queueError ? `<p class="note">${esc(queueError)}</p>` : issueRows ? `<table><thead><tr><th>Issue</th><th>Title</th><th>By</th><th>Kind</th><th>Checks</th><th>Opened</th></tr></thead><tbody>${issueRows}</tbody></table>` : '<p class="muted">Nothing is waiting.</p>'}
<h2>Shortcuts</h2>
<ul class="links">
<li><a href="/submit">Open the submit form</a> (as a maintainer, what you submit is published directly after the scan)</li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/add-listing.yml"))}" rel="noopener noreferrer">Add a listing</a> on GitHub (also the only way to list something whose checks failed)</li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/remove-listing.yml"))}" rel="noopener noreferrer">Remove a listing</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/actions/workflows/listing-drift.yml"))}" rel="noopener noreferrer">Re-check listings for changes</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/issues?q=is%3Aissue+is%3Aopen+label%3Areport"))}" rel="noopener noreferrer">Reports</a></li>
<li><a href="${esc(REPO_LINK(env.REPO, "/blob/main/docs/removals.md"))}" rel="noopener noreferrer">Removal log</a></li>
</ul>`);
}

const SCAN_TEXT = {
  "no-flags-found": "The full checks found nothing to look at.",
  "checks-flagged": "The full checks found things to look at. Open the full report and read it before approving.",
  "checks-failed": "The full checks failed. This cannot be approved. Reject it with a reason, or ask the submitter to fix it and submit again.",
  "needs-manual-review": "The checks could not read this repository automatically. It cannot be approved from here.",
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
  const approveOk = canPublish && scanned;
  const decide = s.status === "pending"
    ? `${scanPanel}
<h2>Decide</h2>
${canPublish ? "" : '<p class="note">Publishing is not connected yet (the app has no token to start GitHub jobs), so checks and approving are switched off. You can still reject.</p>'}
${scanned ? "" : '<p class="muted">Approving unlocks after the full checks have run and found nothing that blocks it.</p>'}
<form method="post" action="/admin/submissions/${Number(s.id)}/approve">
<label for="name">Name on the card</label><input id="name" name="name" type="text" required maxlength="80" value="${esc(s.name)}">
<label for="kind">Type</label>${kindSelect(s.kind_guess || "plugin")}${s.kind_guess ? "" : '<p class="hint">The file names did not show what this is; choose carefully.</p>'}
<label for="text">Card text <span class="hint">(up to 400 characters; the README excerpt, or the recommender's note, to start with)</span></label><textarea id="text" name="text" required maxlength="400">${esc(defaultText)}</textarea>
<label for="tags">Tags <span class="hint">(comma-separated, up to 12; they help people find it. Starting from the repository's own GitHub topics)</span></label><input id="tags" name="tags" type="text" maxlength="400" value="${esc(s.topics)}" placeholder="for example planning, marketing">
<label class="check"><input type="checkbox" name="pick" value="yes"> I use this kit (list it as one of my picks)</label>
<label for="pick_note">How I use it <span class="hint">(one line, up to 200 characters; needed if you ticked the box above, and shown on the card)</span></label><input id="pick_note" name="pick_note" type="text" maxlength="200">
${flagged ? '<label class="check"><input type="checkbox" name="read" value="yes" required> I have opened and read the full report above</label>' : ""}
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
<form method="post" action="/admin/submissions/${Number(s.id)}/reopen"><p><button class="ghost" type="submit">Back to review</button> <span class="muted">Run the full checks, read them, and approve with the report in front of you.</span></p></form>` : ""}`;
  return page(`${s.name} — Praxikit admin`, `${nav(session)}
<p class="muted"><a href="/admin">All submissions</a></p>
<h1>${esc(s.name)} <span class="badge${s.precheck_status === "fail" ? " bad" : s.precheck_status === "flag" ? " warn" : ""}">${status(s.precheck_status)}</span></h1>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
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
${decide}`);
}
