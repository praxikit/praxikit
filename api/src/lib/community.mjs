/**
 * "This helped me" votes and short notes on kits: the rules for a note, and the maintainers' review page.
 * A note is plain text. It is escaped when shown and never rendered as markup, and links are refused, because links are what spam is for.
 */
import { esc, page, nav } from "./html.mjs";

export const COMMUNITY = { votesPerHour: 60, notesPerDay: 5, min: 10, max: 240, listMax: 20, savesShownFrom: 3 };

// a web address in any common form: a scheme, "www.", or a word followed by a usual top-level domain
const LINKISH = /(?:https?:|ftp:|www\.|:\/\/)|\b[a-z0-9-]{2,}\.(?:com|net|org|io|dev|app|ai|co|xyz|ru|cn|me|info|biz|link|top|site|online|shop|club|tk|ly|gl)\b/i;

/** Cleans a note and says why it was refused. Returns { ok: true, text } or { ok: false, error }. */
export function cleanNote(raw) {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < COMMUNITY.min) return { ok: false, error: `Write a little more: at least ${COMMUNITY.min} characters, saying how this kit helped you.` };
  if (text.length > COMMUNITY.max) return { ok: false, error: `That is too long. Keep it to ${COMMUNITY.max} characters.` };
  if (LINKISH.test(text)) return { ok: false, error: "Links are not allowed in notes. Say how it helped, in your own words." };
  if (/(.)\1{11,}/.test(text)) return { ok: false, error: "That does not look like a real note." };
  return { ok: true, text };
}

export function notesAdminPage({ session, rows, flash }) {
  const body = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Note</th><th>Kit</th><th>By</th><th>State</th><th>Decide</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.text)}</td><td>${esc(r.item)}</td><td>@${esc(r.login)}</td><td>${r.status === "pending" ? "New person, waiting" : `Hidden after ${Number(r.reports)} reports`}</td><td>
<form method="post" action="/admin/notes/decide"><input type="hidden" name="id" value="${Number(r.id)}">
<button type="submit" name="action" value="approve">Show</button> <button type="submit" name="action" value="hide" class="ghost">Hide</button> <button type="submit" name="action" value="delete" class="ghost">Delete</button></form></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="muted">Nothing is waiting.</p>';
  return page("Notes to review — Praxikit", `${nav(session)}<h1>Notes to review</h1>
<p class="muted"><a href="/admin">Back to the admin</a>. A person's first note waits here; after you show one, their later notes appear at once. A note that two different people report is hidden until you decide. <strong>Show</strong> publishes it, <strong>Hide</strong> keeps it off the site, <strong>Delete</strong> removes it for good.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}${body}`);
}
