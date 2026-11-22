#!/usr/bin/env node
// Tests the /keel:report aggregation against a synthetic projects directory. No network, no dependencies.
// Run from the repo root: node kits/keel/tests/report.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPrices } from "../plugin/scripts/lib/usage.mjs";
import { findSessions, aggregate, render } from "../plugin/scripts/report.mjs";

const here = dirname(fileURLToPath(import.meta.url)), plugin = join(here, "..", "plugin");
const root = mkdtempSync(join(tmpdir(), "keel-report-"));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const usage = (i, cr, cw, o) => ({ input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: cw }, output_tokens: o });
const asst = (id, model, ts, u, tools = []) => ({ type: "assistant", timestamp: ts, uuid: id + ts, message: { id, model, usage: u, content: tools.map((name, i) => ({ type: "tool_use", id: id + "-" + name + i, name })) } });

// project A: one session on sonnet (two turns, one duplicated block, a screenshot and a monitor call), one sub-agent on haiku
mkdirSync(join(root, "C--proj-alpha", "s1", "subagents"), { recursive: true });
writeFileSync(join(root, "C--proj-alpha", "s1.jsonl"), jl([
  asst("a1", "claude-sonnet-5-5", "2026-11-10T09:00:00Z", usage(0, 1000000, 0, 0), ["Bash", "mcp__x__take_screenshot"]),   // 1M cache read: $0.10
  asst("a1", "claude-sonnet-5-5", "2026-11-10T09:00:00.5Z", usage(0, 1000000, 0, 0), ["Bash"]),                        // the same message again, one more content block
  asst("a2", "claude-sonnet-5-5", "2026-11-12T09:00:00Z", usage(0, 0, 0, 1000000), ["Monitor"]),                       // 1M output: $10
  asst("sy", "<synthetic>", "2026-11-12T09:00:01Z", usage(9, 9, 9, 9)),
]));
writeFileSync(join(root, "C--proj-alpha", "s1", "subagents", "agent-1.jsonl"), jl([asst("h1", "claude-haiku-5-5", "2026-11-10T09:05:00Z", usage(0, 0, 0, 1000000))])); // $0.50
// project B: opus, outside the date range except one turn
mkdirSync(join(root, "C--proj-beta"), { recursive: true });
writeFileSync(join(root, "C--proj-beta", "s2.jsonl"), jl([
  asst("b1", "claude-opus-5-5", "2026-10-01T09:00:00Z", usage(0, 0, 0, 1000000)),   // $20, October
  asst("b2", "claude-opus-5-5", "2026-11-14T09:00:00Z", usage(1000000, 0, 0, 0)),   // $4
  asst("b3", "claude-mystery-9", "2026-11-14T09:01:00Z", usage(5, 0, 0, 5)),        // no price
]));

const prices = loadPrices(plugin, "");
const sessions = findSessions(root);
must(sessions.length === 2 && sessions.some((s) => s.session === "s1" && s.files.length === 2), "finds each session and its sub-agent transcripts");

const all = aggregate(sessions, prices, {});
must(all.total.turns === 6 && near(all.total.cost, 0.10 + 10 + 0.50 + 20 + 4), `counts each message once, skips synthetic ones: turns ${all.total.turns} cost ${all.total.cost}`);
must(all.total.unpriced === 1 && all.models["mystery 9"].unpriced === true, "a model with no price is counted and flagged, not priced");
must(all.models["haiku 5.5"].sub === 1 && all.models["sonnet 5.5"].sub === 0, "sub-agent turns are counted separately");
must(all.shots === 1 && all.polls === 1, "screenshot-type and polling tool calls are counted");

const nov = aggregate(sessions, prices, { since: "2026-11-01", until: "2026-11-30" });
must(near(nov.total.cost, 0.10 + 10 + 0.50 + 4) && nov.total.turns === 5, "the date range keeps November only");
must(nov.sessions[0].session === "s1" && nov.sessions[0].cost > nov.sessions[1].cost, "sessions are ranked by cost");
const onlyBeta = aggregate(sessions, prices, { project: "beta" });
must(onlyBeta.total.turns === 3 && !onlyBeta.projects["C--proj-alpha"], "the project filter keeps matching projects only");

Object.defineProperty(nov, "__prices", { value: prices, enumerable: false });
const text = render(nov, { top: 2, since: "2026-11-01" });
must(text.includes("## By model") && text.includes("## By token type") && text.includes("## By project") && text.includes("Heaviest sessions") && text.includes("Screenshot-type tool calls: **1**") && text.includes("not your invoice"), "the report has every section and says it is an estimate");

const cli = spawnSync("node", [join(plugin, "scripts", "report.mjs"), "--root", root, "--since", "2026-11-01", "--json"], { encoding: "utf8" });
let parsed = null; try { parsed = JSON.parse(cli.stdout); } catch { /* checked below */ }
must(cli.status === 0 && parsed && parsed.total.turns === 5, "the command line prints JSON on request");
const empty = spawnSync("node", [join(plugin, "scripts", "report.mjs"), "--root", join(root, "nothing-here")], { encoding: "utf8" });
must(empty.status === 0 && empty.stdout.includes("0 model turns"), "an empty or missing projects directory is a normal, empty report");

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: /keel:report counts every message once, prices what it can, separates sub-agents, filters by date and project, and flags the habits that bloat a context");
