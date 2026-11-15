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
put("site/recommended.json", JSON.stringify([{ name: XSS, url: "https://example.com/?a=1&b=2", author: XSS, why: XSS, category: "Skill", added: "2026-11-14" }]));

execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "inherit" });

const failures = [];
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const htmlFiles = walk(out).filter((f) => f.endsWith(".html"));

must(htmlFiles.length === 8, `expected index + 404 + 2 collections + 4 kit pages = 8 html files, got ${htmlFiles.length}`);
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
must(/href="https:\/\/example\.com\/\?a=1&amp;b=2" rel="noopener noreferrer"/.test(idx), "recommended link missing rel=noopener noreferrer or unescaped &");
must(!/href="https:\/\/github\.com[^"]*"(?![^>]*rel=)/.test(idx), "external GitHub link without rel");
must(existsSync(join(out, "k/evil/index.html")) && existsSync(join(out, "c/planning/index.html")) && existsSync(join(out, "c/design-and-3d/index.html")), "kit or collection pages missing");
must(!/href="\//.test(idx), "absolute href found; links must be relative");
must(/data-text="[^"]*&lt;script&gt;/.test(idx) || !/data-text="[^"]*<script/.test(idx), "search data attribute not escaped");
must(existsSync(join(out, "404.html")), "404.html missing");
const kp = readFileSync(join(out, "k/evil/index.html"), "utf8");
must(kp.includes('role="tablist"') && kp.includes('role="tabpanel"'), "install tabs missing on a kit with installBy");
must(kp.includes("What you'll see") && kp.includes("What it does on your machine"), "preview or access sections missing");
must(kp.includes("<code>x.mjs</code>") && kp.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "hooks list or escaped matcher missing");
must(/data-checker="[^"]*1\.2\.3/.test(kp), "update checker data missing for the evil kit");
const versions = JSON.parse(readFileSync(join(out, "versions.json"), "utf8"));
must(versions.evil?.version === "1.2.3", "versions.json does not match manifests");

// few kits: the wide-card layout (no search toolbar) is built and escaped too
const root2 = mkdtempSync(join(tmpdir(), "praxikit-site2-"));
mkdirSync(join(root2, "kits", "evil"), { recursive: true });
writeFileSync(join(root2, "kits", "evil", "kit.json"), JSON.stringify({ name: "evil", kind: "skill", collections: ["Planning"], tags: [XSS], version: "1.2.3", promise: XSS, install: ["/plugin marketplace add x", XSS], limits: ["l"] }));
execFileSync("node", [join(here, "build.mjs"), "--root", root2, "--out", join(root2, "out")], { stdio: "pipe" });
const few = readFileSync(join(root2, "out", "index.html"), "utf8");
must(few.includes("feature") && !few.includes('id="q"'), "few kits should use the wide card and no search box");
must(!/<img src=x/.test(few) && few.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "wide card is not escaped");
must(readFileSync(join(out, "index.html"), "utf8").includes('id="q"'), "four or more kits should show search");

// a non-https recommended url must be refused
put("site/recommended.json", JSON.stringify([{ name: "x", url: "javascript:alert(1)", author: "a", why: "w", category: "Skill", added: "2026-11-14" }]));
let refused = false;
try { execFileSync("node", [join(here, "build.mjs"), "--root", root, "--out", out], { stdio: "pipe" }); } catch { refused = true; }
must(refused, "javascript: url was accepted");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: site escapes hostile input, links are relative, external links are noopener, javascript: urls refused");
