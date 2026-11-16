/**
 * Contributors: people who put a kit forward that is now listed. Counting is by listings that are live right now, never by
 * submissions sent, so sending a lot earns nothing. A person appears publicly only when they switched it on.
 */
import { esc, page, nav } from "./html.mjs";

export const BADGES = [
  { id: "first", name: "First listing", blurb: "Put forward a kit that is now listed.", test: (c) => c.count >= 1 },
  { id: "five", name: "Five listed", blurb: "Five of their kits are listed.", test: (c) => c.count >= 5 },
  { id: "ten", name: "Ten listed", blurb: "Ten of their kits are listed.", test: (c) => c.count >= 10 },
  { id: "picked", name: "Picked", blurb: "One of their kits is a pick the owner uses.", test: (c) => c.picked >= 1 },
  { id: "author", name: "Author", blurb: "Submitted a kit they wrote themselves.", test: (c) => c.author >= 1 },
];
export const badgesFor = (c) => BADGES.filter((b) => b.test(c));

/** What is left to the next count milestone, or null once all are reached. */
export function nextMilestone(count) {
  for (const [at, name] of [[1, "First listing"], [5, "Five listed"], [10, "Ten listed"]]) if (count < at) return { need: at - count, name };
  return null;
}

/**
 * Everyone's live contributions: Map(userId -> { id, count, picked, author, items }). `catalogue` is the live catalogue (see
 * fetchCatalogue), so a listing that has been removed stops counting, and a repository counts once per person.
 */
export async function contributionsFor(store, catalogue) {
  const live = new Map();
  for (const [key, v] of catalogue) if (key.startsWith("https://")) live.set(key.toLowerCase(), v);
  const out = new Map();
  const seen = new Set();
  for (const r of await store.listedSubmissions()) {
    const url = String(r.repo_url).toLowerCase(), v = live.get(url);
    if (!v || seen.has(`${r.id}|${url}`)) continue;
    seen.add(`${r.id}|${url}`);
    const c = out.get(r.id) ?? { id: r.id, count: 0, picked: 0, author: 0, items: [] };
    c.count++; if (v.kind === "pick") c.picked++; if (r.source === "community") c.author++;
    c.items.push({ title: v.title, path: v.path });
    out.set(r.id, c);
  }
  return out;
}

/** The public board: people who opted in and have at least one live listing, most first. */
export async function boardFor(store, catalogue) {
  const contrib = await contributionsFor(store, catalogue);
  const rows = [];
  for (const u of await store.publicUsers()) {
    const c = contrib.get(u.id);
    if (c && c.count > 0) rows.push({ ...c, login: u.login });
  }
  rows.sort((a, b) => b.count - a.count || b.picked - a.picked || a.login.localeCompare(b.login));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { const key = `${r.count}|${r.picked}`; if (key !== prev) { rank = i + 1; prev = key; } r.rank = rank; });
  return rows;
}

const avatar = (id, size = 64) => `https://avatars.githubusercontent.com/u/${Number(id)}?s=${size}`;
const chips = (c) => badgesFor(c).map((b) => `<li class="badge-chip" title="${esc(b.blurb)}">${esc(b.name)}</li>`).join("");
const listingLink = (i) => (i.path ? `<a href="/${esc(i.path)}">${esc(i.title)}</a>` : esc(i.title));

export function contributorsPage({ session, rows }) {
  const body = rows.length
    ? `<ol class="board">${rows.map((r) => `<li><span class="rank">${Number(r.rank)}</span><img src="${avatar(r.id)}" alt="" width="40" height="40"><div class="who"><a class="login" href="/u/${esc(encodeURIComponent(r.login))}">@${esc(r.login)}</a><ul class="badge-row">${chips(r)}</ul></div><span class="score"><strong>${Number(r.count)}</strong> listed</span></li>`).join("")}</ol>`
    : `<div class="empty"><p><strong>Nobody is on the board yet.</strong> Put a kit forward and tick <em>Credit me publicly</em>, and you will be the first. <a href="/submit/">Submit a kit</a>.</p></div>`;
  return page("Contributors — Praxikit", `${nav(session)}<h1>Contributors</h1>
<p class="lead">People who put kits forward that are now listed. Ranked by kits that are live in the catalogue, not by how many were sent, so quality is what counts. Everyone here chose to be listed.</p>
${body}
<p class="muted">Want to be here? <a href="/submit/">Submit a kit</a> and tick <em>Credit me publicly</em>, or switch it on in <a href="/settings">Settings</a>. You can switch it off at any time.</p>`);
}

export function contributorProfilePage({ session, user, c }) {
  const badges = badgesFor(c);
  return page(`@${user.login} — Praxikit`, `${nav(session)}<div class="profile-head"><img src="${avatar(user.id, 144)}" alt="" width="72" height="72"><div><h1>@${esc(user.login)}</h1>
<p class="muted">Contributor · ${Number(c.count)} ${c.count === 1 ? "kit" : "kits"} listed · <a href="https://github.com/${esc(encodeURIComponent(user.login))}" rel="noopener noreferrer">GitHub profile</a></p></div></div>
${badges.length ? `<h2>Badges</h2><ul class="badge-list">${badges.map((b) => `<li><strong>${esc(b.name)}</strong><span class="muted">${esc(b.blurb)}</span></li>`).join("")}</ul>` : ""}
<h2>Kits put forward</h2>
<ul class="plain">${c.items.map((i) => `<li class="listing">${listingLink(i)}</li>`).join("")}</ul>
<p class="muted"><a href="/contributors">All contributors</a></p>`);
}

/** The block on the person's own profile: what counts, what is next, and whether they are public. */
export function myContributionsHtml({ c, pending, isPublic, login }) {
  const next = nextMilestone(c.count);
  return `<h2>My contributions</h2>
<div class="listing"><p><strong>${Number(c.count)}</strong> ${c.count === 1 ? "kit" : "kits"} listed${pending ? `, ${Number(pending)} waiting for review` : ""}.${next ? ` ${Number(next.need)} more for <em>${esc(next.name)}</em>.` : " You have every count badge."}</p>
${badgesFor(c).length ? `<ul class="badge-row">${chips(c)}</ul>` : '<p class="muted">Badges appear when a kit you put forward is listed.</p>'}
<p class="muted">${isPublic ? `You are credited publicly. <a href="/u/${esc(encodeURIComponent(login))}">See your public profile</a>.` : "Your contributions are private. Switch on public credit in Settings to appear on the board and be named on the listings you put forward."} <a href="/settings">Settings</a></p></div>`;
}

export const publicSettingHtml = ({ isPublic }) => `<h2>Public credit</h2>
<p>Choose whether your GitHub username is shown on the kits you put forward and on the <a href="/contributors">Contributors</a> board. It is off until you turn it on, and you can turn it off at any time.</p>
<form method="post" action="/settings/public"><input type="hidden" name="public" value="${isPublic ? "no" : "yes"}"><p class="muted">Right now: <strong>${isPublic ? "credited publicly" : "private"}</strong>.</p>
<button type="submit" class="${isPublic ? "ghost" : ""}">${isPublic ? "Turn off public credit" : "Turn on public credit"}</button></form>`;
