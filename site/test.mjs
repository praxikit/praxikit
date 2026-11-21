#!/usr/bin/env node
// Builds the site from a hostile fixture and checks escaping, links and output. No dependencies.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "praxikit-site-"));
const out = join(root, "out");
const put = (rel, text) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const XSS = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;

put("kits/evil/kit.json", JSON.stringify({
  name: "evil", kind: "skill", collections: ["Planning", "Design and 3D"], tags: ["x"], version: "1.2.3",
  promise: XSS, install: [XSS], limits: [XSS],
  installBy: [{ tool: XSS, steps: [XSS], note: XSS }, { tool: "second", steps: ["x"] }],
  preview: [{ title: XSS, note: XSS, body: XSS }],
  access: { reads: [XSS], writes: [XSS], network: XSS },
}));
put("kits/evil/plugin/hooks/hooks.json", JSON.stringify({ hooks: { Stop: [{ matcher: XSS, hooks: [{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs"] }] }] } }));
put("kits/evil/CHANGELOG.md", `# Changelog\n\n## 1.2.3 — 2026-01-01\n- ${XSS}\n`);
put("kits/evil/plugin/skills/s/SKILL.md", `---\nname: ${XSS}\ndescription: ${XSS}\n---\nbody\n`);
for (const n of ["a", "b", "c"]) put(`kits/${n}/kit.json`, JSON.stringify({ name: n, kind: "plugin", collections: ["Planning"], tags: [XSS], version: "0.0.1", promise: "p " + XSS, install: ["/plugin install " + n], limits: ["l"] }));
const SHA = "a".repeat(40);
put("docs/removals.md", "# Removed listings\n\n| Date | Name | Repository | Reason | Note |\n|---|---|---|---|---|\n| 2026-11-16 | <script>x</script> | https://github.com/o/gone | malicious | a note |\n| 2026-13-45 | bad date | https://github.com/o/x | other | skipped |\n| 2026-11-10 | odd link | https://evil.example/x | other | no link |\n");
put("site/drift.json", JSON.stringify({ "https://github.com/o/rec": "changed", "https://github.com/o/comm": "unreachable", "https://github.com/o/newer": "newer", "https://github.com/o/ignored": "bogus", "https://evil.example/x": "changed" }));
put("site/metrics.json", JSON.stringify({ "https://github.com/o/rec": { stars: 64900, licence: "MIT", pushed: "2026-11-10", archived: false }, "https://github.com/o/comm": { stars: 3, licence: "<script>", pushed: "2026-11-10", archived: false } }));
put("site/listings.json", JSON.stringify([
  { name: XSS, url: "https://github.com/o/rec", author: XSS, why: XSS, kind: "mcp", source: "recommended", added: "2026-11-14", commit: SHA, checks: "no-flags-found", pick: true, note: XSS, found: { files: 42, checks: [{ id: "network", status: "flag", note: "3 lines & more" }, { id: "shape", status: "pass", note: "" }] } },
  { name: "Community " + XSS, url: "https://github.com/o/comm", author: "someone", why: XSS, kind: "skill", source: "community", added: "2026-11-14", commit: SHA, checks: "checks-flagged", issue: 5 },
  { name: "A plugin", url: "https://github.com/o/plug", author: "someone", why: "Has a marketplace.", kind: "plugin", source: "community", added: "2026-11-10", commit: SHA, checks: "no-flags-found" },
  { name: "Scanned only", url: "https://github.com/o/scanned", author: "someone", why: "Updated by the scan.", kind: "skill", source: "community", added: "2026-11-10", commit: "c".repeat(40), checks: "no-flags-found", read: "2026-11-19", reader: "scan", readCommit: SHA },
  { name: "Newer commits", url: "https://github.com/o/newer", author: "someone", why: "Has newer commits.", kind: "skill", source: "community", added: "2026-11-14", commit: SHA, checks: "no-flags-found" },
]));

execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "inherit", env: { ...process.env, PRAXIKIT_TODAY: "2026-11-17" } });

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const htmlFiles = walk(out).filter((f) => f.endsWith(".html"));

{
  const kitsHtml = readFileSync(join(out, "kits", "index.html"), "utf8");
  must(kitsHtml.includes("64.9k") && kitsHtml.includes('data-stars="64900"') && kitsHtml.includes('class="seal"') && kitsHtml.includes("Health score "), "a listed card shows its stars and health score");
  must(!kitsHtml.includes("&lt;script&gt;") || !/data-stars="3"/.test(kitsHtml), "facts that do not validate are not shown");
  must(kitsHtml.includes('class="cflag fresh">New</span>') && kitsHtml.includes('<option value="stars">') && kitsHtml.includes('<option value="health">'), "new listings are tagged and the kits page can sort by stars and health");
  const lp = walk(join(out, "l")).filter((f) => f.endsWith("index.html")).map((f) => readFileSync(f, "utf8")).find((h) => h.includes("Health score:"));
  must(!!lp && lp.includes("<table class=\"health\">") && lp.includes("Licence: MIT") && lp.includes("stars are not part of it"), "a listing page shows the score and every point behind it");
}


must(htmlFiles.length === 28, `expected 23 earlier pages plus the removal log and two more listings = 28 html files, got ${htmlFiles.length}`);
{
  // the stylesheet: five source files, assembled into three cascade layers (the app adds a fourth); only the generated cover colours sit outside a layer
  const css = readFileSync(join(out, "style.css"), "utf8"), rows = css.split(String.fromCharCode(10));
  must(css.startsWith("@layer tokens, base, site, app;"), "the stylesheet declares its layers first, in order");
  const opens = rows.filter((l) => l === "@layer tokens {" || l === "@layer base {" || l === "@layer site {");
  const cover = rows.filter((l) => l.startsWith(".cv") && l.endsWith("}"));
  const lastLayerEnd = rows.lastIndexOf("}"), firstCover = rows.findIndex((l) => l.startsWith(".cv"));
  must(opens.length === 3 && cover.length > 0 && firstCover > lastLayerEnd, "tokens, base and site are the three layers, and the cover colours follow them");
  must(existsSync(join(here, "css", "00-tokens.css")) && !existsSync(join(here, "style.css")), "the stylesheet is built from site/css, and there is no second copy to edit by mistake");
}
{
  // the live security policy is style-src 'self': an inline style="" attribute is silently ignored there, so none may be used
  const inline = htmlFiles.filter((f) => / style="/.test(readFileSync(f, "utf8")));
  must(inline.length === 0, `no page uses an inline style attribute (the live policy would ignore it): ${inline.slice(0, 3).join(", ")}`);
  const css = readFileSync(join(out, "style.css"), "utf8");
  const used = new Set([...readFileSync(join(out, "kits", "index.html"), "utf8").matchAll(/class="cover (cv[0-9a-f]{6})"/g)].map((m) => m[1]));
  must(used.size > 0 && [...used].every((c) => css.includes("." + c + "{--c:#")), "every cover colour used on the kits page has its class in the stylesheet");
}
{
  const kp = readFileSync(join(out, "kits", "index.html"), "utf8");
  const opts = (kp.split('<select id="tag">')[1]?.split("</select>")[0] ?? "").split("<option").length - 1;
  must(kp.includes('<details class="filters" id="filters">') && kp.includes('data-show="all"') && opts <= 13, "the kits page keeps search, type tabs, one Filters menu and sort; the tag menu holds at most twelve tags");
}
{
  const home0 = readFileSync(join(out, "index.html"), "utf8");
  must(!home0.includes("Install a kit built here") && !home0.includes("install-steps") && home0.includes("Built by Praxikit") && home0.includes("Browse all ") && home0.includes("<span class=\"ct\">Plugin</span>"), "the home page has no install section, a Built by Praxikit row, and a stack of kinds");
  must(home0.includes('<p class="credit">') && home0.includes("Built with") && home0.includes('href="https://github.com/royal-programmer" rel="noopener noreferrer"') && home0.includes('<a target="_blank" href="https://github.com/royal-programmer"') && home0.includes("(Ratul Roy)") && home0.includes("Search  (Ctrl K)"), "the footer carries a small credit with a safe link to the maker, and the search box names its shortcut");
  must(existsSync(join(out, "fonts", "bricolage-grotesque.woff2")) && existsSync(join(out, "fonts", "OFL.txt")) && home0.includes('rel="preload" href="./fonts/bricolage-grotesque.woff2"') && readFileSync(join(out, "style.css"), "utf8").includes("@font-face"), "the heading font ships with its licence, from this site, and is preloaded");
  must(!home0.includes('class="eyebrow"') && !home0.includes('class="stats"') && !home0.includes('class="trust"') && home0.includes('class="stack"') && home0.includes("Built by Praxikit") && (home0.includes("Read at") || home0.includes("Needs re-review")),"the home page leads with covers and shelves of real listings (what was read, at which commit) and has no eyebrow, stats row or icon cards");
  must(!/border-(left|right):\s*[2-9]px solid var\(--(warn|spark|accent|bad)\)/.test(readFileSync(join(out, "style.css"), "utf8")), "no coloured stripe on the side of a callout or card");
}
{
  const log = readFileSync(join(out, "removals", "index.html"), "utf8");
  must(log.includes("2026-11-16") && log.includes("Malicious") && log.includes("&lt;script&gt;x&lt;/script&gt;") && !log.includes("<script>x</script>") && !log.includes("2026-13-45") && log.includes('href="https://github.com/o/gone"') && !log.includes("evil.example"), "the removal log page lists the rows of docs/removals.md, escaped, and skips rows that are not valid");
}
for (const f of htmlFiles) {
  const h = readFileSync(f, "utf8");
  // drop only our own inline scripts (marked data-site); any other <script> is a failure
  const stripped = h.replace(/<script src="[^"]*"(?: defer)? data-site><\/script>/g, "").replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, "").replace(/<script type="application\/json" id="cmp-data">[^<]*<\/script>/g, "");
  must(!/<script/i.test(stripped), `unexpected <script> in ${f}`);
  must(!/<img src=x/.test(h), `raw <img> payload in ${f}`);
  const noValues = stripped.replace(/="[^"]*"/g, '=""'); // attribute values are inert text; look at attribute names only
  must(!/<[a-z][^>]*\son(error|load|click)=/i.test(noValues), `inline event handler in ${f}`);
  must(h.includes("Praxikit"), `brand name missing in ${f}`);
  must(!/data-checker="[^"]*[<>]/.test(h), `unescaped markup inside data-checker in ${f}`);
}
const idx = readFileSync(join(out, "index.html"), "utf8");
must(idx.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "payload not shown escaped on index");
must(idx.includes('href="./l/o-rec/"') && !idx.includes('class="icon-act"') && !idx.includes('class="pick-note"'), "a pick on the home page links to its own page; cards carry no repository icon and no pick note (both live on the page)");
must(!idx.includes('class="details"') && !idx.includes(">Details<") && !idx.includes("View details"), "cards have no action row: the whole card opens its page");
const skillsPage = readFileSync(join(out, "kits/skills/index.html"), "utf8");
const commHtml = readFileSync(join(out, "l/o-comm/index.html"), "utf8"), recHtml = readFileSync(join(out, "l/o-rec/index.html"), "utf8");
must(recHtml.includes("How to install") && recHtml.includes("not in the Praxikit marketplace") && recHtml.includes("#readme"), "a listed kit says how to install it and that it is not in the marketplace");
must(recHtml.includes("What the check found") && recHtml.includes("42 files read") && recHtml.includes("Look closer") && recHtml.includes("3 lines &amp; more") && recHtml.includes("does not mean the kit is unsafe"), "a listing page shows what the check found, escaped, with the plain meaning of the words");
must(recHtml.includes("This report describes commit") && recHtml.includes("does not cover changes made to the repository after that commit") && recHtml.includes("What it can touch") && recHtml.includes("Not found") && !commHtml.includes("What it can touch"), "a listing page says which commit the report describes, and shows what it can touch only when the check results were saved");
must(commHtml.includes("What the check found") && commHtml.includes("were not saved for this listing yet"), "a listing without the record says so instead of hiding the section");
must(skillsPage.includes('href="../../l/o-comm/"') && skillsPage.includes('data-src="listed"') && !skillsPage.includes('class="cflag pick"') && skillsPage.includes("by someone"), "a community listing shows on its type page as a listed kit, linking to its own page");
must(/href="https:\/\/github\.com\/o\/comm" rel="noopener noreferrer"/.test(commHtml) && commHtml.includes("Submitted by its author") && commHtml.includes("not built by Praxikit") && commHtml.includes("<code>aaaaaaa</code>") && commHtml.includes("Check facts"), "its page links to GitHub safely and carries the review receipt with the reviewed commit");
const mcpPage = readFileSync(join(out, "kits/mcp/index.html"), "utf8");
must(mcpPage.includes("My pick") && !mcpPage.includes('class="pick-note"') && mcpPage.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !mcpPage.includes("<img src=x") && mcpPage.includes("l/o-rec/") && !mcpPage.includes("No MCP configs yet"), "a pick counts as an MCP config, and is marked as a pick");
must(!idx.includes("Needs re-review") && recHtml.includes("Needs re-review") && recHtml.includes('href="https://github.com/o/rec/compare/' + SHA + '...HEAD"'), "a listing whose repository moved on says so, and its page links to the comparison");
must(skillsPage.includes("Repository not reachable") && !skillsPage.includes("Needs re-review"), "an unreachable listing says so, and a 'same' or unknown status adds nothing");
{
  const newerPage = readFileSync(join(out, "l", "o-newer", "index.html"), "utf8");
  must(newerPage.includes("Newer commits since it was read") && newerPage.includes("none touch files that run code") && !newerPage.includes("Needs re-review") && !newerPage.includes('class="cflag warn"') && newerPage.includes('href="https://github.com/o/newer/compare/' + SHA + '...HEAD"'), "a listing with newer commits that touch nothing that runs is told quietly, with a link to the comparison, and gets no warning");
}
{
  const sc = readFileSync(join(out, "l", "o-scanned", "index.html"), "utf8");
  must(sc.includes("scanned automatically on 2026-11-19") && sc.includes("A person last read commit") && sc.includes("<code>aaaaaaa</code>") && sc.includes("Commit scanned") && sc.includes("Last read by a person") && !sc.includes("Commit read"), "a listing updated by the scan alone says so, and names the commit a person last read");
  must(readFileSync(join(out, "kits", "skills", "index.html"), "utf8").includes("Scanned at <code>ccccccc</code>"), "its card says Scanned at, not Read at");
}
{
  const cmp = readFileSync(join(out, "compare", "index.html"), "utf8"), js = readFileSync(join(out, "compare.js"), "utf8");
  const open = '<script type="application/json" id="cmp-data">', from = cmp.indexOf(open) + open.length, raw = [null, cmp.slice(from, cmp.indexOf("</script>", from))];
  let data = null; try { data = JSON.parse(raw[1]); } catch { /* checked below */ }
  must(Array.isArray(data) && data.length >= 2 && data.every((k) => k.id && k.name && k.kind && k.page) && !raw[1].includes("<"), "the compare page carries its data as valid JSON with no raw markup");
  must(!js.includes("innerHTML") && !js.includes("eval(") && js.includes("textContent") && cmp.includes('src="../compare.js"'), "the compare script builds the table from text only and is loaded from the site itself");
  must(readFileSync(join(out, "l", "o-rec", "index.html"), "utf8").includes('href="../../compare/?k=l/o-rec"'), "a listing page links to the comparison with itself preselected");
}
must(readFileSync(join(out, "l", "o-plug", "index.html"), "utf8").includes("/plugin marketplace add o/plug") && !readFileSync(join(out, "l", "o-rec", "index.html"), "utf8").includes("marketplace add o/"), "a listed plugin shows the marketplace command for its repository, with the caveat; other types do not");
const picksHtml = readFileSync(join(out, "kits/mcp/index.html"), "utf8");
must(picksHtml.includes("l/o-rec/") && picksHtml.includes("My pick") && !picksHtml.includes('class="pick-note"') && readFileSync(join(out, "l", "o-rec", "index.html"), "utf8").includes("Why I picked it") && !existsSync(join(out, "picks")) && !existsSync(join(out, "updates")), "picks live on the kits page with the owner's note, and there are no separate Picks or Updates pages");
must(!idx.includes(">Recommended<") && !idx.includes(">Picks<") && idx.includes("My picks"), "the word Recommended is gone, and picks are a section on the home page, not a navigation tab");
must(!/href="https:\/\/github\.com[^"]*"(?![^>]*rel=)/.test(idx), "external GitHub link without rel");
must(existsSync(join(out, "k/evil/index.html")) && existsSync(join(out, "c/planning/index.html")) && existsSync(join(out, "c/design-and-3d/index.html")), "kit or collection pages missing");
must(!/href="\//.test(idx), "absolute href found; links must be relative");
must(/data-text="[^"]*&lt;script&gt;/.test(idx) || !/data-text="[^"]*<script/.test(idx), "search data attribute not escaped");
must(existsSync(join(out, "404.html")), "404.html missing");
const feed = readFileSync(join(out, "feed.xml"), "utf8");
must(feed.startsWith("<?xml") && feed.includes("<entry>") && !feed.includes("<script>alert") && !feed.includes("<img src=x") && feed.includes("&lt;script&gt;"), "feed.xml missing, not escaped, or empty");
must(idx.includes('rel="alternate" type="application/atom+xml"'), "feed link missing from the page head");
const upd = readFileSync(join(out, "k/evil/index.html"), "utf8");
must(!upd.includes("data-ck-paste") && !upd.includes("data-checker") && upd.includes("/plugin marketplace update praxikit") && upd.includes("/reload-plugins"), "a built kit page gives the update command and no longer carries the paste-to-detect checker");
const sub = readFileSync(join(out, "submit/index.html"), "utf8");
must(!sub.includes("template=suggest-kit.yml") && !sub.includes("template=recommend.yml"), "submitting is the form on the site; the old issue forms are gone");
// routes: the home page shows a few kits and links on to pages instead of holding everything
must(idx.includes('href="kits/"') && idx.includes('href="kits/plugins/"') && idx.includes('href="kits/skills/"') && idx.includes('href="kits/mcp/"') && idx.includes('href="kits/other/"'), "home must link to the kits page and each type page");
must(idx.includes('href="kits/"') && idx.includes('href="submit/"') && !idx.includes('href="updates/"') && !idx.includes('href="picks/"') && idx.includes("<body data-home data-root=\"./\" data-app=\"\">"), "home links to kits, the picks filter and submit, and no longer to Updates or Picks pages");
must((idx.match(/<li class="card[ "]/g) ?? []).length <= 6 + 8, "home shows at most six kits to start with and eight recent listings");
const pol = readFileSync(join(out, "policy/index.html"), "utf8");
must(pol.includes("security/advisories/new") && pol.includes("template=report-listing.yml") && pol.includes('href="../removals/"') &&pol.includes("not a safety guarantee") && pol.includes("one maintainer"), "policy page needs the private channel, the report form, the removal log and honest limits");
must(pol.includes("The reviewed commit is not what you install"), "the policy must say that installs follow the author's latest version, not the reviewed commit");
must(skillsPage.includes("Installs follow the author&#39;s latest version") && commHtml.includes("Installs follow the author's latest version"), "every outside listing says installs can differ from the reviewed commit, on the card and on its page");
must(!/href="\//.test(pol) && idx.includes('href="./policy/"') && sub.includes('href="../policy/"'), "policy is linked from the footer and the submit page, with relative links");
const kitsAll = readFileSync(join(out, "kits/index.html"), "utf8");
must(kitsAll.includes('id="q"') && kitsAll.includes('aria-current="page"') && kitsAll.includes('class="typenav"'), "kits page needs search (4+ kits) and the type navigation");
const plug = readFileSync(join(out, "kits/plugins/index.html"), "utf8"), skl = readFileSync(join(out, "kits/skills/index.html"), "utf8"), mcp = readFileSync(join(out, "kits/other/index.html"), "utf8");
must(plug.includes('href="../../k/a/"') && !plug.includes('href="../../k/evil/"'), "plugins page lists plugin kits only");
must(skl.includes('href="../../k/evil/"') && !skl.includes('href="../../k/a/"'), "skills page lists skill kits only");
must(mcp.includes("No templates, adapters, agents or hooks yet") && mcp.includes("../../submit/"), "an empty type page says so and points to submit");
for (const f of [kitsAll, plug, mcp, upd, sub]) must(!/href="\//.test(f), "absolute href on a route page");
const kp = readFileSync(join(out, "k/evil/index.html"), "utf8");
must(kp.includes('role="tablist"') && kp.includes('role="tabpanel"'), "install tabs missing on a kit with installBy");
must(kp.includes("What you'll see") && kp.includes("What it does on your machine"), "preview or access sections missing");
must(kp.includes("<code>x.mjs</code>") && kp.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "hooks list or escaped matcher missing");
must(!kp.includes("data-checker"), "no update checker data on a kit page");
must(kp.includes('id="trust"') && kp.includes("not a security audit") && /class="(pass|fail)"/.test(kp), "build checks panel missing on the kit page");
must(kp.includes('class="fail"'), "a failing check (no LICENSE in the fixture) must be shown as failing, not hidden");
const versions = JSON.parse(readFileSync(join(out, "versions.json"), "utf8"));
must(versions.evil?.version === "1.2.3", "versions.json does not match manifests");

// few kits: the wide-card layout (no search toolbar) is built and escaped too
const root2 = mkdtempSync(join(tmpdir(), "praxikit-site2-"));
mkdirSync(join(root2, "kits", "evil"), { recursive: true });
writeFileSync(join(root2, "kits", "evil", "kit.json"), JSON.stringify({ name: "evil", kind: "skill", collections: ["Planning"], tags: [XSS], version: "1.2.3", promise: XSS, install: ["/plugin marketplace add x", XSS], limits: ["l"] }));
execFileSync("node", [join(here, "build.mjs"), "--root", root2, "--out", join(root2, "out")], { stdio: "pipe" });
const few = readFileSync(join(root2, "out", "index.html"), "utf8");
must(few.includes('class="card"') && !few.includes('id="q"'), "few kits show cards and no search box");
must(!/<img src=x/.test(few) && few.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "card is not escaped");
must(readFileSync(join(root2, "out", "kits", "index.html"), "utf8").includes('class="cover cv') && !readFileSync(join(root2, "out", "kits", "index.html"), "utf8").includes('id="q"'), "with one kit the kits page shows a card and no search");

// tags, search and the submit form
{
  const tagsIdx = readFileSync(join(out, "tags", "index.html"), "utf8");
  must(existsSync(join(out, "tags", "x", "index.html")) && tagsIdx.includes('href="x/"'), "a valid tag gets a page and an index entry");
  const evilKit = readFileSync(join(out, "k", "evil", "index.html"), "utf8");
  must(!evilKit.includes("<script>alert(1)</script>") && !/<img src=x/.test(evilKit), "a hostile tag is not rendered as markup");
  const hostileTagLinks = walk(out).filter((f) => f.endsWith(".html")).some((f) => /href="[^"]*tags[/][^"]*[<>' ]/.test(readFileSync(f, "utf8")));
  must(!hostileTagLinks, "no page links to a tag page built from a hostile tag");
  must(readFileSync(join(out, "kits", "index.html"), "utf8").includes('id="tag"') && !readFileSync(join(out, "kits", "index.html"), "utf8").includes("Browse by tag"), "the kits page filters by tag from a dropdown, not a wall of buttons");
  const index = JSON.parse(readFileSync(join(out, "search-index.json"), "utf8"));
  must(Array.isArray(index) && index.length > 0 && index.every((e) => typeof e.t === "string" && typeof e.u === "string" && (!/^[a-z]+:/.test(e.u) || e.u.startsWith("https://github.com/"))), "the search index has only relative or github.com links");
  const js = readFileSync(join(out, "site.js"), "utf8");
  const a = js.indexOf("/*search-start*/"), b = js.indexOf("/*search-end*/");
  must(a > 0 && b > a, "searchIndex markers are present");
  const searchIndex = new Function(js.slice(a, b) + "; return searchIndex;")();
  const sample = [{ t: "keel", k: "kit", u: "k/keel/", d: "Plans projects in phases", g: "planning critique" }, { t: "marketing", k: "kit", u: "k/m/", d: "Posts and ads", g: "marketing seo" }, { t: "Playwright MCP", k: "pick", u: "https://github.com/o/p", d: "browser testing", g: "mcp testing" }];
  must(searchIndex(sample, "planning")[0].t === "keel", "searching a tag finds the kit");
  must(searchIndex(sample, "ads marketing").length === 1 && searchIndex(sample, "zzz").length === 0 && searchIndex(sample, "   ").length === 0, "all words must match; nonsense and blanks find nothing");
  must(searchIndex(sample, "test")[0].t === "Playwright MCP", "partial words match tags and text");
  const submit = readFileSync(join(out, "submit", "index.html"), "utf8");
  must(submit.includes("opens a GitHub issue") === false && submit.includes("github.com/") , "submit page renders");
}

// Save links and the privacy page: only when the app address is a clean https origin
{
  const keep = existsSync(join(root, "site", "config.json"));
  put("site/config.json", JSON.stringify({ app: "https://app.example.dev/" }));
  const out3 = join(root, "out3");
  execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out3], { stdio: "pipe" });
  const kitsHtml = readFileSync(join(out3, "kits", "index.html"), "utf8");
  must(kitsHtml.includes('href="https://app.example.dev/collection/save?item=k%2Fa%2F"') && kitsHtml.includes('href="https://app.example.dev/collection/save?item=https%3A%2F%2Fgithub.com%2Fo%2Frec"'), "each card has a Save link to the app, with the item encoded");
  must(readFileSync(join(out3, "index.html"), "utf8").includes('id="home-board"') && readFileSync(join(out3, "index.html"), "utf8").includes('id="home-reqs"'), "with the app on the site, the home page has the top contributors and most wanted strip");
  must(!readFileSync(join(out, "index.html"), "utf8").includes('id="home-board"'), "and without the app, no empty strip is shown");
  must(kitsHtml.includes('data-app="https://app.example.dev"') && kitsHtml.includes('id="acct"') && kitsHtml.includes('href="https://app.example.dev/auth/login?mode=user"'), "the header has a sign-in link to the app and the account slot the script fills");
  must(!kitsHtml.split('href="https://app.example.dev').slice(1).some((x) => /^[^"]*[<>' ]/.test(x)), "no app link contains markup");
  put("site/config.json", JSON.stringify({ app: "javascript:alert(1)" }));
  const out4 = join(root, "out4");
  execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out4], { stdio: "pipe" });
  must(!readFileSync(join(out4, "kits", "index.html"), "utf8").includes("collection/save") && !readFileSync(join(out4, "kits", "index.html"), "utf8").includes("javascript:alert(1)\""), "an app address that is not an https origin is ignored");
  void keep;
}

// security.txt: where to report a vulnerability
{
  const st = readFileSync(join(out, ".well-known", "security.txt"), "utf8");
  const exp = /^Expires: (\S+)$/m.exec(st);
  must(/^Contact: https:\/\/github\.com\/praxikit\/praxikit\/security\/advisories\/new$/m.test(st) && exp && Date.parse(exp[1]) > Date.now() + 300 * 86400_000 && /^Canonical: https:\/\/praxikit\.com\/\.well-known\/security\.txt$/m.test(st), "security.txt names a private way to report, expires in about a year and says where it lives");
}

// share card, structured data and the about page
{
  const home = readFileSync(join(out, "index.html"), "utf8"), evil = readFileSync(join(out, "k", "evil", "index.html"), "utf8");
  const png = readFileSync(join(out, "og.png"));
  must(png.subarray(1, 4).toString() === "PNG" && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, "the share image is a 1200x630 PNG");
  const ico = readFileSync(join(out, "favicon.ico")), touch = readFileSync(join(out, "apple-touch-icon.png"));
  must(ico.readUInt16LE(2) === 1 && ico[6] === 48 && ico.subarray(22, 26).toString("latin1").includes("PNG") && touch.readUInt32BE(16) === 180 && home.includes("favicon.ico") && !home.includes('rel="icon" href="data:'), "the icon is a real file (favicon.ico, svg, touch icon) that search engines can fetch, not a data address");
  must(home.includes('property="og:image"') && home.includes('name="twitter:card" content="summary_large_image"') && home.includes('name="theme-color"'), "pages carry a share image and theme colours");
  const blocks = [...home.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((x) => JSON.parse(x[1]));
  must(blocks.length === 1 && blocks[0]["@graph"].some((n) => n["@type"] === "WebSite") && blocks[0]["@graph"].some((n) => n["@type"] === "Organization"), "the home page describes the site and its organisation in structured data");
  const kitLd = [...evil.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)];
  must(kitLd.length === 1 && JSON.parse(kitLd[0][1])["@type"] === "SoftwareApplication", "a kit page describes the kit in structured data");
  must(!evil.includes('"description":"<') && !kitLd[0][1].includes("</script") && kitLd[0][1].includes("\\" + "u003cscript>alert(1)"), "hostile text cannot end the structured-data block");
  must(readFileSync(join(out, "about", "index.html"), "utf8").includes("About Praxikit") && readFileSync(join(out, "index.html"), "utf8").includes('about/"'), "there is an About page, linked from the footer");
}

// a non-https listing url must be refused
put("site/listings.json", JSON.stringify([{ name: "x", url: "javascript:alert(1)", author: "a", why: "w", kind: "skill", source: "community", added: "2026-11-14", commit: SHA, checks: "no-flags-found" }]));
let refused = false;
try { execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "pipe" }); } catch { refused = true; }
must(refused, "javascript: url was accepted");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: site escapes hostile input, links are relative, external links are noopener, javascript: urls refused");
