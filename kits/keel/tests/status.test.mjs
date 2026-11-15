#!/usr/bin/env node
// Tests the done-check Stop hook and the /keel:status script. No dependencies.
// Run from the repo root: node kits/keel/tests/status.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
const pv = JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).version;
must(st.includes(`https://praxikit.github.io/praxikit/?kit=keel&v=${pv}#updates`), "status prints a link that pre-fills the update checker with the installed version");
must(noPlan.stdout.includes(`v=${pv}`), "the update link is also printed when there is no plan");

// ---- phase cost ledger (fake home so no real transcripts are read)
const home = join(dir, "home"), work = join(dir, "work");
mkdirSync(work, { recursive: true });
const pdir = join(home, ".claude", "projects", work.replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(pdir, { recursive: true });
const asst = (id, out) => ({ type: "assistant", timestamp: "2026-11-15T10:00:05.000Z", uuid: id, message: { id, model: "claude-sonnet-5-5", usage: { input_tokens: 0, output_tokens: out } } });
writeFileSync(join(pdir, "s1.jsonl"), jl([user("2026-11-15T10:00:00.000Z"), asst("a", 1000000)])); // 1M out sonnet = $10
const pc = () => spawnSync("node", [join(plugin, "scripts", "phase-cost.mjs"), "Phase 1", "--project", work], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } }).stdout;
let o = pc();
must(o.includes("$10.00") && o.includes("since tracking began"), `first mark covers all history: ${o}`);
writeFileSync(join(pdir, "s2.jsonl"), jl([user("2026-11-15T11:00:00.000Z"), asst("b", 500000)])); // +$5
o = pc();
must(o.includes("$5.00") && o.includes('since "Phase 1"'), `second mark is the difference: ${o}`);
const dry = spawnSync("node", [join(plugin, "scripts", "phase-cost.mjs"), "Phase 2", "--project", work, "--dry-run"], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } }).stdout;
must(dry.includes("$0.0000") || dry.includes("$0.00"), `dry-run shows zero since last mark: ${dry}`);
must(JSON.parse(readFileSync(join(work, ".keel", "ledger.json"), "utf8")).marks.length === 2, "dry-run writes nothing");

// ---- the kit page says the scripts make no network calls; prove it
import { readdirSync, statSync } from "node:fs";
const walkJs = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walkJs(p) : /\.(mjs|js)$/.test(n) ? [p] : []; });
for (const f of walkJs(join(plugin, "scripts"))) {
  const src = readFileSync(f, "utf8");
  must(!/\bfetch\s*\(|node:https?|node:net|node:dgram|node:child_process|XMLHttpRequest|WebSocket/.test(src), `network or process code in ${f}; the kit page claims none`);
}

rmSync(dir, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: done-check warns only when a non-doc edit has no later check, honours the switch; status shows phases, checks and cost");
