#!/usr/bin/env node
// Tests the done-check Stop hook and the /keel:status script. No dependencies.
// Run from the repo root: node kits/keel/tests/status.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");
const dir = mkdtempSync(join(tmpdir(), "keel-status-"));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const run = (script, payload, args = []) => spawnSync("node", [join(plugin, "scripts", script), ...args], { input: JSON.stringify(payload), encoding: "utf8" });

const user = (t) => ({ type: "user", timestamp: t, message: { content: "do it" } });
const tool = (id, name, input) => ({ type: "assistant", timestamp: "2026-11-15T10:00:05.000Z", uuid: id, message: { id, model: "claude-sonnet-5-5", content: [{ type: "tool_use", name, input }], usage: { input_tokens: 1, output_tokens: 1 } } });
const transcript = (name, rows) => { const f = join(dir, name + ".jsonl"); writeFileSync(f, jl(rows)); return f; };
const proj = join(dir, "proj"); mkdirSync(join(proj, ".keel"), { recursive: true });
const say = (f) => run("done-check.mjs", { transcript_path: f, cwd: proj }).stdout;

// ---- done-check
must(say(transcript("a", [user("2026-11-15T10:00:00.000Z"), tool("1", "Edit", { file_path: "src/a.js" })])).includes("1 file changed"), "an edit with no later check warns");
must(say(transcript("b", [user("2026-11-15T10:00:00.000Z"), tool("1", "Edit", { file_path: "src/a.js" }), tool("2", "Bash", { command: "npm test" })])) === "", "a test run after the edit is silent");
must(say(transcript("c", [user("2026-11-15T10:00:00.000Z"), tool("1", "Bash", { command: "npm test" }), tool("2", "Edit", { file_path: "src/a.js" })])).includes("changed"), "a check BEFORE the last edit does not count");
must(say(transcript("d", [user("2026-11-15T10:00:00.000Z"), tool("1", "Edit", { file_path: "src/a.js" }), tool("2", "Bash", { command: "git status" })])).includes("changed"), "git status is not a check");
must(say(transcript("e", [user("2026-11-15T10:00:00.000Z"), tool("1", "Write", { file_path: "README.md" })])) === "", "docs-only edits are silent");
must(say(transcript("f", [user("2026-11-15T10:00:00.000Z"), tool("1", "Read", { file_path: "x" })])) === "", "no edits is silent");
must(say(transcript("g", [user("2026-11-15T09:00:00.000Z"), tool("1", "Edit", { file_path: "src/a.js" }), user("2026-11-15T10:00:00.000Z")])) === "", "edits from an earlier prompt are not blamed on this one");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ defaults: { doneCheck: false } }));
must(say(join(dir, "a.jsonl")) === "", "doneCheck:false silences it");
writeFileSync(join(proj, ".keel", "config.json"), "{}");
let r = spawnSync("node", [join(plugin, "scripts", "done-check.mjs")], { input: "garbage", encoding: "utf8" });
must(r.status === 0 && r.stdout === "", "garbage stdin is silent");
r = run("done-check.mjs", { transcript_path: join(dir, "stop.jsonl"), cwd: proj, stop_hook_active: true });
must(r.status === 0 && r.stdout === "", "missing transcript is silent");

// ---- status
const noPlan = spawnSync("node", [join(plugin, "scripts", "status.mjs"), "--project", proj, "--transcript", join(dir, "nope")], { encoding: "utf8" });
must(noPlan.status === 0 && noPlan.stdout.includes("/keel:plan"), "no plan points at /keel:plan");
mkdirSync(join(proj, "docs", "plan"), { recursive: true });
writeFileSync(join(proj, "docs", "plan", "03-phases.md"), `# Phases\n\n## Phase 0 — MVP ✅ 2026-11-01\n\n**Goal:** a\n\n## Phase 1 — Core 🟨\n\n**Goal:** ship the core\n\n**Files:**\n- \`src/\`\n\n**Checks:**\n- \`npm test\` → green\n- login works\n\n**Security:**\n\n## Phase 2 — Polish ⬜\n\n**Goal:** b\n`);
const st = spawnSync("node", [join(plugin, "scripts", "status.mjs"), "--project", proj, "--transcript", transcript("s", [user("2026-11-15T10:00:00.000Z"), tool("1", "Read", {})])], { encoding: "utf8" }).stdout;
must(st.includes("[x] Phase 0") && st.includes("[>] Phase 1") && st.includes("[ ] Phase 2"), "phases show done, in progress, next");
must(st.includes("Now: Phase 1 — Core") && st.includes("ship the core") && st.includes("npm test") && st.includes("login works"), "current phase shows goal and checks");
must(st.includes("Cost this session"), "status includes cost");

rmSync(dir, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: done-check warns only when a non-doc edit has no later check, honours the switch; status shows phases, checks and cost");
