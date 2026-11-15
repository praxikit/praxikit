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
put("site/listings.json", JSON.stringify([
  { name: XSS, url: "https://github.com/o/rec", author: XSS, why: XSS, kind: "mcp", source: "recommended", added: "2026-11-14", commit: SHA, checks: "no-flags-found" },
  { name: "Community " + XSS, url: "https://github.com/o/comm", author: "someone", why: XSS, kind: "skill", source: "community", added: "2026-11-14", commit: SHA, checks: "checks-flagged", issue: 5 },
]));

execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "inherit" });

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const htmlFiles = walk(out).filter((f) => f.endsWith(".html"));

must(htmlFiles.length === 16, `expected home, 404, kits, 4 type pages, updates, recommended, submit, 2 collections, 4 kit pages = 16 html files, got ${htmlFiles.length}`);
for (const f of htmlFiles) {
  const h = readFileSync(f, "utf8");
  // drop only our own inline scripts (marked data-site); any other <script> is a failure
  const stripped = h.replace(/<script data-site>[\s\S]*?<\/script>/g, "");
  must(!/<script/i.test(stripped), `unexpected <script> in ${f}`);
  must(!/<img src=x/.test(h), `raw <img> payload in ${f}`);
  const noValues = stripped.replace(/="[^"]*"/g, '=""'); // attribute values are inert text; look at attribute names only
  must(!/<[a-z][^>]*\son(error|load|click)=/i.test(noValues), `inline event handler in ${f}`);
  must(h.includes("Praxikit"), `brand name missing in ${f}`);
  must(!/data-checker="[^"]*[<>]/.test(h), `unescaped markup inside data-checker in ${f}`);
}
const idx = readFileSync(join(out, "index.html"), "utf8");
must(idx.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "payload not shown escaped on index");
must(/href="https:\/\/github\.com\/o\/rec" rel="noopener noreferrer"/.test(idx), "recommended link missing rel=noopener noreferrer");
const skillsPage = readFileSync(join(out, "kits/skills/index.html"), "utf8");
must(/href="https:\/\/github\.com\/o\/comm" rel="noopener noreferrer"/.test(skillsPage) && skillsPage.includes("Community") && skillsPage.includes("not built by Praxikit") && skillsPage.includes("Reviewed at <code>aaaaaaa</code>"), "a community listing shows on its type page as someone else's work, with the reviewed commit");
const mcpPage = readFileSync(join(out, "kits/mcp/index.html"), "utf8");
must(mcpPage.includes("o/rec") && !mcpPage.includes("No MCP configs yet"), "a recommended listing counts as an MCP config");
must(readFileSync(join(out, "recommended/index.html"), "utf8").includes("o/rec") && !readFileSync(join(out, "recommended/index.html"), "utf8").includes("o/comm"), "the Recommended page shows recommended listings only");
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
must(sub.includes("template=suggest-kit.yml") && sub.includes("template=recommend.yml"), "submit page should open the issue forms");
// routes: the home page shows a few kits and links on to pages instead of holding everything
must(idx.includes('href="kits/"') && idx.includes('href="kits/plugins/"') && idx.includes('href="kits/skills/"') && idx.includes('href="kits/mcp/"') && idx.includes('href="kits/other/"'), "home must link to the kits page and each type page");
must(idx.includes('href="updates/"') && idx.includes('href="recommended/"') && idx.includes('href="submit/"') && idx.includes("<body data-home>"), "home must link to updates, recommended and submit");
must((idx.match(/<li class="card[ "]/g) ?? []).length <= 3 + 3, "home should show at most three kits (and three recommendations)");
const kitsAll = readFileSync(join(out, "kits/index.html"), "utf8");
must(kitsAll.includes('id="q"') && kitsAll.includes('aria-current="page"') && kitsAll.includes('class="typenav"'), "kits page needs search (4+ kits) and the type navigation");
const plug = readFileSync(join(out, "kits/plugins/index.html"), "utf8"), skl = readFileSync(join(out, "kits/skills/index.html"), "utf8"), mcp = readFileSync(join(out, "kits/other/index.html"), "utf8");
must(plug.includes('href="../../k/a/"') && !plug.includes('href="../../k/evil/"'), "plugins page lists plugin kits only");
must(skl.includes('href="../../k/evil/"') && !skl.includes('href="../../k/a/"'), "skills page lists skill kits only");
must(mcp.includes("No templates, adapters, agents or hooks yet") && mcp.includes("../../submit/"), "an empty type page says so and points to submit");
for (const f of [kitsAll, plug, mcp, upd, sub, readFileSync(join(out, "recommended/index.html"), "utf8")]) must(!/href="\//.test(f), "absolute href on a route page");
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
must(readFileSync(join(root2, "out", "kits", "index.html"), "utf8").includes("View details") && !readFileSync(join(root2, "out", "kits", "index.html"), "utf8").includes('id="q"'), "with one kit the kits page shows a card with View details and no search");

// a non-https recommended url must be refused
put("site/listings.json", JSON.stringify([{ name: "x", url: "javascript:alert(1)", author: "a", why: "w", kind: "skill", source: "community", added: "2026-11-14", commit: SHA, checks: "no-flags-found" }]));
let refused = false;
try { execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "pipe" }); } catch { refused = true; }
must(refused, "javascript: url was accepted");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: site escapes hostile input, links are relative, external links are noopener, javascript: urls refused");
