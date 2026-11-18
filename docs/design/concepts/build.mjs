#!/usr/bin/env node
// Three design concepts for Praxikit, as clickable prototypes of three screens each (home, kits, one listing),
// built from the real catalogue so they can be judged with real names, commits and scores.
//   node docs/design/concepts/build.mjs        writes docs/design/concepts/{ledger,workbench,shelf}/ and index.html
// Prototypes only: nothing here is shipped or imported by the site.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { healthScore, fmtStars } from "../../../site/listings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const TODAY = "2026-11-18";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- data: the real catalogue ----------
const listings = JSON.parse(readFileSync(join(root, "site", "listings.json"), "utf8"));
const metrics = JSON.parse(readFileSync(join(root, "site", "metrics.json"), "utf8"));
const drift = JSON.parse(readFileSync(join(root, "site", "drift.json"), "utf8"));
const KIND = { plugin: "Plugin", skill: "Skill", mcp: "MCP config", template: "Template", agent: "Agent", hook: "Hook", adapter: "Adapter" };
const LIC = (id) => (id === "none" ? "No licence" : id === "NOASSERTION" ? "Custom licence" : id);
const FOUND_TITLES = { shape: "Recognisable kit contents", licence: "Licence", secrets: "Secret-like strings", autorun: "Runs automatically", network: "Network access in code", exec: "Runs other programs or code", instructions: "Commands in agent instructions", odd: "Binaries, hidden instructions, obfuscation", size: "Size" };
const FOUND_WORDS = { pass: "Pass", flag: "Look closer", fail: "Fail" };

const built = [
  { name: "keel", kind: "plugin", author: "Praxikit", repo: "praxikit/praxikit", commit: "—", added: "2026-11-16", stars: 0, licence: "MIT", health: null, level: "", why: "Plan with a critique gate, build in phases that prove themselves, give each task to the cheapest capable model, see what it cost.", built: true, version: "0.6.2" },
  { name: "pitch-panel", kind: "skill", author: "Praxikit", repo: "praxikit/praxikit", commit: "—", added: "2026-11-15", stars: 0, licence: "MIT", health: null, level: "", why: "Put a startup idea in front of six seats (CTO, CMO, COO, PM, CFO, devil's advocate), then get a verdict and one cheap test.", built: true, version: "0.2.1" },
];
const real = listings.filter((l) => metrics[l.url]).slice(0, 12).map((l) => {
  const h = healthScore(l, metrics[l.url], drift[l.url], TODAY);
  return { name: l.name, kind: l.kind, author: l.author, repo: l.url.replace("https://github.com/", ""), commit: l.commit.slice(0, 7), added: l.added, stars: metrics[l.url].stars, licence: LIC(metrics[l.url].licence), health: h?.score ?? null, level: h?.level ?? "", why: l.why, pick: !!l.pick, note: l.note, found: l.found, moved: drift[l.url] === "changed" };
});
const KITS = [...built, ...real];
const FEATURED = real.find((k) => k.found && k.name.includes("Postgres")) ?? real.find((k) => k.found) ?? real[0];
const count = (k) => KITS.filter((x) => x.kind === k).length;
const ALLCOUNT = 29, TYPES = [["Plugins", 4, "plugin"], ["Skills", 6, "skill"], ["MCP configs", 18, "mcp"], ["Templates and more", 1, "template"]];
const INSTALL = "/plugin marketplace add praxikit/praxikit";
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

mkdirSync(join(here, "fonts"), { recursive: true });
copyFileSync(join(root, "site", "fonts", "bricolage-grotesque.woff2"), join(here, "fonts", "bricolage-grotesque.woff2"));
copyFileSync(join(root, "site", "fonts", "OFL.txt"), join(here, "fonts", "OFL.txt"));

const write = (concept, file, html) => { const dir = join(here, concept); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, file), html); };
const FONT_FACE = `@font-face{font-family:"Bricolage Grotesque";src:url("../fonts/bricolage-grotesque.woff2") format("woff2");font-weight:200 800;font-display:swap}`;
const page = (title, css, body, extra = "") => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${FONT_FACE}\n${css}</style></head>\n<body>${body}${extra}</body></html>`;

const foundRows = (k) => (k.found?.checks ?? []).map((c) => ({ title: FOUND_TITLES[c.id] ?? c.id, status: c.status, word: FOUND_WORDS[c.status], note: c.note }));

// =====================================================================================
// CONCEPT A: LEDGER. "The receipt is the product." A typographic, ruled-paper world: the catalogue is a ledger of what was read.
// =====================================================================================
const LEDGER_CSS = `
:root{--bg:#f8f9fb;--ink:#0d1117;--mut:#586274;--rule:#d5dae2;--rule2:#0d1117;--sig:#d63a1b;--card:#fff;--mono:ui-monospace,"Cascadia Code",Consolas,monospace;--disp:"Bricolage Grotesque",system-ui,sans-serif}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.w{width:min(1180px,100% - 48px);margin-inline:auto}
header.top{border-bottom:2px solid var(--rule2)}header.top .w{display:flex;align-items:center;justify-content:space-between;height:64px}
.brand{font:700 1.35rem/1 var(--disp);letter-spacing:-.03em;text-decoration:none}.brand i{display:inline-block;width:.7em;height:.7em;background:var(--sig);margin-right:.35em;border-radius:2px}
nav a{margin-left:28px;text-decoration:none;font-size:.95rem;color:var(--mut)}nav a:hover,nav a[aria-current]{color:var(--ink)}nav a[aria-current]{border-bottom:2px solid var(--sig);padding-bottom:4px}
h1{font:700 clamp(2.6rem,1.2rem + 5vw,5.6rem)/.98 var(--disp);letter-spacing:-.045em;margin:0 0 24px;max-width:13ch}
h2{font:650 1.5rem/1.15 var(--disp);letter-spacing:-.02em;margin:0 0 16px}
.lead{font-size:1.2rem;color:var(--mut);max-width:44ch;margin:0 0 32px}
.hero{padding:72px 0 40px}
.stamp{display:inline-block;border:2px solid var(--sig);color:var(--sig);padding:4px 12px;font:700 .8rem/1.2 var(--mono);letter-spacing:.14em;text-transform:uppercase;transform:rotate(-3deg);border-radius:4px}
table.ledger{width:100%;border-collapse:collapse;font-size:.95rem}
.ledger th{font:600 .72rem/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--mut);text-align:left;padding:10px 12px 10px 0;border-bottom:2px solid var(--rule2)}
.ledger td{padding:14px 12px 14px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}
.ledger tr:hover td{background:#eef1f6}.ledger td.n{font:.8rem var(--mono);color:var(--mut);width:48px}.ledger td.name{font-weight:650}.ledger td.name small{display:block;font-weight:400;color:var(--mut);font-size:.82rem}
.ledger td.m,.ledger th.m{font-family:var(--mono);font-size:.85rem}.ledger .num{text-align:right}
.h{display:inline-flex;align-items:center;gap:8px;font:600 .85rem var(--mono)}.h b{display:inline-block;width:46px;height:6px;background:var(--rule);border-radius:3px;position:relative;overflow:hidden}.h b::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);background:var(--ink)}
.cmd{display:flex;gap:16px;align-items:center;justify-content:space-between;margin:28px 0 0;padding:14px 18px;border:1px solid var(--rule2);font:.9rem var(--mono);background:var(--card)}.cmd button{font:600 .8rem var(--mono);border:1px solid var(--ink);background:var(--ink);color:#fff;padding:8px 14px;border-radius:2px;cursor:pointer}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:2px solid var(--rule2);margin-top:72px}
.cols>div{padding:28px 28px 28px 0;border-right:1px solid var(--rule)}.cols>div+div{padding-left:28px}.cols>div:last-child{border-right:0}.cols p{color:var(--mut);margin:8px 0 0}.cols .no{font:.8rem var(--mono);color:var(--sig)}
footer{border-top:2px solid var(--rule2);margin-top:96px;padding:28px 0 56px;color:var(--mut);font-size:.9rem}
.btn{display:inline-block;background:var(--ink);color:#fff;padding:12px 20px;border-radius:2px;text-decoration:none;font-weight:600}.btn.o{background:transparent;color:var(--ink);border:1px solid var(--ink);margin-left:8px}
.rail{display:grid;grid-template-columns:220px 1fr;gap:48px;padding:48px 0}.rail aside h3{font:600 .72rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:0 0 10px}.rail aside ul{list-style:none;padding:0;margin:0 0 28px}.rail aside li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--rule);font-size:.95rem}.rail aside li.on{font-weight:700}
.rail aside li span{font-family:var(--mono);color:var(--mut)}
.doc{width:min(760px,100% - 48px);margin:56px auto 0}.doc .crumb{font:.8rem var(--mono);color:var(--mut)}
.receipt{border:2px solid var(--rule2);background:var(--card);padding:32px 36px;position:relative;margin:32px 0}.receipt .stamp{position:absolute;right:28px;top:-16px;background:var(--bg)}
.receipt dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:0}.receipt dt,.receipt dd{padding:10px 0;border-bottom:1px dotted #9aa3b2;margin:0}.receipt dt{color:var(--mut);padding-right:24px;font-size:.9rem}.receipt dd{font-family:var(--mono);font-size:.92rem}
.sig{display:flex;justify-content:space-between;margin-top:40px;font:.85rem var(--mono);color:var(--mut)}.sig div{border-top:1px solid var(--ink);padding-top:8px;min-width:220px}
.res{font-weight:700}.res.flag{color:var(--sig)}
@media(max-width:820px){.cols{grid-template-columns:1fr}.cols>div{border-right:0;border-bottom:1px solid var(--rule);padding-left:0!important}.rail{grid-template-columns:1fr}.ledger .hide{display:none}.receipt{padding:22px}}
`;
const ledgerHead = (cur) => `<header class="top"><div class="w"><a class="brand" href="index.html"><i></i>Praxikit</a><nav><a href="index.html"${cur === "home" ? " aria-current=page" : ""}>Ledger</a><a href="kits.html"${cur === "kits" ? " aria-current=page" : ""}>All kits</a><a href="#">Submit</a><a href="#">Sign in</a></nav></div></header>`;
const ledgerFoot = `<footer><div class="w">Praxikit · every kit read before it is listed · Free and open source (MIT) · <a href="#">Policy</a> · <a href="#">Removal log</a></div></footer>`;
const hbar = (k) => (k.health == null ? `<span class="h">—</span>` : `<span class="h"><b style="--w:${k.health}%"></b>${k.health}</span>`);
const ledgerRows = (list, n0 = 1) => list.map((k, i) => `<tr><td class="n">${String(n0 + i).padStart(2, "0")}</td><td class="name"><a href="listing.html" style="text-decoration:none">${esc(k.name)}</a><small>${esc(k.author)}</small></td><td>${esc(KIND[k.kind])}</td><td class="m">${esc(k.commit)}</td><td class="hide">${esc(k.licence)}</td><td class="num">${hbar(k)}</td><td class="m hide num">${esc(k.added)}</td></tr>`).join("");
const LEDGER_HEAD = `<thead><tr><th>No.</th><th>Kit</th><th>Type</th><th class="m">Commit read</th><th class="hide">Licence</th><th class="num">Health</th><th class="hide num">Listed</th></tr></thead>`;

write("ledger", "index.html", page("Praxikit · Ledger concept", LEDGER_CSS, `${ledgerHead("home")}
<main class="w"><section class="hero"><div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;flex-wrap:wrap"><div><h1>Read before it is listed.</h1><p class="lead">A catalogue of kits for AI coding agents. Every entry here is a record of what was checked, at which commit, and by whom.</p><a class="btn" href="kits.html">Open the ledger</a><a class="btn o" href="#">Submit a kit</a></div><span class="stamp">Read by a person</span></div></section>
<section><table class="ledger">${LEDGER_HEAD}<tbody>${ledgerRows(KITS.slice(2, 10), 1)}</tbody></table>
<div class="cmd"><span>${esc(INSTALL)}</span><button>Copy</button></div></section>
<section class="cols"><div><span class="no">01</span><h2>A scan reads it</h2><p>An automatic check reads the repository. It never runs or installs anything.</p></div><div><span class="no">02</span><h2>A person decides</h2><p>The result is read before anything is listed. Nothing is listed for payment.</p></div><div><span class="no">03</span><h2>The commit is pinned</h2><p>The entry records the commit that was read. A daily check tells you if it changes.</p></div></section></main>${ledgerFoot}`));

write("ledger", "kits.html", page("Praxikit · Ledger · All kits", LEDGER_CSS, `${ledgerHead("kits")}
<main class="w"><div class="rail"><aside><h3>Type</h3><ul><li class="on">All <span>${ALLCOUNT}</span></li>${TYPES.map(([n, c]) => `<li>${n} <span>${c}</span></li>`).join("")}</ul><h3>Source</h3><ul><li>Built here <span>2</span></li><li>My picks <span>1</span></li><li>Listed <span>26</span></li></ul><h3>Sort</h3><ul><li class="on">Newest</li><li>Health</li><li>Stars</li></ul></aside>
<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><h1 style="font-size:3rem;margin:0">All kits</h1><span style="font-family:var(--mono);color:var(--mut)">${ALLCOUNT} entries</span></div><table class="ledger">${LEDGER_HEAD}<tbody>${ledgerRows(KITS, 1)}</tbody></table></div></div></main>${ledgerFoot}`));

const k = FEATURED;
write("ledger", "listing.html", page(`Praxikit · Ledger · ${k.name}`, LEDGER_CSS, `${ledgerHead("kits")}
<main class="doc"><div class="crumb"><a href="kits.html">All kits</a> / ${esc(KIND[k.kind])}</div><h1 style="font-size:3.6rem;margin-top:12px">${esc(k.name)}</h1><p class="lead">${esc(k.why)}</p>
<div class="receipt"><span class="stamp">Read · ${esc(k.added)}</span><dl><dt>Commit read</dt><dd>${esc(k.commit)}</dd><dt>Read by</dt><dd>royal-programmer, on ${esc(k.added)}</dd><dt>Automatic check</dt><dd>${foundRows(k).filter((r) => r.status !== "pass").length ? "things for a person to look at" : "nothing found"}</dd><dt>Licence</dt><dd>${esc(k.licence)}</dd><dt>Health score</dt><dd>${k.health} of 100</dd><dt>Stars</dt><dd>${fmtStars(k.stars)}</dd><dt>Made by</dt><dd>${esc(k.author)}, not built by Praxikit</dd></dl>
<div class="sig"><div>Read by · royal-programmer</div><div>Commit · ${esc(k.commit)}</div></div></div>
<h2>What the check found</h2><table class="ledger"><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>${foundRows(k).map((r) => `<tr><td>${esc(r.title)}</td><td class="res ${r.status}">${esc(r.word)}</td><td style="color:var(--mut)">${esc(r.note)}</td></tr>`).join("")}</tbody></table>
<div class="cmd"><span>${esc(INSTALL)}</span><button>Copy</button></div><p style="margin-top:12px"><a class="btn" href="#">View on GitHub</a><a class="btn o" href="#">Save</a></p></main>${ledgerFoot}`));

// =====================================================================================
// CONCEPT B: WORKBENCH. "A tool you can drive from the keyboard." A three-pane app shell: sidebar, list, detail.
// =====================================================================================
const WB_CSS = `
:root{--bg:#e8ebf0;--panel:#fff;--line:#d2d7df;--ink:#10151d;--mut:#5d6a7b;--acc:#d9480f;--accbg:#fdeee6;--ok:#14705f;--mono:ui-monospace,"Cascadia Code",Consolas,monospace;--disp:"Bricolage Grotesque",system-ui,sans-serif}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column}
.bar{display:flex;align-items:center;gap:16px;height:52px;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--line)}
.brand{font:700 1.1rem var(--disp);letter-spacing:-.02em;text-decoration:none;color:var(--ink);display:flex;align-items:center;gap:8px}.brand i{width:18px;height:18px;background:var(--acc);border-radius:5px;display:inline-block}
.cmdk{flex:1;max-width:560px;display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:0 12px;height:34px;color:var(--mut)}.cmdk kbd{margin-left:auto;font:.72rem var(--mono);border:1px solid var(--line);border-radius:4px;padding:1px 6px;background:var(--panel)}
.bar .sp{flex:1}.bar a.s{color:var(--mut);text-decoration:none}.bar .btn{background:var(--acc);color:#fff;padding:6px 14px;border-radius:7px;text-decoration:none;font-weight:600}
.shell{flex:1;display:grid;grid-template-columns:220px 380px 1fr;min-height:0}
.side{background:var(--panel);border-right:1px solid var(--line);padding:16px 10px;overflow:auto}.side h4{font:600 .68rem var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:18px 8px 6px}.side h4:first-child{margin-top:0}
.side a{display:flex;justify-content:space-between;padding:6px 8px;border-radius:6px;color:var(--ink);text-decoration:none}.side a:hover{background:var(--bg)}.side a.on{background:var(--accbg);color:var(--acc);font-weight:650}.side a span{font:.78rem var(--mono);color:var(--mut)}
.list{background:var(--bg);border-right:1px solid var(--line);overflow:auto}.list .hd{display:flex;justify-content:space-between;padding:12px 16px;font:.72rem var(--mono);color:var(--mut);letter-spacing:.06em;text-transform:uppercase;position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line)}
.row{display:grid;grid-template-columns:28px 1fr auto;gap:2px 12px;padding:11px 16px;border-bottom:1px solid var(--line);cursor:pointer;text-decoration:none;color:inherit}.row:hover{background:#dfe3ea}.row.sel{background:var(--panel);box-shadow:inset 3px 0 0 var(--acc)}
.row .g{grid-row:span 2;width:28px;height:28px;border-radius:7px;background:var(--accbg);color:var(--acc);display:grid;place-items:center;font:700 .8rem var(--mono)}.row b{font-weight:650}.row small{color:var(--mut);font:.75rem var(--mono)}.row .hp{font:600 .8rem var(--mono);align-self:center}
.detail{background:var(--panel);overflow:auto;padding:28px 36px}.detail h1{font:700 2.1rem/1.1 var(--disp);letter-spacing:-.03em;margin:0 0 8px}.detail .by{color:var(--mut);margin:0 0 20px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:20px 0}.tabs a{padding:8px 14px;color:var(--mut);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}.tabs a.on{color:var(--ink);border-color:var(--acc);font-weight:650}
.kv{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:16px 0}.kv div{background:var(--panel);padding:12px 14px}.kv small{display:block;font:.68rem var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}.kv b{font:600 1rem var(--mono)}
table{width:100%;border-collapse:collapse}th{font:600 .7rem var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--mut);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}td{padding:9px 10px;border-bottom:1px solid var(--line)}td.f{color:var(--acc);font-weight:650}td.p{color:var(--ok);font-weight:650}
.term{background:#10151d;color:#e6edf3;border-radius:10px;padding:14px 16px;font:.88rem var(--mono);display:flex;justify-content:space-between;gap:12px;margin:12px 0}.term button{background:#26303d;color:#e6edf3;border:0;border-radius:6px;padding:4px 12px;font:600 .78rem var(--mono)}
.empty h1{font-size:2.6rem}.hint{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.hint div{border:1px solid var(--line);border-radius:10px;padding:14px}.hint kbd{font:.75rem var(--mono);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
.btn{display:inline-block;background:var(--acc);color:#fff;padding:8px 16px;border-radius:7px;text-decoration:none;font-weight:600}.btn.o{background:transparent;color:var(--ink);border:1px solid var(--line);margin-left:6px}
@media(max-width:1000px){.shell{grid-template-columns:1fr}.side{display:none}.detail{display:none}.list{border:0}}
`;
const wbShell = (cur, detailHtml, selName) => `<div class="bar"><a class="brand" href="index.html"><i></i>Praxikit</a><div class="cmdk">⌕ Search kits, tags, authors<kbd>/</kbd></div><div class="sp"></div><a class="s" href="#">Docs</a><a class="s" href="#">Submit</a><a class="btn" href="#">Sign in</a></div>
<div class="shell"><nav class="side"><h4>Browse</h4><a class="${cur === "home" ? "" : "on"}" href="kits.html">All kits <span>${ALLCOUNT}</span></a>${TYPES.map(([n, c]) => `<a href="kits.html">${n} <span>${c}</span></a>`).join("")}<h4>Source</h4><a href="kits.html">Built here <span>2</span></a><a href="kits.html">My picks <span>1</span></a><a href="kits.html">Listed <span>26</span></a><h4>Yours</h4><a href="#">Saved <span>0</span></a><a href="#">Requests</a><a href="#">Contributors</a></nav>
<section class="list"><div class="hd"><span>${cur === "home" ? "Recently listed" : "All kits"}</span><span>Newest ↓</span></div>${KITS.slice(cur === "home" ? 2 : 0, cur === "home" ? 10 : 14).map((x) => `<a class="row${x.name === selName ? " sel" : ""}" href="listing.html"><span class="g">${esc(KIND[x.kind][0])}</span><b>${esc(x.name)}</b><span class="hp">${x.health ?? "—"}</span><small>${esc(x.author)} · ${esc(x.commit)}</small><small>${fmtStars(x.stars)}★</small></a>`).join("")}</section>
<section class="detail">${detailHtml}</section></div>`;
write("workbench", "index.html", page("Praxikit · Workbench concept", WB_CSS, wbShell("home", `<div class="empty"><h1>Kits for AI coding agents,<br>read before you trust.</h1><p style="max-width:52ch;color:var(--mut);font-size:1.05rem">Pick a kit on the left. Its page shows the commit that was read and what the check found. Drive it with the keyboard.</p>
<div class="term"><span>${esc(INSTALL)}</span><button>Copy</button></div>
<div class="hint"><div><kbd>/</kbd><p>Search</p></div><div><kbd>j</kbd> <kbd>k</kbd><p>Move through the list</p></div><div><kbd>↵</kbd><p>Open the receipt</p></div></div><a class="btn" href="kits.html">Browse ${ALLCOUNT} kits</a><a class="btn o" href="#">Submit a kit</a></div>`, "")));
write("workbench", "kits.html", page("Praxikit · Workbench · Kits", WB_CSS, wbShell("kits", `<h1>${esc(FEATURED.name)}</h1><p class="by">by ${esc(FEATURED.author)} · ${esc(KIND[FEATURED.kind])}</p><p>${esc(FEATURED.why)}</p><div class="kv"><div><small>Commit read</small><b>${esc(FEATURED.commit)}</b></div><div><small>Health</small><b>${FEATURED.health}</b></div><div><small>Stars</small><b>${fmtStars(FEATURED.stars)}</b></div><div><small>Licence</small><b>${esc(FEATURED.licence)}</b></div></div><a class="btn" href="listing.html">Open the receipt</a>`, FEATURED.name)));
write("workbench", "listing.html", page(`Praxikit · Workbench · ${k.name}`, WB_CSS, wbShell("kits", `<p class="by" style="margin:0 0 6px"><a href="kits.html" style="color:var(--mut)">All kits</a> / ${esc(KIND[k.kind])}</p><h1>${esc(k.name)}</h1><p class="by">by ${esc(k.author)}, not built by Praxikit · listed ${esc(k.added)}</p><p style="max-width:70ch">${esc(k.why)}</p>
<div class="kv"><div><small>Commit read</small><b>${esc(k.commit)}</b></div><div><small>Health</small><b>${k.health}/100</b></div><div><small>Stars</small><b>${fmtStars(k.stars)}</b></div><div><small>Licence</small><b>${esc(k.licence)}</b></div></div>
<div class="tabs"><a class="on" href="#">Check</a><a href="#">Score</a><a href="#">Install</a><a href="#">Notes</a></div>
<table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>${foundRows(k).map((r) => `<tr><td>${esc(r.title)}</td><td class="${r.status === "pass" ? "p" : "f"}">${esc(r.word)}</td><td style="color:var(--mut)">${esc(r.note)}</td></tr>`).join("")}</tbody></table>
<p style="color:var(--mut);margin-top:12px;max-width:70ch">Read by a person at <b>${esc(k.commit)}</b> before listing. “Look closer” means a pattern turned up that a human has to judge; it does not mean the kit is unsafe.</p>
<div class="term"><span>${esc(INSTALL)}</span><button>Copy</button></div><a class="btn" href="#">View on GitHub</a><a class="btn o" href="#">Save</a>`, k.name)));

// =====================================================================================
// CONCEPT C: SHELF. "Kits are objects you pick up and turn over to read the label." Colourful covers; the receipt is the label on the back.
// =====================================================================================
const TCOL = { plugin: "#5b3df5", skill: "#ff6b3d", mcp: "#00907a", template: "#d92f7a", agent: "#c98f00", hook: "#3a4a8c", adapter: "#3b7a1f" };
const SH_CSS = `
:root{--bg:#f1f0fa;--ink:#17142b;--mut:#5c5876;--card:#fff;--line:#dcd9ee;--mono:ui-monospace,"Cascadia Code",Consolas,monospace;--disp:"Bricolage Grotesque",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.w{width:min(1200px,100% - 48px);margin-inline:auto}
header{display:flex;align-items:center;justify-content:space-between;height:72px}.brand{font:800 1.5rem var(--disp);letter-spacing:-.04em;text-decoration:none;display:flex;gap:10px;align-items:center}.brand i{width:26px;height:26px;border-radius:8px;background:conic-gradient(#5b3df5,#ff6b3d,#00907a,#5b3df5);display:inline-block}
nav a{margin-left:24px;text-decoration:none;font-weight:600;color:var(--mut)}nav a:hover{color:var(--ink)}nav .pill{background:var(--ink);color:#fff;padding:9px 18px;border-radius:99px}
h1{font:800 clamp(2.8rem,1.2rem + 6vw,6rem)/.95 var(--disp);letter-spacing:-.05em;margin:0 0 20px}h2{font:750 1.8rem var(--disp);letter-spacing:-.03em;margin:0 0 18px}
.lead{font-size:1.25rem;color:var(--mut);max-width:40ch}
.cover{position:relative;aspect-ratio:3/4;border-radius:18px;overflow:hidden;background:var(--c);color:#fff;display:block;text-decoration:none;box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 14px 30px -14px rgba(23,20,43,.5);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
a.cover:hover{transform:translateY(-8px) rotate(-1.2deg)}.cover svg{position:absolute;inset:0;width:100%;height:100%}.cover .t{position:absolute;left:14px;top:14px;font:700 .68rem var(--mono);letter-spacing:.12em;text-transform:uppercase;background:rgba(0,0,0,.25);padding:3px 8px;border-radius:99px}
.cover .nm{position:absolute;left:14px;right:14px;bottom:44px;font:800 1.5rem/1 var(--disp);letter-spacing:-.04em;overflow-wrap:anywhere}.cover .au{position:absolute;left:14px;bottom:16px;font-size:.8rem;opacity:.9}
.seal{position:absolute;right:12px;bottom:12px;width:40px;height:40px;border-radius:50%;background:#fff;color:var(--ink);display:grid;place-items:center;font:800 .85rem var(--disp)}
.hero{display:grid;grid-template-columns:1fr 1.15fr;gap:40px;align-items:center;padding:40px 0 64px}.stack{display:flex;align-items:flex-start;gap:0;justify-content:center;padding:24px 0}.stack .cover{width:34%;margin-left:-8%}.stack .cover:nth-child(1){transform:rotate(-8deg) translateY(16px)}.stack .cover:nth-child(2){transform:rotate(-2deg);z-index:2}.stack .cover:nth-child(3){transform:rotate(6deg) translateY(10px);z-index:1}
.btn{display:inline-block;background:var(--ink);color:#fff;padding:14px 26px;border-radius:99px;text-decoration:none;font-weight:700}.btn.o{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink);margin-left:8px}
.shelf{display:flex;align-items:flex-start;gap:20px;overflow:auto;padding:12px 4px 28px;border-bottom:10px solid #d9d5f0;border-radius:0 0 6px 6px}.shelf .cover{flex:0 0 190px}
.sec{margin-top:56px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:28px}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 28px}.chips a{padding:8px 16px;border-radius:99px;background:var(--card);text-decoration:none;font-weight:650;box-shadow:inset 0 0 0 1px var(--line)}.chips a.on{background:var(--ink);color:#fff}
.how{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:64px}.how div{background:var(--card);border-radius:20px;padding:24px}.how b{font:800 1.2rem var(--disp)}.how p{color:var(--mut);margin:6px 0 0}
.cmd{display:flex;justify-content:space-between;gap:12px;background:var(--ink);color:#fff;padding:14px 18px;border-radius:14px;font:.9rem var(--mono);margin:20px 0}.cmd button{background:#fff;color:var(--ink);border:0;border-radius:99px;padding:6px 16px;font-weight:700}
.prod{display:grid;grid-template-columns:360px 1fr;gap:56px;padding:40px 0;align-items:start}.prod .cover{position:sticky;top:24px}
.label{background:var(--card);border-radius:20px;padding:26px 30px;margin:24px 0;border:3px solid var(--ink)}.label h3{font:800 1.6rem var(--disp);letter-spacing:-.03em;margin:0;border-bottom:8px solid var(--ink);padding-bottom:6px}.label .big{display:flex;justify-content:space-between;font:800 1.1rem var(--disp);border-bottom:4px solid var(--ink);padding:8px 0}.label .r{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--line)}.label .r span:last-child{font-weight:700}.label .r.f span:last-child{color:#c1360c}.label small{display:block;color:var(--mut);margin-top:8px}
footer{margin:80px 0 48px;color:var(--mut)}
@media(max-width:900px){.hero,.prod{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}.how{grid-template-columns:1fr}.stack{display:none}.prod .cover{position:static;max-width:260px}}
`;
const cover = (kit, tag = "span", href = "listing.html") => {
  const h = hash(kit.name), c = TCOL[kit.kind] ?? "#5b3df5", p = h % 5;
  const art = [
    `<g fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3"><circle cx="86" cy="52" r="20"/><circle cx="86" cy="52" r="36"/><circle cx="86" cy="52" r="52"/><circle cx="86" cy="52" r="68"/></g>`,
    `<g stroke="#fff" stroke-opacity=".25" stroke-width="5">${Array.from({ length: 12 }, (_, i) => `<path d="M${-20 + i * 16} 160 L${60 + i * 16} 0"/>`).join("")}</g>`,
    `<g fill="#fff" fill-opacity=".26">${Array.from({ length: 12 }, (_, i) => ((h >> i) & 1 ? `<rect x="${12 + (i % 3) * 32}" y="${14 + Math.floor(i / 3) * 24}" width="24" height="18" rx="5"/>` : "")).join("")}</g>`,
    `<g fill="#fff" fill-opacity=".3">${Array.from({ length: 36 }, (_, i) => `<circle cx="${14 + (i % 6) * 20}" cy="${16 + Math.floor(i / 6) * 17}" r="${2 + ((h >> (i % 20)) & 3)}"/>`).join("")}</g>`,
    `<g fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3">${Array.from({ length: 6 }, (_, i) => `<path d="M0 ${24 + i * 14} Q30 ${8 + i * 14} 60 ${24 + i * 14} T120 ${24 + i * 14}"/>`).join("")}</g>`,
  ][p];
  const inner = `<svg viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${art}</svg><span class="t">${esc(KIND[kit.kind])}</span><span class="nm">${esc(kit.name)}</span><span class="au">${esc(kit.author)}</span>${kit.health != null ? `<span class="seal" title="Health score">${kit.health}</span>` : ""}`;
  return tag === "a" ? `<a class="cover" style="--c:${c}" href="${href}">${inner}</a>` : `<div class="cover" style="--c:${c}">${inner}</div>`;
};
const shHead = `<header class="w"><a class="brand" href="index.html"><i></i>Praxikit</a><nav><a href="kits.html">Kits</a><a href="#">Contributors</a><a href="#">Requests</a><a class="pill" href="#">Submit a kit</a></nav></header>`;
write("shelf", "index.html", page("Praxikit · Shelf concept", SH_CSS, `${shHead}<main class="w"><section class="hero"><div><h1>Pick a kit.<br>Read the label.</h1><p class="lead">Plugins, skills and MCP servers for AI coding agents. Each one was scanned and read by a person, and the label on the back says what they found.</p><p><a class="btn" href="kits.html">Browse ${ALLCOUNT} kits</a><a class="btn o" href="#">Submit</a></p><div class="cmd"><span>${esc(INSTALL)}</span><button>Copy</button></div></div><div class="stack">${[KITS[0], KITS[3], KITS[6]].map((x) => cover(x, "a")).join("")}</div></section>
${TYPES.slice(0, 3).map(([n, c, kind]) => `<section class="sec"><h2>${n} <small style="font:600 1rem system-ui;color:var(--mut)">${c}</small></h2><div class="shelf">${KITS.filter((x) => x.kind === kind).concat(KITS).filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i).filter((x) => kind === "mcp" ? x.kind === "mcp" : x.kind === kind).slice(0, 6).map((x) => cover(x, "a")).join("")}</div></section>`).join("")}
<section class="how"><div><b>1 · Scanned</b><p>An automatic check reads the repository. It never runs anything.</p></div><div><b>2 · Read</b><p>A person reads the result before the kit is listed.</p></div><div><b>3 · Pinned</b><p>The label records the commit that was read.</p></div></section></main><footer class="w">Free and open source (MIT) · Policy · Removal log</footer>`));
write("shelf", "kits.html", page("Praxikit · Shelf · Kits", SH_CSS, `${shHead}<main class="w"><h1 style="font-size:4rem">All kits</h1><div class="chips"><a class="on" href="#">All ${ALLCOUNT}</a>${TYPES.map(([n, c]) => `<a href="#">${n} ${c}</a>`).join("")}<a href="#" style="margin-left:auto">Built here</a><a href="#">My picks</a><a href="#">Healthiest ↓</a></div><div class="grid">${KITS.map((x) => cover(x, "a")).join("")}</div></main><footer class="w">Free and open source (MIT)</footer>`));
write("shelf", "listing.html", page(`Praxikit · Shelf · ${k.name}`, SH_CSS, `${shHead}<main class="w"><div class="prod">${cover(k)}<div><p style="color:var(--mut);margin:0"><a href="kits.html">All kits</a> / ${esc(KIND[k.kind])}</p><h1 style="font-size:3.6rem">${esc(k.name)}</h1><p class="lead">${esc(k.why)}</p>
<div class="label"><h3>Check facts</h3><div class="big"><span>Commit read</span><span>${esc(k.commit)}</span></div><div class="big"><span>Health score</span><span>${k.health} / 100</span></div>${foundRows(k).map((r) => `<div class="r${r.status === "pass" ? "" : " f"}"><span>${esc(r.title)}</span><span>${esc(r.word)}</span></div>`).join("")}<small>Read by a person on ${esc(k.added)}. “Look closer” means a human has to judge a pattern; it does not mean unsafe. “Pass” does not mean safe.</small></div>
<div class="cmd"><span>${esc(INSTALL)}</span><button>Copy</button></div><a class="btn" href="#">View on GitHub</a><a class="btn o" href="#">Save</a></div></div></main><footer class="w">Made by ${esc(k.author)}, not built by Praxikit.</footer>`));

// ---------- the chooser ----------
writeFileSync(join(here, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Praxikit design concepts</title><style>${FONT_FACE.replace("../fonts", "fonts")}
body{margin:0;background:#101319;color:#eef1f6;font:16px/1.6 system-ui,sans-serif}.w{width:min(1100px,100% - 40px);margin:48px auto}h1{font:700 2.6rem/1.1 "Bricolage Grotesque",system-ui;letter-spacing:-.03em;margin:0 0 8px}p{color:#aab3c2;max-width:62ch}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px}.c{background:#1a1f28;border:1px solid #2a3140;border-radius:16px;padding:24px}.c h2{margin:0 0 4px;font:700 1.5rem "Bricolage Grotesque",system-ui}.c .t{color:#8fa1ff;font:.8rem ui-monospace,monospace;margin-bottom:12px;display:block}.c ul{padding-left:18px;color:#aab3c2}.c a{display:inline-block;margin:6px 8px 0 0;padding:8px 14px;border-radius:8px;background:#eef1f6;color:#101319;text-decoration:none;font-weight:650}.c a.o{background:transparent;color:#eef1f6;box-shadow:inset 0 0 0 1px #3a4458}@media(max-width:860px){.g{grid-template-columns:1fr}}</style></head><body><div class="w"><h1>Three directions for Praxikit</h1><p>Each concept is a clickable prototype of three screens (home, all kits, one listing) built from the real catalogue. They are light-theme sketches, not production code.</p><div class="g">
<div class="c"><span class="t">CONCEPT A</span><h2>Ledger</h2><p>The receipt is the product. A ruled, typographic world: the catalogue is a ledger of what was read, when and by whom.</p><ul><li>Best at making “a person read this” visible</li><li>Dense and scannable, very calm</li><li>Least playful, little imagery</li></ul><a href="ledger/index.html">Home</a><a class="o" href="ledger/kits.html">Kits</a><a class="o" href="ledger/listing.html">Listing</a></div>
<div class="c"><span class="t">CONCEPT B</span><h2>Workbench</h2><p>A tool you drive from the keyboard. A three-pane app shell: sidebar, list and detail, with the receipt in the detail pane.</p><ul><li>Fastest for repeat visitors and maintainers</li><li>Feels like a developer tool, not a website</li><li>Weakest first impression for a newcomer</li></ul><a href="workbench/index.html">Home</a><a class="o" href="workbench/kits.html">Kits</a><a class="o" href="workbench/listing.html">Listing</a></div>
<div class="c"><span class="t">CONCEPT C</span><h2>Shelf</h2><p>Kits are objects. Colourful generated covers on a shelf; turn one over and the label on the back is the receipt.</p><ul><li>Most memorable and shareable</li><li>Colour sorts by type at a glance</li><li>Risks looking like a toy store, and is the busiest</li></ul><a href="shelf/index.html">Home</a><a class="o" href="shelf/kits.html">Kits</a><a class="o" href="shelf/listing.html">Listing</a></div></div></div></body></html>`);
console.log("built 3 concepts,", KITS.length, "kits, featured:", FEATURED.name);
