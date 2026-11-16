/**
 * Accounts and private collections: what can be saved, how a label is cleaned, and the pages.
 * What can be saved is decided by the live public catalogue (the site's search-index.json), never by the form.
 */
import { esc, page, nav, mineTable } from "./html.mjs";
import { myContributionsHtml, publicSettingHtml } from "./contributors.mjs";
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
  const base = String(env.SITE_URL || "https://praxikit.com/").replace(/\/*$/, "/");
  let r;
  // The site's files are bound to this Worker, so read them directly: a Worker cannot reliably fetch its own public address.
  try { r = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL("/search-index.json", base))) : await fetch(`${base}search-index.json`, { headers: { "User-Agent": "praxikit-admin" } }); } catch { throw new Error("catalogue unreachable"); }
  if (!r.ok) throw new Error("catalogue unreadable");
  let list; try { list = JSON.parse(await r.text()); } catch { throw new Error("catalogue unreadable"); }
  const out = new Map();
  for (const e of Array.isArray(list) ? list.slice(0, 5000) : []) {
    const item = e?.k === "kit" ? (KIT_ITEM.test(String(e.u)) ? String(e.u) : "") : e?.k === "pick" || e?.k === "listed" ? cleanItem(e.u) : "";
    const path = typeof e?.p === "string" && /^l\/[a-z0-9-]{1,80}\/$/.test(e.p) ? e.p : item.startsWith("k/") ? item : "";
    if (item && !out.has(item)) out.set(item, { title: String(e.t ?? "").slice(0, 80), desc: String(e.d ?? "").slice(0, 300), kind: String(e.k), path });
  }
  return out;
}

const KIND = { kit: "Built by Praxikit", pick: "My pick", listed: "Listed" };
const hrefFor = (env, item) => (item.startsWith("https://") ? item : `${String(env.SITE_URL || "https://praxikit.com/").replace(/\/*$/, "/")}${item}`);
const siteHome = (env) => String(env.SITE_URL || "https://praxikit.com/");

export const FLASH_ACCOUNT = {
  saved: "Saved to your collection.",
  removed: "Removed from your collection.",
  limit: "Your collection is full (300 items). Remove something first.",
  slow: "That is a lot of saves in an hour. Try again later.",
  gone: "That kit is not in the catalogue any more, so it cannot be saved.",
  down: "The catalogue could not be read just now. Try again in a minute.",
  confirm: "The name you typed did not match your GitHub username, so nothing was deleted.",
  noteDone: "Done.",
  publicOn: "You are now credited publicly. Your username shows on the kits you put forward and on the Contributors board.",
  publicOff: "Public credit is off. Nothing about you is shown publicly.",
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
<p class="muted">Your collection is private: no page shows it to anyone else. <a href="/privacy/">What we keep about you</a>.</p>`);
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
<p class="muted"><a href="/settings">Account settings</a> · <a href="/privacy/">Privacy</a></p>`);
}

export function profilePage({ session, rows, count, user, flash, contrib, pending = 0, isPublic = false }) {
  const admin = session.role === "admin";
  return page("Profile — Praxikit", `<div class="profile-head"><img src="https://avatars.githubusercontent.com/u/${Number(session.id)}?s=144" alt="" width="72" height="72"><div><h1>@${esc(session.sub)}</h1>
<p class="muted">${admin ? '<span class="badge">maintainer</span> ' : ""}Signed in with GitHub${user ? `, member since ${esc(String(user.created_at).slice(0, 10))}` : ""}</p></div></div>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
<div class="cards"><a href="/collection"><strong>My collection</strong><span class="muted">${count} saved</span></a><a href="/submit"><strong>Submit a kit</strong><span class="muted">Free, reviewed by a person</span></a><a href="/settings"><strong>Settings</strong><span class="muted">Your data and account</span></a>${admin ? '<a href="/admin"><strong>Admin</strong><span class="muted">Review and manage the catalogue</span></a>' : ""}</div>
${contrib ? myContributionsHtml({ c: contrib, pending, isPublic, login: session.sub }) : ""}
<h2>My submissions</h2><div class="table-wrap">${mineTable(rows)}</div>`);
}

export function settingsPage({ session, user, flash, isPublic = false }) {
  return page("Settings — Praxikit", `<h1>Settings</h1>
${flash ? `<p class="ok">${esc(flash)}</p>` : ""}
<h2>Account</h2>
<dl><dt>GitHub username</dt><dd>@${esc(session.sub)}</dd><dt>GitHub id</dt><dd>${Number(session.id)}</dd><dt>Signed in with</dt><dd>GitHub (username only; no token is kept)</dd><dt>Role</dt><dd>${session.role === "admin" ? "Maintainer" : "Member"}</dd>${user ? `<dt>Member since</dt><dd>${esc(String(user.created_at).slice(0, 10))}</dd><dt>Last sign-in</dt><dd>${esc(String(user.last_seen).slice(0, 10))}</dd>` : ""}</dl>
<p class="muted">Your name and photo come from your GitHub profile. To change them, change them on GitHub; they update here the next time you sign in.</p>
${publicSettingHtml({ isPublic })}
<h2>Your data</h2>
<p>Download everything the app holds about you: your account record, your collection and your submissions.</p>
<p><a class="btn ghost" href="/account/export">Download my data</a> <a href="/privacy/">What we keep and why</a></p>
${session.role === "admin" ? "" : `<h2>Maintainer access</h2>
<p>Maintainers sign in with organisation access, so GitHub can confirm they belong to the praxikit organisation. That asks for more permission than a normal sign-in, so only do it if you are a maintainer.</p>
<p><a class="btn ghost" href="/auth/login">Sign in with organisation access</a></p>`}
<h2>Session</h2>
<form method="post" action="/auth/logout"><button class="ghost" type="submit">Sign out on this device</button></form>
<form method="post" action="/account/delete" class="danger-zone"><h2>Delete my account</h2>
<p class="muted">This removes your collection, your waiting submissions and your account record. Submissions that were already decided stay in the catalogue's history without your name. It cannot be undone.</p>
<label for="confirm">Type your GitHub username (<code>${esc(session.sub)}</code>) to confirm</label><input id="confirm" type="text" name="confirm" autocomplete="off" maxlength="60">
<p><button type="submit" class="ghost">Delete my account and everything in it</button></p></form>`);
}
