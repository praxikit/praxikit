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
put("site/drift.json", JSON.stringify({ "https://github.com/o/rec": "changed", "https://github.com/o/comm": "unreachable", "https://github.com/o/ignored": "bogus", "https://evil.example/x": "changed" }));
put("site/listings.json", JSON.stringify([
  { name: XSS, url: "https://github.com/o/rec", author: XSS, why: XSS, kind: "mcp", source: "recommended", added: "2026-11-14", commit: SHA, checks: "no-flags-found", pick: true, note: XSS },
  { name: "Community " + XSS, url: "https://github.com/o/comm", author: "someone", why: XSS, kind: "skill", source: "community", added: "2026-11-14", commit: SHA, checks: "checks-flagged", issue: 5 },
]));

execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "inherit" });

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const htmlFiles = walk(out).filter((f) => f.endsWith(".html"));

must(htmlFiles.length === 25, `expected the 23 earlier pages plus a page for each of the 2 listings = 25 html files, got ${htmlFiles.length}`);
for (const f of htmlFiles) {
  const h = readFileSync(f, "utf8");
  // drop only our own inline scripts (marked data-site); any other <script> is a failure
  const stripped = h.replace(/<script src="[^"]*"(?: defer)? data-site><\/script>/g, "").replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, "");
  must(!/<script/i.test(stripped), `unexpected <script> in ${f}`);
  must(!/<img src=x/.test(h), `raw <img> payload in ${f}`);
  const noValues = stripped.replace(/="[^"]*"/g, '=""'); // attribute values are inert text; look at attribute names only
  must(!/<[a-z][^>]*\son(error|load|click)=/i.test(noValues), `inline event handler in ${f}`);
  must(h.includes("Praxikit"), `brand name missing in ${f}`);
  must(!/data-checker="[^"]*[<>]/.test(h), `unescaped markup inside data-checker in ${f}`);
}
const idx = readFileSync(join(out, "index.html"), "utf8");
must(idx.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "payload not shown escaped on index");
must(idx.includes('href="./l/o-rec/"') && /<a class="icon-act" href="https:\/\/github\.com\/o\/rec" rel="noopener noreferrer"/.test(idx), "a pick on the home page links to its own page, and a repository icon opens GitHub safely");
must(!idx.includes('class="details"') && !idx.includes(">Details<") && !idx.includes("View details"), "cards have no action row: the whole card opens its page");
const skillsPage = readFileSync(join(out, "kits/skills/index.html"), "utf8");
const commHtml = readFileSync(join(out, "l/o-comm/index.html"), "utf8"), recHtml = readFileSync(join(out, "l/o-rec/index.html"), "utf8");
must(skillsPage.includes('href="../../l/o-comm/"') && skillsPage.includes("Listed") && !skillsPage.includes(`class="kind pick"`) && skillsPage.includes("by someone"), "a community listing shows on its type page as a listed kit, linking to its own page");
must(/href="https:\/\/github\.com\/o\/comm" rel="noopener noreferrer"/.test(commHtml) && commHtml.includes("Submitted by its author") && commHtml.includes("not built by Praxikit") && commHtml.includes("<code>aaaaaaa</code>") && commHtml.includes("Review receipt"), "its page links to GitHub safely and carries the review receipt with the reviewed commit");
const mcpPage = readFileSync(join(out, "kits/mcp/index.html"), "utf8");
must(mcpPage.includes("My pick") && mcpPage.includes("How I use it") && mcpPage.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !mcpPage.includes("<img src=x") && mcpPage.includes("l/o-rec/") && !mcpPage.includes("No MCP configs yet"), "a pick counts as an MCP config, and is marked as a pick");
must(idx.includes("Changed since review") && recHtml.includes('href="https://github.com/o/rec/compare/' + SHA + '...HEAD"'), "a listing whose repository moved on says so, and its page links to the comparison");
must(skillsPage.includes("Repository not reachable") && !skillsPage.includes("Changed since review"), "an unreachable listing says so, and a 'same' or unknown status adds nothing");
const picksHtml = readFileSync(join(out, "picks/index.html"), "utf8");
must(picksHtml.includes("l/o-rec/") && !picksHtml.includes("l/o-comm/") && picksHtml.includes("My pick") && picksHtml.includes("How I use it"), "the Picks page shows picks only, with the owner's note");
must(!idx.includes(">Recommended<") && idx.includes(">Picks<") && idx.includes("My picks"), "the word Recommended is gone from the navigation and the home page");
must(!/href="https:\/\/github\.com[^"]*"(?![^>]*rel=)/.test(idx), "external GitHub link without rel");
must(existsSync(join(out, "k/evil/index.html")) && existsSync(join(out, "c/planning/index.html")) && existsSync(join(out, "c/design-and-3d/index.html")), "kit or collection pages missing");
must(!/href="\//.test(idx), "absolute href found; links must be relative");
must(/data-text="[^"]*&lt;script&gt;/.test(idx) || !/data-text="[^"]*<script/.test(idx), "search data attribute not escaped");
must(existsSync(join(out, "404.html")), "404.html missing");
const feed = readFileSync(join(out, "feed.xml"), "utf8");
must(feed.startsWith("<?xml") && feed.includes("<entry>") && !feed.includes("<script>alert") && !feed.includes("<img src=x") && feed.includes("&lt;script&gt;"), "feed.xml missing, not escaped, or empty");
must(idx.includes('rel="alternate" type="application/atom+xml"'), "feed link missing from the page head");
const upd = readFileSync(join(out, "updates/index.html"), "utf8");
must(upd.includes("data-ck-paste") && upd.includes("claude plugin list") && /data-checker="[^"]*1\.2\.3/.test(upd), "paste-to-detect checker missing from the Updates page");
const sub = readFileSync(join(out, "submit/index.html"), "utf8");
must(!sub.includes("template=suggest-kit.yml") && !sub.includes("template=recommend.yml"), "submitting is the form on the site; the old issue forms are gone");
// routes: the home page shows a few kits and links on to pages instead of holding everything
must(idx.includes('href="kits/"') && idx.includes('href="kits/plugins/"') && idx.includes('href="kits/skills/"') && idx.includes('href="kits/mcp/"') && idx.includes('href="kits/other/"'), "home must link to the kits page and each type page");
must(idx.includes('href="updates/"') && idx.includes('href="picks/"') && idx.includes('href="submit/"') && idx.includes("<body data-home data-root=\"./\" data-app=\"\">"), "home must link to updates, picks and submit");
must((idx.match(/<li class="card[ "]/g) ?? []).length <= 3 + 3, "home should show at most three kits (and three picks)");
const pol = readFileSync(join(out, "policy/index.html"), "utf8");
must(pol.includes("security/advisories/new") && pol.includes("template=report-listing.yml") && pol.includes("docs/removals.md") && pol.includes("not a safety guarantee") && pol.includes("one maintainer"), "policy page needs the private channel, the report form, the removal log and honest limits");
must(pol.includes("The reviewed commit is not what you install"), "the policy must say that installs follow the author's latest version, not the reviewed commit");
must(skillsPage.includes("Installs follow the author&#39;s latest version") && commHtml.includes("Installs follow the author's latest version"), "every outside listing says installs can differ from the reviewed commit, on the card and on its page");
must(!/href="\//.test(pol) && idx.includes('href="./policy/"') && sub.includes('href="../policy/"'), "policy is linked from the footer and the submit page, with relative links");
const kitsAll = readFileSync(join(out, "kits/index.html"), "utf8");
must(kitsAll.includes('id="q"') && kitsAll.includes('aria-current="page"') && kitsAll.includes('class="typenav"'), "kits page needs search (4+ kits) and the type navigation");
const plug = readFileSync(join(out, "kits/plugins/index.html"), "utf8"), skl = readFileSync(join(out, "kits/skills/index.html"), "utf8"), mcp = readFileSync(join(out, "kits/other/index.html"), "utf8");
must(plug.includes('href="../../k/a/"') && !plug.includes('href="../../k/evil/"'), "plugins page lists plugin kits only");
must(skl.includes('href="../../k/evil/"') && !skl.includes('href="../../k/a/"'), "skills page lists skill kits only");
must(mcp.includes("No templates, adapters, agents or hooks yet") && mcp.includes("../../submit/"), "an empty type page says so and points to submit");
for (const f of [kitsAll, plug, mcp, upd, sub, picksHtml]) must(!/href="\//.test(f), "absolute href on a route page");
const kp = readFileSync(join(out, "k/evil/index.html"), "utf8");
must(kp.includes('role="tablist"') && kp.includes('role="tabpanel"'), "install tabs missing on a kit with installBy");
must(kp.includes("What you'll see") && kp.includes("What it does on your machine"), "preview or access sections missing");
must(kp.includes("<code>x.mjs</code>") && kp.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "hooks list or escaped matcher missing");
must(/data-checker="[^"]*1\.2\.3/.test(kp), "update checker data missing for the evil kit");
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
must(readFileSync(join(root2, "out", "kits", "index.html"), "utf8").includes('class="name"') && !readFileSync(join(root2, "out", "kits", "index.html"), "utf8").includes('id="q"'), "with one kit the kits page shows a card and no search");

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
  must(kitsHtml.includes('data-app="https://app.example.dev"') && kitsHtml.includes('id="acct"') && kitsHtml.includes('href="https://app.example.dev/auth/login?mode=user"'), "the header has a sign-in link to the app and the account slot the script fills");
  must(!kitsHtml.split('href="https://app.example.dev').slice(1).some((x) => /^[^"]*[<>' ]/.test(x)), "no app link contains markup");
  put("site/config.json", JSON.stringify({ app: "javascript:alert(1)" }));
  const out4 = join(root, "out4");
  execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out4], { stdio: "pipe" });
  must(!readFileSync(join(out4, "kits", "index.html"), "utf8").includes("collection/save") && !readFileSync(join(out4, "kits", "index.html"), "utf8").includes("javascript:alert(1)\""), "an app address that is not an https origin is ignored");
  void keep;
}

// share card, structured data and the about page
{
  const home = readFileSync(join(out, "index.html"), "utf8"), evil = readFileSync(join(out, "k", "evil", "index.html"), "utf8");
  const png = readFileSync(join(out, "og.png"));
  must(png.subarray(1, 4).toString() === "PNG" && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, "the share image is a 1200x630 PNG");
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
