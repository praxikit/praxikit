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

// six seats, each with a lens and a stop signal
for (const seat of ["CTO", "CMO", "COO", "PM", "CFO", "Devil's advocate"]) must(skill.includes(`| **${seat}**`), `seat ${seat} is defined in the table`);
for (const part of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6", "Step 7"]) must(skill.includes(`## ${part}`), `${part} present`);

// the topics the panel promises to cover are all named, and uncovered ones must be reported
for (const topic of ["demand", "product", "competition", "market and growth", "business model", "financials", "technology", "operations and legal", "catastrophic risk"]) must(skill.toLowerCase().includes(topic), `topic ${topic} is named`);
must(/not covered/.test(skill), "a topic with no owner must be reported as not covered");
must(/disintermediation/i.test(skill) && /bottom-up/i.test(skill) && /churn/i.test(skill) && /CAC/.test(skill), "operations, market-size and money checks are specific");

// the devil's advocate must see the others and add something new
must(/speaks last/i.test(skill) && /reads the other five/i.test(skill) && /none of the other five raised/i.test(skill), "the devil's advocate speaks last, reads the others, and names what they missed");
must(/trigger/i.test(skill) && /warning sign/i.test(skill) && /cheapest hedge/i.test(skill), "the devil's advocate gives trigger, warning sign and hedge");

// honesty
must(/Never invent facts/.test(skill) && /\[assumption\]/.test(skill) && /\[you\]/.test(skill) && /\[source:/.test(skill), "the tagging rule is present");
must(/You are not an investor/.test(skill) && /not a prediction/.test(skill), "it says it is not an investor and not a prediction");
must(/Assumption ledger/.test(skill) && /Kill triggers/.test(skill) && /assumed without saying/.test(skill), "ledger, kill triggers and hidden assumptions are required");
must(/exactly one test/i.test(skill) && /pass bar/i.test(skill) && /Never "build the MVP"/.test(skill), "the verdict ends in one cheap test with a pass bar stated in advance");
must(/Go if/.test(skill) && /\*\*Stop\*\*/.test(skill) && /does not decide the verdict/.test(skill), "verdict values are defined and the score does not decide them");

// the score arithmetic must match who scores: five seats score, so the total is out of 25
must(/out of 25/.test(skill) && /n\/25/.test(skill) && !/\/30|out of 30/.test(skill) && !/\/30/.test(readFileSync(join(kit, "kit.json"), "utf8")), "the score total is out of 25 everywhere");
must(/devil's advocate does not vote/.test(skill) && /at least four of the five voting seats/.test(skill), "Go is decided by the five voting seats, not six");

// cost honesty: one pass by default, deep mode only when asked
must(/Default: one pass/.test(skill) && /many times more tokens/.test(skill), "single pass is the default and deep mode's cost is stated");

// the manifest says it has no scripts, hooks or network code: prove it
must(!existsSync(join(kit, "plugin", "scripts")) && !existsSync(join(kit, "plugin", "hooks")), "no scripts or hooks directory");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const code = walk(join(kit, "plugin")).filter((f) => /\.(mjs|js|cjs|sh|ps1|py)$/.test(f));
must(code.length === 0, `the plugin ships no code files, found: ${code.join(", ")}`);

// no third-party brand name, in the skill or the manifest
must(!/shark\s*tank/i.test(skill) && !/shark\s*tank/i.test(readFileSync(join(kit, "kit.json"), "utf8")), "no third-party brand name");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: pitch-panel defines six seats, covers every promised topic, makes the devil's advocate read the others, tags every claim, and ends in one cheap test");
