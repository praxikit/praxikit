/**
 * Kit requests: people say what kit they wish existed, others press "I need this too", and anyone can build it and submit it.
 * A request is plain text with no links. A person's first request is read by a maintainer before it appears.
 */
import { esc, page, nav } from "./html.mjs";
import { LINKISH } from "./community.mjs";

export const REQUESTS = { perDay: 3, needsPerHour: 60, titleMin: 8, titleMax: 100, bodyMax: 500 };

const hasLink = (text) => LINKISH.test(text);

/** Cleans a request and says why it was refused. Returns { ok: true, title, body } or { ok: false, error }. */
export function cleanRequest(rawTitle, rawBody) {
  const tidy = (t) => String(t ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim();
  const title = tidy(rawTitle), body = tidy(rawBody);
  if (title.length < REQUESTS.titleMin) return { ok: false, error: `Say what you need in a few words (at least ${REQUESTS.titleMin} characters).` };
  if (title.length > REQUESTS.titleMax) return { ok: false, error: `Keep the title to ${REQUESTS.titleMax} characters; put the rest in the details.` };
  if (body.length > REQUESTS.bodyMax) return { ok: false, error: `The details are too long. Keep them to ${REQUESTS.bodyMax} characters.` };
  if (hasLink(title) || hasLink(body)) return { ok: false, error: "Links are not allowed here. Describe what you need in your own words." };
  if (/(.)\1{11,}/.test(title + body)) return { ok: false, error: "That does not look like a real request." };
  return { ok: true, title, body };
}

export const FLASH_REQUESTS = {
  posted: "Thanks. Your request is up.",
  waiting: "Thanks. A maintainer will read your first request before it appears; only you can see it until then.",
  needed: "Got it: you need this too.",
  unneeded: "Taken back.",
  deleted: "Your request is deleted.",
  decided: "Done.",
  slow: "That is a lot in a short time. Try again later.",
  bad: "That did not look right. Try again.",
  gone: "That request is no longer there.",
  unsolved: "That kit is not in the catalogue, so it cannot be used to solve a request.",
};

const when = (iso) => String(iso).slice(0, 10);

/** Plain-words page. `catalogue` is the live catalogue, used to name the kit that solved a request. */
export function requestsPage({ session, open, solved, mine, needed, catalogue, flash, error, values = {}, signedIn }) {
  const kitLink = (item) => { const v = catalogue?.get(item); return v ? (v.path ? `<a href="/${esc(v.path)}">${esc(v.title)}</a>` : esc(v.title)) : "a kit in the catalogue"; };
  const needBtn = (r) => signedIn
    ? `<form method="post" action="/requests/need"><input type="hidden" name="id" value="${Number(r.id)}"><button type="submit" class="need-btn" aria-pressed="${needed.has(Number(r.id))}">${needed.has(Number(r.id)) ? "You need this" : "I need this too"} <span class="count">${Number(r.needs)}</span></button></form>`
    : `<a class="need-btn" href="/auth/login?mode=user&return=%2Frequests">I need this too <span class="count">${Number(r.needs)}</span></a>`;
  const card = (r) => `<li class="request${r.status === "solved" ? " solved" : ""}"><div class="req-main"><h3>${esc(r.title)}</h3>${r.body ? `<p>${esc(r.body)}</p>` : ""}<p class="muted">Asked by @${esc(r.login)} · ${esc(when(r.created_at))}${r.status === "solved" ? ` · <span class="kind">Solved</span> by ${kitLink(r.solved_item)}` : ""}</p></div>${needBtn(r)}</li>`;
  const myBlock = mine.length ? `<h2>Your requests waiting for a maintainer</h2><ul class="requests">${mine.map((r) => `<li class="request"><div class="req-main"><h3>${esc(r.title)}</h3>${r.body ? `<p>${esc(r.body)}</p>` : ""}<p class="muted">${r.status === "pending" ? "Waiting. Only you can see this." : "Hidden by a maintainer."}</p></div><form method="post" action="/requests/delete"><input type="hidden" name="id" value="${Number(r.id)}"><button type="submit" class="ghost">Delete</button></form></li>`).join("")}</ul>` : "";
  const form = signedIn
    ? `<form method="post" action="/requests/new" class="req-form"><h2>Ask for a kit</h2>
<label for="req-title">What do you need?</label><input id="req-title" type="text" name="title" maxlength="${REQUESTS.titleMax}" required placeholder="A skill that turns meeting notes into tickets" value="${esc(values.title ?? "")}">
<label for="req-body">More detail <span class="hint">(optional)</span></label><textarea id="req-body" name="body" maxlength="${REQUESTS.bodyMax}" placeholder="What it should do, and what you use today.">${esc(values.body ?? "")}</textarea>
<p class="muted">One or two sentences is plenty. No links. A maintainer reads your first request before it appears.</p>
<p><button type="submit" class="btn">Post my request</button></p></form>`
    : `<div class="listing"><h2>Ask for a kit</h2><p>Sign in with GitHub to ask for a kit, or to press <em>I need this too</em> on someone else's.</p><p><a class="btn" href="/auth/login?mode=user&return=%2Frequests">Sign in with GitHub</a></p></div>`;
  return page("Kit requests — Praxikit", `${nav(session)}<h1>Kit requests</h1>
<p class="lead">Is there a kit you wish existed? Ask for it here. Others press <strong>I need this too</strong>, so the most wanted ones rise to the top. Anyone can build one and <a href="/submit/">submit it</a>. When a listed kit answers a request, it is marked <strong>Solved</strong>.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${error ? `<p class="note">${esc(error)}</p>` : ""}
${form}
${myBlock}
<h2>People are asking for</h2>
${open.length ? `<ul class="requests">${open.map(card).join("")}</ul>` : `<div class="empty"><p><strong>No requests yet.</strong> Be the first to ask for a kit.</p></div>`}
${solved.length ? `<h2>Solved</h2><ul class="requests">${solved.map(card).join("")}</ul>` : ""}
<p class="muted">Built something that fits a request? <a href="/submit/">Submit your kit</a> and name the request in your note, and a maintainer will mark it solved.</p>`);
}

export function requestsAdminPage({ session, rows, flash }) {
  const body = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Request</th><th>By</th><th>State</th><th>Decide</th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.title)}</strong>${r.body ? `<br>${esc(r.body)}` : ""}</td><td>@${esc(r.login)}</td><td>${r.status === "pending" ? "New, waiting" : `Shown · ${Number(r.needs)} need it`}</td><td>
<form method="post" action="/admin/requests/decide"><input type="hidden" name="id" value="${Number(r.id)}">
${r.status === "pending" ? '<button type="submit" name="action" value="show">Show</button> ' : ""}<button type="submit" name="action" value="hide" class="ghost">Hide</button> <button type="submit" name="action" value="delete" class="ghost">Delete</button>
<label class="vh" for="s${Number(r.id)}">Listing address that solves it</label><input id="s${Number(r.id)}" type="text" name="item" placeholder="https://github.com/owner/repo, or k/keel/"> <button type="submit" name="action" value="solve" class="ghost">Mark solved</button></form></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="muted">Nothing is waiting.</p>';
  return page("Requests to review — Praxikit", `${nav(session)}<h1>Requests to review</h1>
<p class="muted"><a href="/admin">Back to the admin</a>. A person's first request waits here; after you show one, their later requests appear at once. To mark a request solved, paste the address of the listed kit that answers it (a GitHub link as listed, or a built kit like <code>k/keel/</code>).</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${body}`);
}
