#!/usr/bin/env node
// Contributors: shown by default, ranked by listings that are live now (a podium for the top three, then a list), with badges;
// hiding your name takes effect at once; removal and deletion too. Fake GitHub and site, real SQLite. No network.
// Run from the repo root: node --no-warnings api/test-contributors.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.mjs";
import { badgesFor, nextMilestone } from "./src/lib/contributors.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const raw = new DatabaseSync(":memory:");
raw.exec(readFileSync(join(here, "schema.sql"), "utf8"));
const D1 = { prepare(sql) { const st = raw.prepare(sql); let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }; return api; } };
const SECRET = "s".repeat(40);
const env = { BASE_URL: "https://admin.example.dev", ORG: "praxikit", TEAM: "maintainers", REPO: "praxikit/praxikit", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, SITE_URL: "https://site.example.dev/praxikit/", DB: D1 };
const OK = "https://admin.example.dev";
const XSS = "<script>alert(1)</script>";

let INDEX;
const resetIndex = () => {
  INDEX = [
    { t: XSS + " A", k: "listed", u: "https://github.com/o/a", p: "l/o-a/", ext: 1, d: "a", g: "" },
    { t: "B pick", k: "pick", u: "https://github.com/o/b", p: "l/o-b/", ext: 1, d: "b", g: "" },
    { t: "C", k: "listed", u: "https://github.com/o/c", p: "l/o-c/", ext: 1, d: "c", g: "" },
    { t: "D", k: "listed", u: "https://github.com/o/d", p: "l/o-d/", ext: 1, d: "d", g: "" },
    { t: "F", k: "listed", u: "https://github.com/o/f", p: "l/o-f/", ext: 1, d: "f", g: "" },
    { t: "G", k: "listed", u: "https://github.com/o/g", p: "l/o-g/", ext: 1, d: "g", g: "" },
    { t: "keel", k: "kit", u: "k/keel/", d: "x", g: "" },
  ];
};
resetIndex();
const USERS = { "tok-carol": { login: "carol", id: 3 }, "tok-dave": { login: "dave", id: 4 }, "tok-eve": { login: "eve", id: 5 } };
const CODES = { "u-carol": "tok-carol", "u-dave": "tok-dave", "u-eve": "tok-eve" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.href === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return CODES[b.code] ? json({ access_token: CODES[b.code] }) : json({ error: "bad" }); }
  if (u.href === "https://site.example.dev/praxikit/search-index.json") return json(INDEX);
  if (u.origin === "https://api.github.com" && u.pathname === "/user") { const t = String(init.headers?.Authorization ?? "").replace("Bearer ", ""); return USERS[t] ? json(USERS[t]) : json({}, 401); }
  return json({}, 404);
};

const everything = [];
const call = (path, { method = "GET", cookies = {}, origin, form } = {}) => {
  const headers = new Headers();
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("Cookie", c);
  if (origin) headers.set("Origin", origin);
  const init = { method, headers };
  if (form) { headers.set("Content-Type", "application/x-www-form-urlencoded"); init.body = new URLSearchParams(form).toString(); }
  return worker.fetch(new Request(`https://admin.example.dev${path}`, init), env);
};
const text = async (r) => { const t = await r.text(); everything.push(t); return t; };
const cookieValue = (res, name) => { const c = res.headers.getSetCookie().find((x) => x.startsWith(name + "=")); return c ? c.slice(name.length + 1).split(";")[0] : undefined; };
async function signIn(code) {
  const login = await call("/auth/login?mode=user");
  const state = new URL(login.headers.get("Location")).searchParams.get("state");
  const cb = await call(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { cookies: { "__Host-praxikit-state": cookieValue(login, "__Host-praxikit-state") } });
  return { "__Host-praxikit-session": cookieValue(cb, "__Host-praxikit-session") };
}
const rows = (sql, ...a) => raw.prepare(sql).all(...a);
let n = 0;
const sub = (userId, login, repo, source, state = "listed", status = "approved") => raw.prepare("INSERT INTO submissions (repo_url, repo_key, name, owner, owner_type, submitted_by, submitted_by_id, source, commit_sha, precheck, precheck_status, status, created_at, publish_state) VALUES (?, ?, 'x', 'o', 'User', ?, ?, ?, 'a', '[]', 'pass', ?, '2026-11-16', ?)").run(repo, repo.toLowerCase().replace("https://github.com/", "") + (n++), login, userId, source, status, state);

// ---- the rules, on their own
must(badgesFor({ count: 0, picked: 0, author: 0 }).length === 0, "no listings, no badges");
must(badgesFor({ count: 1, picked: 0, author: 0 }).map((b) => b.id).join() === "first", "one listing earns First listing");
must(badgesFor({ count: 10, picked: 1, author: 1 }).map((b) => b.id).join() === "first,five,ten,picked,author", "ten listings with a pick and an authored kit earn everything");
must(nextMilestone(0).need === 1 && nextMilestone(3).need === 2 && nextMilestone(3).name === "Five listed" && nextMilestone(7).need === 3 && nextMilestone(10) === null, "the next milestone counts down, and ends at ten");

// ---- the data: carol 2 live (one pick, one authored) plus one removed from the catalogue; dave 1; frank 1; gina 1; eve 1
const carol = await signIn("u-carol"), dave = await signIn("u-dave"), eve = await signIn("u-eve");
raw.prepare("INSERT INTO users (id, login, created_at, last_seen) VALUES (6, 'frank', '2026-11-16', '2026-11-16'), (7, 'gina', '2026-11-16', '2026-11-16')").run();
sub(3, "carol", "https://github.com/o/a", "recommended"); sub(3, "carol", "https://github.com/o/b", "community"); sub(3, "carol", "https://github.com/o/gone", "community");
sub(3, "carol", "https://github.com/o/pending", "community", "", "pending");
sub(4, "dave", "https://github.com/o/c", "recommended"); sub(4, "dave", "https://github.com/o/notyet", "recommended", "dispatched");
sub(5, "eve", "https://github.com/o/d", "recommended");
sub(6, "frank", "https://github.com/o/f", "recommended");
sub(7, "gina", "https://github.com/o/g", "recommended");

// ---- shown by default, no switch to flip
let html = await text(await call("/contributors"));
const listHtml = html.slice(html.indexOf('<ol class="lb-list">'));
const order = [...listHtml.matchAll(/class="login" href="\/u\/([^"]+)"/g)].map((m) => m[1]);
must(order.join() === "carol,dave,eve,frank,gina", `everyone with a live listing is on the board, most first, ties by name: ${order.join()}`);
must(html.includes('class="place place-1"') && html.includes('class="place place-2"') && html.includes('class="place place-3"') && !html.includes('class="place place-4"'), "the top three stand on a podium");
must(/place-1"[\s\S]*?class="crown"[\s\S]*?carol[\s\S]*?2 kits/.test(html) && /place-2"[\s\S]*?<span class="posn">2<\/span>/.test(html) && /place-3"[\s\S]*?<span class="posn">2<\/span>/.test(html), "first place wears the crown and is carol with two live listings (the removed and pending ones do not count); second and third show their place");
must(/<span class="rank">1<\/span>[\s\S]*?carol[\s\S]*?<span class="score"><strong>2<\/strong>/.test(listHtml) && /gina[\s\S]*?<span class="score"><strong>1<\/strong>/.test(listHtml) && !html.includes("Everyone else"), "everyone, top three included, is in the ranked list with a score box");
must(/<span class="rank">2<\/span>[\s\S]*?dave[\s\S]*?<span class="rank">2<\/span>[\s\S]*?eve/.test(listHtml), "a tie shares a place");
must(html.includes("First listing") && html.includes("Picked") && html.includes("Author") && !html.includes("Five listed"), "badges follow what the person has done");
must(html.includes("5</strong> people") && html.includes("6</strong> kits"), "the page says how many people and kits");
must(html.includes("&lt;") === false || !html.includes("<script>alert(1)"), "nothing hostile reaches the board unescaped");
must((await call("/contributors")).headers.get("Content-Security-Policy").includes("default-src 'none'"), "the board carries the app's strict policy");
must((await call("/u/carol")).status === 200 && (await call("/u/gina")).status === 200, "every contributor has a public page");

// ---- the home page's strip
{
  const c = await call("/api/community");
  const d = await c.json();
  must(c.status === 200 && (c.headers.get("Cache-Control") ?? "").includes("max-age") && d.contributors.map((x) => x.login).join() === "carol,dave,eve" && d.contributors[0].count === 2 && Array.isArray(d.requests), "the home strip carries the top three contributors and is cacheable");
  must(!JSON.stringify(d).includes("token") && d.contributors.every((x) => Object.keys(x).sort().join() === "count,id,login"), "and only a name, a number and a public GitHub id for each");
}

// ---- a person's page
html = await text(await call("/u/carol"));
must(html.includes("@carol") && html.includes('href="/l/o-b/"') && html.includes('href="/l/o-a/"') && !html.includes("gone"), "the page lists the live kits with links to their pages");
must(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.includes("<script>alert(1)"), "a hostile kit title is escaped");
must((await call("/u/CAROL")).status === 200 && (await call("/u/nobody")).status === 404 && (await call("/u/a%20b")).status === 404 && (await call("/u/" + "x".repeat(60))).status === 404 && (await call("/u/<script>")).status === 404, "case is ignored; unknown and malformed names are 404");

// ---- the submit form: no choice, just a plain notice
html = await text(await call("/submit", { cookies: eve }));
must(!html.includes('name="credit"') && html.includes("Your GitHub username is shown on the listing"), "the form has no tickbox; it says plainly that the name is shown");

// ---- credit on the listing
const item = async (url) => (await (await call("/api/item?item=" + encodeURIComponent(url))).json());
must((await item("https://github.com/o/a")).credit?.login === "carol" && (await item("https://github.com/o/c")).credit?.login === "dave", "a listing names the person who put it forward");
must((await item("k/keel/")).credit === null && !JSON.stringify(await item("https://github.com/o/a")).includes('"id"'), "nobody is named for a kit built here, and only the username is shared");

// ---- your own view
html = await text(await call("/profile", { cookies: carol }));
must(html.includes("<strong>2</strong> kits listed") && html.includes("1 waiting for review") && html.includes("3 more for <em>Five listed</em>") && html.includes('href="/u/carol"') && html.includes("Your username is shown"), "the owner sees their count, pending work, the next milestone and the link to their page");
html = await text(await call("/settings", { cookies: carol }));
must(html.includes("Hide my name") && html.includes("<strong>shown</strong>"), "settings shows that the name is shown, with a way to hide it");

// ---- the switch, and a request that does not come from this site
must((await call("/settings/public", { method: "POST", origin: OK, form: { public: "no" } })).status === 401, "hiding needs a sign-in");
must((await call("/settings/public", { method: "POST", cookies: eve, origin: "https://evil.example", form: { public: "no" } })).status === 403, "and a request from this site");
let r = await call("/settings/public", { method: "POST", cookies: eve, origin: OK, form: { public: "no" } });
must(r.status === 303 && r.headers.get("Location") === "/settings?m=publicOff", "eve hides her name");
html = await text(await call("/contributors"));
must((await (await call("/api/community")).json()).contributors.map((x) => x.login).join() === "carol,dave,frank", "a hidden name leaves the home strip too");
must(!html.includes("@eve") && (await call("/u/eve")).status === 404 && (await item("https://github.com/o/d")).credit === null, "hidden means off the board, off her page and off the listing, at once");
html = await text(await call("/profile", { cookies: eve }));
must(html.includes("<strong>1</strong> kit listed") && html.includes("Your name is hidden"), "she still sees her own count");
html = await text(await call("/settings", { cookies: eve }));
must(html.includes("Show my name") && html.includes("<strong>hidden</strong>"), "and can show it again");
r = await call("/settings/public", { method: "POST", cookies: eve, origin: OK, form: { public: "yes" } });
must(r.headers.get("Location") === "/settings?m=publicOn" && (await text(await call("/contributors"))).includes("@eve"), "showing it again puts her back");

// ---- a listing taken off the site stops counting at once
INDEX = INDEX.filter((e) => e.u !== "https://github.com/o/a");
html = await text(await call("/contributors"));
must(/carol[\s\S]*?<span class="score"><strong>1<\/strong>/.test(html.slice(html.indexOf('<ol class="lb-list">'))), "removing a listing lowers the score straight away");
resetIndex();

// ---- the data download, and deleting an account
const exp = await (await call("/account/export", { cookies: dave })).json();
must(exp.public_credit === true, "the data download says whether your name is shown");
r = await call("/account/delete", { method: "POST", cookies: dave, origin: OK, form: { confirm: "dave" } });
must(r.status === 200 && rows("SELECT * FROM profiles WHERE user_id = 4").length === 0 && !(await text(await call("/contributors"))).includes("@dave") && (await call("/u/dave")).status === 404 && (await item("https://github.com/o/c")).credit === null, "deleting an account removes the person from the board and the listing");

// ---- with nobody, a friendly empty state
raw.prepare("DELETE FROM submissions").run();
html = await text(await call("/contributors"));
must(html.includes("Nobody is on the board yet") && !html.includes("podium") && !html.includes("lb-list"), "an empty board says so and invites the first kit");

for (const t of everything) must(!/<script(?!>alert)|\son\w+=/i.test(t.replace(/&lt;[^&]*&gt;/g, "")), "no scripts or inline event handlers in any page");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: contributors are shown by default on a podium and a list, ranked by live listings with badges, credited on listings, hideable at once, and gone on removal or deletion");
