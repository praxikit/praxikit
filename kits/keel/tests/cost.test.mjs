#!/usr/bin/env node
// Tests the usage/cost code, the Stop footer hook and the SessionStart hook against synthetic
// transcripts. No dependencies. Run from the repo root: node kits/keel/tests/cost.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { summarize, totals, footer, loadPrices } from "../plugin/scripts/lib/usage.mjs";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");
const dir = mkdtempSync(join(tmpdir(), "keel-cost-"));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

const asst = (id, model, ts, u) => ({ type: "assistant", timestamp: ts, uuid: id + ts, message: { id, model, usage: u } });
const usage = (i, cr, cw1, o) => ({ input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cw1, cache_creation: { ephemeral_1h_input_tokens: cw1, ephemeral_5m_input_tokens: 0 }, output_tokens: o });

const sid = "abc";
const main = join(dir, sid + ".jsonl");
writeFileSync(main, jl([
  { type: "user", timestamp: "2026-11-15T10:00:00.000Z", message: { content: "first prompt" } },
  asst("m1", "claude-sonnet-5-5", "2026-11-15T10:00:01.000Z", usage(10, 1000, 0, 100)),
  { type: "user", timestamp: "2026-11-15T10:01:00.000Z", message: { content: "second prompt" } },
  asst("m2", "claude-sonnet-5-5", "2026-11-15T10:01:01.000Z", usage(1000000, 0, 0, 0)),          // 1M in -> $2.00
  asst("m2", "claude-sonnet-5-5", "2026-11-15T10:01:01.500Z", usage(1000000, 0, 0, 0)),          // duplicate block of m2
  { type: "user", timestamp: "2026-11-15T10:01:02.000Z", message: { content: [{ type: "tool_result", content: "x" }] } }, // not a prompt
  asst("m3", "claude-opus-5-5", "2026-11-15T10:01:03.000Z", usage(0, 0, 0, 1000000)),            // 1M out -> $20.00
  asst("m4", "claude-haiku-5-5", "2026-11-15T10:01:04.000Z", usage(50000, 0, 0, 0)),             // short tier $0.10/M -> $0.005
  asst("m5", "claude-haiku-5-5", "2026-11-15T10:01:05.000Z", usage(200000, 0, 0, 0)),            // long tier $0.50/M -> $0.10
  asst("m6", "claude-mystery-9", "2026-11-15T10:01:06.000Z", usage(5, 0, 0, 5)),                 // no price
  asst("s0", "<synthetic>", "2026-11-15T10:01:07.000Z", usage(9, 9, 9, 9)),                      // ignored
]));
mkdirSync(join(dir, sid, "subagents"), { recursive: true });
writeFileSync(join(dir, sid, "subagents", "agent-1.jsonl"), jl([
  asst("sa1", "claude-haiku-5-5", "2026-11-15T10:01:30.000Z", usage(0, 0, 0, 1000000)),         // 1M out short tier -> $0.50
  asst("sa0", "claude-haiku-5-5", "2026-11-15T10:00:30.000Z", usage(0, 0, 0, 1000000)),         // before the last prompt: session only
]));

const prices = loadPrices(plugin, null);
const sum = summarize(main, prices);

must(sum.prompt["claude-sonnet-5-5"]?.calls === 1, "duplicate message blocks must count once; only the last prompt's messages count");
must(near(sum.prompt["claude-sonnet-5-5"].cost, 2.0), `sonnet cost expected 2.00, got ${sum.prompt["claude-sonnet-5-5"]?.cost}`);
must(near(sum.prompt["claude-opus-5-5"].cost, 20.0), "opus cost expected 20.00");
must(near(sum.prompt["claude-haiku-5-5"].cost, 0.005 + 0.10 + 0.50), `haiku: short tier, long tier and sub-agent expected 0.605, got ${sum.prompt["claude-haiku-5-5"].cost}`);
must(sum.prompt["claude-mystery-9"]?.unpriced === true, "a model with no price is flagged, not guessed");
must(!sum.prompt["<synthetic>"], "synthetic messages are ignored");
must(sum.session["claude-haiku-5-5"].calls === 4, "session includes the earlier sub-agent message");
must(sum.session["claude-sonnet-5-5"].calls === 2, "session counts both prompts' sonnet messages once each");
const t = totals(sum.prompt);
must(t.unpriced === true && near(t.cost, 2 + 20 + 0.605), "totals sum priced models and carry the unpriced flag");
const line = footer(sum);
must(/^Keel · ≥\$/.test(line) && line.includes("est.") && !line.includes("\n") && line.length < 170, "footer is one short line and says ≥ when a model is unpriced");

must(!footer(sum, { prompt: 100, session: 100 }).includes("OVER"), "under the caps there is no warning");
must(footer(sum, { prompt: 1 }).includes("OVER prompt cap $1.00") && !footer(sum, { prompt: 1 }).includes("session cap"), "a passed prompt cap is named");
must(footer(sum, { prompt: 1, session: 1 }).includes("OVER prompt cap $1.00 and session cap $1.00"), "both caps can be named");
must(!footer(sum).includes("OVER") && !footer(sum, { prompt: null, session: 0 }).includes("OVER"), "no cap means no warning");

// ---- Stop hook end to end, and the off switch
const run = (script, payload) => spawnSync("node", [join(plugin, "scripts", script)], { input: JSON.stringify(payload), encoding: "utf8" });
const proj = join(dir, "proj"); mkdirSync(join(proj, ".keel"), { recursive: true });
let r = run("footer.mjs", { transcript_path: main, cwd: proj });
must(r.status === 0 && JSON.parse(r.stdout).systemMessage.startsWith("Keel ·"), "footer hook prints a systemMessage");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ defaults: { costFooter: false } }));
r = run("footer.mjs", { transcript_path: main, cwd: proj });
must(r.status === 0 && r.stdout === "", "costFooter:false silences the footer");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ prices: { "claude-mystery-9": { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 } } }));
r = run("footer.mjs", { transcript_path: main, cwd: proj });
must(r.stdout.includes("≈$") && !r.stdout.includes("≥"), "a project price override prices the unknown model");
r = spawnSync("node", [join(plugin, "scripts", "footer.mjs")], { input: "garbage", encoding: "utf8" });
must(r.status === 0 && r.stdout === "", "garbage stdin is silent");
r = run("footer.mjs", { transcript_path: join(dir, "missing.jsonl"), cwd: proj });
must(r.status === 0 && r.stdout === "", "missing transcript is silent");

// ---- SessionStart hook
const ctx = (cwd) => { const o = run("session-start.mjs", { cwd }).stdout; return o ? JSON.parse(o).hookSpecificOutput.additionalContext : ""; };
writeFileSync(join(proj, ".keel", "config.json"), "{}");
let c = ctx(proj);
must(c.includes("### For you") && c.includes("### Task list") && c.includes("[x]") && !c.includes("✅"), "defaults inject both sections with ascii marks");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ defaults: { taskList: false } }));
c = ctx(proj);
must(c.includes("### For you") && !c.includes("### Task list"), "taskList:false removes only the task list rule");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ defaults: { marks: "emoji" } }));
c = ctx(proj);
must(c.includes("✅") && c.includes("⬜") && !c.includes("[x]"), "marks:emoji switches the task list marks");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ defaults: { forYou: false, taskList: false } }));
c = ctx(proj);
must(!c.includes("### For you") && !c.includes("Keel response format") && c.includes("Keel thrift") && c.includes("/keel:handoff"), "with the response format off the thrift rules still apply");
writeFileSync(join(proj, ".keel", "config.json"), JSON.stringify({ defaults: { forYou: false, taskList: false, thrift: false } }));
must(ctx(proj) === "", "everything off means no injected context");
writeFileSync(join(proj, ".keel", "config.json"), "{}");
must(ctx(proj).includes("Keel thrift") && ctx(proj).includes("### For you"), "by default the response format and the thrift rules are both injected");

rmSync(dir, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: usage dedupes, prices per model (incl. Haiku long tier and sub-agents), flags unpriced, footer and session-start hooks honour config");
