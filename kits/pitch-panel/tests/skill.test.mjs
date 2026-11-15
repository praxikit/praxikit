#!/usr/bin/env node
// Checks the pitch-panel skill keeps its promises. No dependencies.
// Run from the repo root: node kits/pitch-panel/tests/skill.test.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const kit = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };

const skill = readFileSync(join(kit, "plugin", "skills", "grill", "SKILL.md"), "utf8");
const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1] ?? "";
must(/^name:\s*grill\s*$/m.test(fm), "frontmatter name is grill");
must(/^description:\s*.{40,}/m.test(fm) && /Use when/.test(fm), "description says what it does and when to use it");

for (const seat of ["Customer", "Money", "Build", "Reach", "Operations"]) must(skill.includes(`| ${seat} |`), `seat ${seat} is defined`);
for (const part of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]) must(skill.includes(part), `${part} present`);
must(/Never invent facts/.test(skill) && /assumption/.test(skill), "the no-invented-facts rule is present");
must(/You are not an investor/.test(skill) && /not a prediction/.test(skill), "it says it is not an investor and not a prediction");
must(/exactly one test/i.test(skill) && /pass bar/i.test(skill) && /Never "build the MVP"/.test(skill), "the verdict ends in one cheap test with a pass bar stated in advance");
must(/Go if/.test(skill) && /\*\*Stop\*\*/.test(skill), "verdict values are defined");

// the manifest says it has no scripts, hooks or network code: prove it
must(!existsSync(join(kit, "plugin", "scripts")) && !existsSync(join(kit, "plugin", "hooks")), "no scripts or hooks directory");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const code = walk(join(kit, "plugin")).filter((f) => /\.(mjs|js|cjs|sh|ps1|py)$/.test(f));
must(code.length === 0, `the plugin ships no code files, found: ${code.join(", ")}`);

// no copied text from elsewhere: the licence-less reference skill must not leak in
must(!/shark\s*tank/i.test(skill) && !/shark\s*tank/i.test(readFileSync(join(kit, "kit.json"), "utf8")), "the skill does not use a third-party brand name");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: pitch-panel skill defines five seats, the no-invention and not-an-investor rules, a single cheap test, and ships no code");
