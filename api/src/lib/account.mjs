/**
 * Accounts and private collections: what can be saved, how a label is cleaned, and the pages.
 * What can be saved is decided by the live public catalogue (the site's search-index.json), never by the form.
 */
import { esc, page, nav } from "./html.mjs";
import { parseRepo } from "./repo.mjs";

export const LIMITS = { total: 300, perHour: 40, label: 24 };
const KIT_ITEM = /^k\/[a-z0-9][a-z0-9-]{0,39}\/$/;

/** An item key from a link or a form: a built kit's page path, or a normalised github.com repository link. Anything else is "". */
export function cleanItem(text) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (KIT_ITEM.test(t)) return t;
  const r = parseRepo(t);
  return r ? r.url : "";
}

/** A group name chosen by the person: letters, digits, spaces and a few marks, up to 24 characters. */
export const cleanLabel = (text) => String(text ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _.&+-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.label).trim();

/** The kits and listings that exist right now, from the site's own index: Map(item -> { title, desc, kind }). Throws if it cannot be read. */
export async function fetchCatalogue(env) {
  const base = String(env.SITE_URL || "https://praxikit.github.io/praxikit/").replace(/\/*$/, "/");
  let r;
  try { r = await fetch(`${base}search-index.json`, { headers: { "User-Agent": "praxikit-admin" } }); } catch { throw new Error("catalogue unreachable"); }
  if (!r.ok) throw new Error("catalogue unreadable");
  let list; try { list = JSON.parse(await r.text()); } catch { throw new Error("catalogue unreadable"); }
  const out = new Map();
  for (const e of Array.isArray(list) ? list.slice(0, 5000) : []) {
    const item = e?.k === "kit" ? (KIT_ITEM.test(String(e.u)) ? String(e.u) : "") : e?.k === "pick" || e?.k === "listed" ? cleanItem(e.u) : "";
    if (item && !out.has(item)) out.set(item, { title: String(e.t ?? "").slice(0, 80), desc: String(e.d ?? "").slice(0, 300), kind: String(e.k) });
  }
  return out;
}

const KIND = { kit: "Built by Praxikit", pick: "My pick", listed: "Listed" };
const hrefFor = (env, item) => (item.startsWith("https://") ? item : `${String(env.SITE_URL || "https://praxikit.github.io/praxikit/").replace(/\/*$/, "/")}${item}`);
const siteHome = (env) => String(env.SITE_URL || "https://praxikit.github.io/praxikit/");

export const FLASH_ACCOUNT = {
  saved: "Saved to your collection.",
  removed: "Removed from your collection.",
  limit: "Your collection is full (300 items). Remove something first.",
  slow: "That is a lot of saves in an hour. Try again later.",
  gone: "That kit is not in the catalogue any more, so it cannot be saved.",
  down: "The catalogue could not be read just now. Try again in a minute.",
  confirm: "The name you typed did not match your GitHub username, so nothing was deleted.",
  bad: "That did not look right. Check the group name (letters, numbers and spaces, up to 24).",
};

export function savePage({ session, env, item, info, saved, label = "", error = "" }) {
  return page("Save to your collection — Praxikit", `${nav(session)}
<h1>Save to your collection</h1>
${error ? `<p class="note">${esc(error)}</p>` : ""}
<div class="listing"><strong>${esc(info.title)}</strong> <span class="muted">${esc(KIND[info.kind] ?? "")}</span><p>${esc(info.desc)}</p>
<p class="muted"><a href="${esc(hrefFor(env, item))}" rel="noopener noreferrer">${esc(item.startsWith("https://") ? item : siteHome(env) + item)}</a></p></div>
<form method="post" action="/collection/save"><input type="hidden" name="item" value="${esc(item)}">
<label for="label">Group <span class="hint">(optional, your own name for a set, such as "planning" or "work"; up to 24 characters)</span></label><input id="label" type="text" name="label" maxlength="24" value="${esc(label)}">
<p><button type="submit">${saved ? "Update" : "Save"}</button> <a class="btn ghost" href="/collection">My collection</a></p></form>
<p class="muted">Your collection is private: no page shows it to anyone else. <a href="/privacy">What we keep about you</a>.</p>`);
}

export function collectionPage({ session, env, rows, catalogue, flash, user }) {
  const groups = new Map();
  for (const r of rows) { const g = r.label || ""; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const order = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const row = (r) => {
    const info = catalogue?.get(r.item);
    return `<li class="listing"><strong>${info ? `<a href="${esc(hrefFor(env, r.item))}" rel="noopener noreferrer">${esc(info.title)}</a>` : esc(r.item)}</strong> <span class="muted">${info ? esc(KIND[info.kind] ?? "") : catalogue ? "No longer in the catalogue" : ""}</span>
${info ? `<p>${esc(info.desc)}</p>` : ""}
<form method="post" action="/collection/remove"><input type="hidden" name="item" value="${esc(r.item)}"><button class="ghost" type="submit">Remove</button> <a href="/collection/save?item=${encodeURIComponent(r.item)}">Change group</a></form></li>`;
  };
  return page("My collection — Praxikit", `${nav(session)}
<h1>My collection</h1>
<p class="muted">Private to you. <a href="${esc(siteHome(env))}kits/">Browse kits</a> and press Save on any of them.</p>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
${catalogue ? "" : '<p class="note">The catalogue could not be read just now, so names are not shown.</p>'}
${rows.length ? order.map((g) => `<h2>${g ? esc(g) : "Ungrouped"}</h2><ul class="plain">${groups.get(g).map(row).join("")}</ul>`).join("") : '<p class="muted">Nothing saved yet.</p>'}
<h2>Your account</h2>
<p class="muted">Signed in as @${esc(session.sub)}${user ? `, since ${esc(String(user.created_at).slice(0, 10))}` : ""}. <a href="/privacy">What we keep about you</a>.</p>
<p><a class="btn ghost" href="/account/export">Download my data</a></p>
<form method="post" action="/account/delete" class="listing danger"><strong>Delete my account</strong>
<p class="muted">This removes your collection, your waiting submissions and your account record. Submissions that were already decided stay in the catalogue's history without your name. It cannot be undone.</p>
<label for="confirm">Type your GitHub username (<code>${esc(session.sub)}</code>) to confirm</label><input id="confirm" type="text" name="confirm" autocomplete="off" maxlength="60">
<p><button type="submit" class="ghost">Delete my account and everything in it</button></p></form>`);
}

export const privacyPage = (session) => page("Privacy — Praxikit", `${session ? nav(session) : '<div class="top"><strong>Praxikit</strong></div>'}
<h1>Privacy</h1>
<p>Praxikit is a small catalogue. You do not need an account to read it. An account is only for submitting a kit or keeping a private collection.</p>
<h2>What we keep</h2>
<ul>
<li><strong>Your GitHub username and numeric id</strong>, the date you first signed in and the date you last did. That is all GitHub tells us: we ask for the <code>read:user</code> permission only, and we do not keep your GitHub access token.</li>
<li><strong>Your collection:</strong> the kits you saved and the group names you typed.</li>
<li><strong>Your submissions:</strong> the repository link, what GitHub says about it, the checks, and the maintainers' decision.</li>
<li><strong>One sign-in cookie</strong>, so you stay signed in for a few hours. There are no advertising or analytics cookies and nothing is sold or shared.</li>
</ul>
<h2>Who can see it</h2>
<p>Nothing in the app shows your collection to anyone else. Maintainers see your submissions and your username next to them. The person who runs the app can technically read the database, because that is how a database works; they do not look through collections.</p>
<h2>Your controls</h2>
<ul><li>Download everything we hold about you: <a href="/account/export">/account/export</a> (when signed in).</li>
<li>Delete your account from the bottom of <a href="/collection">My collection</a>. Your collection, waiting submissions and account record are deleted. Decided submissions stay as the catalogue's record, with your name removed.</li></ul>
<h2>Limits</h2>
<p>To keep this fair and cheap to run, a collection holds up to 300 items and up to 40 can be added in an hour.</p>
<h2>Questions</h2>
<p>Open an issue in the <a href="https://github.com/praxikit/praxikit/issues" rel="noopener noreferrer">praxikit repository</a>.</p>`);
