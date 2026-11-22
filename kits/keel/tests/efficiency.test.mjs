#!/usr/bin/env node
// Tests Keel's efficiency guards: the open-ended-ask detector, the context meter, the prompt hint hook, the footer's context and month
// lines, and the router. Synthetic inputs only; no network, no dependencies. Run from the repo root: node kits/keel/tests/efficiency.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openEnded, lastContext, limits, monthLine, writeMonth, readMonth, touchSession, DEFAULT_LIMITS } from "../plugin/scripts/lib/guard.mjs";
import { route, record, sensitivePaths, DEFAULT_LADDER, TIERS } from "../plugin/scripts/route.mjs";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");
const tmp = mkdtempSync(join(tmpdir(), "keel-eff-"));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

// ---- the open-ended ask detector
for (const p of ["Redesign the whole website", "I want a complete makeover of the app", "make this the best catalogue ever, no bugs", "can you make it better?", "rewrite everything from scratch", "Improve everything about the admin"])
  must(openEnded(p), `open-ended: ${p}`);
for (const p of ["fix the typo in the footer", "add a Copy button to the install line", "/impeccable critique the whole application", "go with option B for the redesign", "I pick concept 2", "run the tests", "", null, "x".repeat(1300) + " redesign"])
  must(!openEnded(p), `bounded or already decided: ${String(p).slice(0, 40)}`);

// ---- the context meter reads the last main-thread message, not a sub-agent's, and survives a bad file
const u = (i, cr, cw) => ({ input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
const transcript = join(tmp, "t.jsonl");
writeFileSync(transcript, jl([
  { type: "assistant", message: { id: "a", model: "claude-sonnet-5-5", usage: u(10, 90000, 0) } },
  { type: "assistant", message: { id: "b", model: "claude-sonnet-5-5", usage: u(20, 160000, 5000) } },
  { type: "assistant", isSidechain: true, message: { id: "c", model: "claude-haiku-5-5", usage: u(5, 900, 0) } },
  { type: "assistant", message: { id: "d", model: "<synthetic>", usage: u(1, 1, 1) } },
]) + "not json\n");
must(lastContext(transcript) === 165020, `context is the last main-thread message: ${lastContext(transcript)}`);
must(lastContext(join(tmp, "missing.jsonl")) === 0, "a missing transcript is 0, not an error");

// ---- limits and the month line
const lim = limits({}, {});
must(lim.contextWarn === 150000 && lim.monthlyLimit === 0 && lim.screenshots === 8, "defaults");
must(limits({ limits: { contextWarn: 100000, monthlyLimit: 1500 } }, {}).monthlyLimit === 1500 && limits({}, { limits: { monthlyLimit: 800 } }).monthlyLimit === 800, "project and personal settings are read");
must(limits({ limits: { contextWarn: -5, monthlyLimit: "x" } }, {}).contextWarn === DEFAULT_LIMITS.contextWarn && limits({ limits: { monthlyLimit: "x" } }, {}).monthlyLimit === 0, "nonsense falls back to the defaults");
const l1500 = { ...lim, monthlyLimit: 1500 };
must(monthLine({ cost: 900, base: true }, l1500) === null && /70%/.test(monthLine({ cost: 1050, base: true }, l1500)) && /95%/.test(monthLine({ cost: 1425, base: true }, l1500)) && monthLine({ cost: 1425, base: true }, lim) === null, "the month line shows from 70% of a limit, and not without one");
must(monthLine({ cost: 1425 }, l1500) === null, "without a baseline from /keel:report the month is not shown (it would under-count)");
const mfile = join(tmp, "month.json"), nov = new Date("2026-11-20T00:00:00Z");
must(writeMonth({ a: 300, b: 21.5 }, mfile, nov) === 321.5 && readMonth(mfile, new Date("2026-11-25T00:00:00Z"))?.cost === 321.5 && readMonth(mfile, new Date("2026-12-01T00:00:00Z")) === null, "the month ledger is a sum, and only valid in its own month");
must(touchSession("b", 50, mfile, nov) === 350 && touchSession("c", 5, mfile, nov) === 355 && readMonth(mfile, nov).base === true, "the footer updates its own session in the ledger and keeps the others");
const fresh = join(tmp, "fresh.json"); touchSession("x", 9, fresh, nov);
must(readMonth(fresh, nov).base === false && monthLine(readMonth(fresh, nov), l1500) === null, "a ledger the footer started alone has no baseline and shows nothing");

// ---- the UserPromptSubmit hook
const hook = (payload, env = {}) => spawnSync("node", [join(plugin, "scripts", "prompt-hint.mjs")], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8", env: { ...process.env, TMPDIR: tmp, TEMP: tmp, ...env } });
const textOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ""; } };
let r = hook({ prompt: "Redesign the whole website", cwd: tmp, session_id: "s1", transcript_path: transcript });
must(r.status === 0 && textOf(r).includes("scope gate") && textOf(r).includes("AskUserQuestion") && textOf(r).includes("context meter"), "an open-ended ask in a large conversation gets the scope reminder and the context reminder");
r = hook({ prompt: "Redesign the whole website", cwd: tmp, session_id: "s1", transcript_path: transcript });
must(r.status === 0 && textOf(r).includes("scope gate") && !textOf(r).includes("context meter"), "the context reminder is not repeated until the context has grown by a step");
r = hook({ prompt: "fix the typo", cwd: tmp, session_id: "s2", transcript_path: join(tmp, "small.jsonl") });
must(r.status === 0 && r.stdout === "", "a bounded ask in a small conversation says nothing");
for (const bad of ["", "not json", "[]", "null"]) must(hook(bad).status === 0, `garbage stdin never fails: ${bad}`);
mkdirSync(join(tmp, ".keel"), { recursive: true });
writeFileSync(join(tmp, ".keel", "config.json"), JSON.stringify({ defaults: { scopeHint: false, contextHint: false } }));
must(hook({ prompt: "Redesign the whole website", cwd: tmp, session_id: "s3", transcript_path: transcript }).stdout === "", "both reminders can be turned off");
writeFileSync(join(tmp, ".keel", "config.json"), "{}");

// ---- the footer shows the context, and the way out when it is large
const footer = (path) => spawnSync("node", [join(plugin, "scripts", "footer.mjs")], { input: JSON.stringify({ transcript_path: path, cwd: tmp }), encoding: "utf8" });
const withUsage = join(tmp, "f.jsonl");
writeFileSync(withUsage, jl([
  { type: "user", timestamp: "2026-11-15T10:00:00.000Z", message: { content: "go" } },
  { type: "assistant", timestamp: "2026-11-15T10:00:01.000Z", message: { id: "m", model: "claude-sonnet-5-5", usage: { ...u(10, 160000, 0), output_tokens: 100 } } },
]));
let line = ""; try { line = JSON.parse(footer(withUsage).stdout).systemMessage; } catch { /* checked below */ }
must(line.includes("context 160k") && line.includes("/keel:handoff"), `the footer shows a large context and the hand-off: ${line}`);
const small = join(tmp, "g.jsonl");
writeFileSync(small, jl([{ type: "user", timestamp: "2026-11-15T10:00:00.000Z", message: { content: "go" } }, { type: "assistant", timestamp: "2026-11-15T10:00:01.000Z", message: { id: "m", model: "claude-sonnet-5-5", usage: { ...u(10, 20000, 0), output_tokens: 100 } } }]));
try { line = JSON.parse(footer(small).stdout).systemMessage; } catch { line = ""; }
must(line.includes("context 20k") && !line.includes("handoff"), "a small context is shown without a warning");

// ---- the screenshot thrift hook
const shot = (name, sid, extra = {}) => spawnSync("node", [join(plugin, "scripts", "tool-thrift.mjs")], { input: JSON.stringify({ tool_name: name, session_id: sid, cwd: tmp, ...extra }), encoding: "utf8", env: { ...process.env, TMPDIR: tmp, TEMP: tmp } });
writeFileSync(join(tmp, ".keel", "config.json"), JSON.stringify({ limits: { screenshots: 3 } }));
const outs = [1, 2, 3, 4, 5, 6].map(() => shot("mcp__Claude_Browser__preview_screenshot", "sh1").stdout);
must(outs[0] === "" && outs[1] === "" && outs[2].includes("screenshot number 3") && outs[3] === "" && outs[5].includes("screenshot number 6"), "the screenshot reminder comes at the limit and at every multiple of it");
must(shot("Bash", "sh2").stdout === "" && shot("mcp__x__take_screenshot", "sh2").stdout === "", "other tools are not counted, and one screenshot says nothing");
for (const bad of ["", "nope", "[]"]) must(spawnSync("node", [join(plugin, "scripts", "tool-thrift.mjs")], { input: bad, encoding: "utf8" }).status === 0, "garbage stdin never fails the thrift hook");
writeFileSync(join(tmp, ".keel", "config.json"), JSON.stringify({ defaults: { thrift: false }, limits: { screenshots: 1 } }));
must(shot("mcp__x__screenshot", "sh3").stdout === "", "the thrift reminder can be turned off");
writeFileSync(join(tmp, ".keel", "config.json"), "{}");

// ---- the router
const ok = (f, o) => route({ verifiable: true, ambiguity: 0, files: 3, lines: 100, ...f }, o);
must(ok({ kind: "find" }).tier === "haiku" && ok({ kind: "find" }).model === "haiku", "finding things is haiku");
must(ok({ kind: "implement" }).tier === "sonnet", "implementing with a check is sonnet");
must(ok({ kind: "edit", files: 2 }).tier === "haiku" && ok({ kind: "edit", verifiable: false, ambiguity: 0 }).tier === "sonnet", "a mechanical edit with a check is haiku, without one sonnet");
must(ok({ kind: "design" }).tier === "think" && ok({ kind: "design" }).model === "opus" && ok({ kind: "critique" }).tier === "think", "design and critique are think (opus)");
must(ok({ kind: "debug", causeKnown: false }).tier === "think" && ok({ kind: "debug", causeKnown: true }).tier === "sonnet", "a root cause nobody found is think; a known one is sonnet");
must(ok({ kind: "implement", ambiguity: 2 }).tier === "think", "an open design question lifts a build task to think");
must(ok({ kind: "implement", verifiable: false, ambiguity: 1 }).tier === "think", "no check plus some ambiguity is one tier up");
must(ok({ kind: "edit", paths: ["api/src/lib/auth.mjs"], files: 1, lines: 3 }).tier === "think" && ok({ kind: "edit", paths: ["api/src/lib/auth.mjs"] }).floor === "think", "an edit to auth is never below think");
must(ok({ kind: "implement", paths: [".github/workflows/deploy.yml"] }).tier === "think" && ok({ kind: "implement", paths: ["db/migrations/001.sql"] }).sensitive, "workflows and migrations are sensitive");
must(ok({ kind: "security" }).tier === "think" && ok({ kind: "implement", sensitive: true }).tier === "think", "security and marked-sensitive work are think");
must(ok({ kind: "implement", failures: 1 }).tier === "think" && ok({ kind: "implement", failures: 2 }).tier === "top" && ok({ kind: "design", failures: 2 }).tier === "top" && ok({ kind: "design", failures: 9 }).tier === "top", "each failed check moves a task up a tier, at most two, never past top");
must(ok({ kind: "implement", files: 1, lines: 10 }).delegate === false && ok({ kind: "implement" }).delegate === true && ok({ kind: "find", files: 1, lines: 0 }).delegate === true, "a tiny change is done inline; a search is still worth a scout");
must(ok({ kind: "implement", files: 1, lines: 10, paths: ["auth/login.mjs"] }).delegate === true, "a tiny sensitive change is not left to chance");
must(ok({ kind: "implement" }, { models: ["haiku", "sonnet"] }).model === "sonnet" && ok({ kind: "design" }, { models: ["haiku", "sonnet"] }).model === "sonnet" && ok({ kind: "design" }, { models: ["haiku", "sonnet", "fable"] }).model === "fable", "a model that is not allowed becomes the next more capable allowed one, or the best available");
must(ok({ kind: "design" }, { ladder: { ...DEFAULT_LADDER, think: "fable" } }).model === "fable", "the ladder is configurable");
// the log
const pass = (n, tier, kind = "implement") => Array.from({ length: n }, () => ({ kind, tier, ok: true }));
const fail = (n, tier, kind = "implement") => Array.from({ length: n }, () => ({ kind, tier, ok: false }));
must(record(pass(4, "sonnet").concat(fail(1, "sonnet")), "implement", "sonnet").rate === 0.8 && record([], "implement", "sonnet") === null, "the record is a count per kind and tier");
must(ok({ kind: "implement" }, { log: fail(3, "sonnet") }).tier === "think" && ok({ kind: "implement" }, { log: pass(1, "sonnet").concat(fail(2, "sonnet")) }).tier === "think" && ok({ kind: "implement" }, { log: pass(2, "sonnet").concat(fail(1, "sonnet")) }).tier === "sonnet", "a kind that failed too often at a tier moves up");
must(ok({ kind: "implement" }, { log: fail(2, "sonnet") }).tier === "sonnet", "two outcomes are not enough to change anything");
must(ok({ kind: "implement" }, { log: pass(5, "haiku") }).tier === "haiku", "a verifiable kind that passed five times one tier down may move down");
must(ok({ kind: "implement", verifiable: false, ambiguity: 0 }, { log: pass(9, "haiku") }).tier === "sonnet", "without a check it never moves down on the record alone");
must(ok({ kind: "implement", paths: ["auth/x.mjs"] }, { log: pass(9, "sonnet") }).tier === "think", "the record never lowers a floor");
must(sensitivePaths(["README.md", "src/app.ts"]).length === 0 && sensitivePaths(["src/billing/charge.ts", ".env.local"]).length === 2 && TIERS.join() === "haiku,sonnet,think,top", "sensitive paths and the tier order");
// the command line, the log file
const proj = join(tmp, "proj"); mkdirSync(proj, { recursive: true });
const cli = (...a) => spawnSync("node", [join(plugin, "scripts", "route.mjs"), ...a], { cwd: proj, encoding: "utf8" });
const out = JSON.parse(cli("--kind", "implement", "--verifiable", "yes", "--ambiguity", "0", "--files", "4", "--lines", "200").stdout);
must(out.tier === "sonnet" && out.model === "sonnet" && out.delegate === true && out.reasons.length >= 1, "the command line prints the decision as JSON");
must(cli("--record", "--kind", "implement", "--tier", "sonnet", "--ok", "yes").stdout.trim() === "recorded" && cli("--record", "--kind", "nonsense", "--tier", "sonnet").status === 2, "outcomes are recorded, nonsense is refused");
must(cli("--stats").stdout.includes("implement/sonnet") && /1\/1/.test(cli("--stats").stdout) && readFileSync(join(proj, ".keel", "routing-log.jsonl"), "utf8").trim().split("\n").length === 1, "the stats read the log file");

// ---- every skill and agent file has frontmatter that YAML can read (an unquoted ": " inside a description silently drops the skill)
import { readdirSync } from "node:fs";
for (const [dir, file] of [...readdirSync(join(plugin, "skills")).map((s) => ["skills/" + s, "SKILL.md"]), ...readdirSync(join(plugin, "agents")).map((a) => ["agents", a])]) {
  const text = readFileSync(join(plugin, dir, file), "utf8"), lines = text.split("\n");
  const end = lines.indexOf("---", 1), desc = (lines.slice(1, end).find((l) => l.startsWith("description: ")) ?? "").slice(13);
  must(lines[0] === "---" && end > 0 && desc.length > 20 && desc.length <= 1024 && !desc.includes(": "), `${dir}/${file}: description must exist, stay under 1024 characters and contain no ": " (or be quoted)`);
}

if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: Keel scopes open-ended asks, meters the context, guards the month, and routes each task by its facts with floors, escalation and a record");
