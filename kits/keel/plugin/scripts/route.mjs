#!/usr/bin/env node
/**
 * /keel:route: which model should do this task? A fixed mapping from a few facts to a tier, with floors, escalation on failure
 * and a small log of outcomes. The facts come from the lead's judgement; the mapping is code, so it can be read, tested and changed.
 *
 *   node route.mjs --kind implement --verifiable yes --ambiguity 1 --files 3 --lines 120 [--paths a,b] [--failures 0] [--sensitive yes]
 *   node route.mjs --record --kind implement --tier sonnet --ok yes [--cost 0.42]
 *   node route.mjs --stats
 *
 * Tiers, cheapest first: haiku, sonnet, think, top. The model for each tier is the "ladder" in defaults.json or .keel/config.json
 * (default haiku, sonnet, opus, fable), limited to the models the project allows.
 *
 * The principle: a task a command can verify may go to a cheap model, because a failed check is caught and escalated; a task only
 * judgement can verify goes to a strong one. Sensitive work never goes below "think".
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/usage.mjs";

export const TIERS = ["haiku", "sonnet", "think", "top"];
export const KINDS = ["find", "edit", "implement", "test", "refactor", "review", "debug", "design", "critique", "security"];
export const DEFAULT_LADDER = { haiku: "haiku", sonnet: "sonnet", think: "opus", top: "fable" };

/** Paths and words that mean the work can hurt someone if it is wrong: this is the floor, not a preference. */
export const SENSITIVE_PATHS = [
  /(^|[\\/])(auth|login|session|oauth|crypto|payment|billing|checkout|secrets?|permissions?|migrations?)([\\/._-]|$)/i,
  /(^|[\\/])\.github[\\/]workflows[\\/]/i, /(^|[\\/])(Dockerfile|wrangler\.toml|\.env[^\\/]*)$/i, /schema\.sql$/i, /(^|[\\/])(hooks?|release)[\\/.]/i,
];
export const sensitivePaths = (paths) => (paths ?? []).filter((p) => SENSITIVE_PATHS.some((re) => re.test(String(p))));

const bump = (tier, n = 1) => TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + n)];
const drop = (tier) => TIERS[Math.max(0, TIERS.indexOf(tier) - 1)];
const atLeast = (tier, floor) => (TIERS.indexOf(tier) < TIERS.indexOf(floor) ? floor : tier);

/** What the log says about a kind of task at a tier: { n, rate } or null. */
export function record(log, kind, tier) {
  const rows = (log ?? []).filter((r) => r.kind === kind && r.tier === tier);
  return rows.length ? { n: rows.length, rate: rows.filter((r) => r.ok).length / rows.length } : null;
}

/**
 * f: { kind, verifiable, ambiguity (0 none, 1 some, 2 open), files, lines, paths, sensitive, failures, causeKnown }
 * log: earlier outcomes [{ kind, tier, ok }]. Returns { tier, model, delegate, floor, reasons }.
 */
export function route(f, { ladder = DEFAULT_LADDER, models = ["haiku", "sonnet", "opus", "fable"], log = [] } = {}) {
  const why = [];
  const kind = KINDS.includes(f.kind) ? f.kind : "implement";
  const files = Number(f.files) || 1, lines = Number(f.lines) || 0, failures = Math.max(0, Number(f.failures) || 0);
  const amb = Math.min(2, Math.max(0, Number(f.ambiguity) || 0));
  const hits = sensitivePaths(f.paths);
  const sensitive = f.sensitive === true || hits.length > 0 || kind === "security";
  let tier, floor = "haiku";

  // 1. the kind of work sets the starting tier
  if (kind === "find") tier = "haiku";
  else if (kind === "edit") tier = f.verifiable ? "haiku" : "sonnet";
  else if (kind === "design" || kind === "critique" || kind === "security") tier = "think";
  else if (kind === "debug") tier = f.causeKnown ? "sonnet" : "think";
  else tier = "sonnet"; // implement, test, refactor, review
  why.push(`${kind} starts at ${tier}`);

  // 2. what makes it harder than its kind
  if (amb === 2 && kind !== "find") { tier = atLeast(tier, "think"); why.push("open design question: judgement needed"); }
  else if (amb === 1 && tier === "haiku" && kind !== "find") { tier = "sonnet"; why.push("some ambiguity: not a job for the smallest model"); }
  if (!f.verifiable && ["implement", "refactor", "edit", "test"].includes(kind) && amb >= 1) { tier = bump(tier); why.push("no command can prove it: one tier up"); }
  if ((files > 8 || lines > 400) && tier === "haiku") { tier = "sonnet"; why.push("large change"); }

  // 3. floors: never below these, whatever the log says
  if (sensitive) { floor = "think"; tier = atLeast(tier, "think"); why.push(`sensitive work (${hits.length ? hits.slice(0, 2).join(", ") : kind === "security" ? "security review" : "marked sensitive"}): never below think`); }

  // 4. what the log says about this kind at this tier (needs a few outcomes before it counts)
  const seen = record(log, kind, tier), below = tier !== floor ? record(log, kind, drop(tier)) : null;
  if (seen && seen.n >= 3 && seen.rate < 0.6) { tier = bump(tier); why.push(`${kind} passed first time only ${Math.round(seen.rate * 100)}% of ${seen.n} runs at that tier: one up`); }
  else if (below && below.n >= 5 && below.rate >= 0.9 && TIERS.indexOf(drop(tier)) >= TIERS.indexOf(floor) && !sensitive && f.verifiable) { tier = drop(tier); why.push(`${kind} passed first time ${Math.round(below.rate * 100)}% of ${below.n} runs one tier down: one down`); }

  // 5. escalation: every failed check moves it up one tier, at most two
  if (failures > 0) { const to = bump(tier, Math.min(2, failures)); if (to !== tier) why.push(`${failures} failed check${failures === 1 ? "" : "s"}: ${tier} to ${to}`); tier = to; }

  // 6. the model: the ladder's choice, or the next more capable allowed one, or the most capable allowed
  const order = ["haiku", "sonnet", "opus", "fable"], allowed = new Set(models);
  let model = ladder[tier] ?? DEFAULT_LADDER[tier];
  if (!allowed.has(model)) {
    const up = order.slice(Math.max(0, order.indexOf(model))).find((m) => allowed.has(m)) ?? [...order].reverse().find((m) => allowed.has(m)) ?? model;
    why.push(`${model} is not allowed here: ${up}`); model = up;
  }

  // 7. small work is cheaper done by the lead than briefed out: a sub-agent starts with an empty context and a brief
  const delegate = !(files <= 1 && lines <= 30 && kind !== "find" && !sensitive) && !(f.inline === true);
  if (!delegate) why.push("tiny change: do it inline, briefing an agent costs more");
  return { kind, tier, model, delegate, floor, sensitive, reasons: why };
}

export const logPath = (dir) => join(dir, ".keel", "routing-log.jsonl");
export function readLog(dir) {
  try { return readFileSync(logPath(dir), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { const r = JSON.parse(l); return r && KINDS.includes(r.kind) && TIERS.includes(r.tier) ? [r] : []; } catch { return []; } }); } catch { return []; }
}
export function appendLog(dir, row) {
  mkdirSync(join(dir, ".keel"), { recursive: true });
  appendFileSync(logPath(dir), JSON.stringify({ at: new Date().toISOString().slice(0, 10), kind: row.kind, tier: row.tier, ok: !!row.ok, ...(Number.isFinite(row.cost) ? { cost: Math.round(row.cost * 1000) / 1000 } : {}) }) + "\n");
}

const yes = (v) => /^(y|yes|true|1)$/i.test(String(v ?? ""));
function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const dir = process.cwd(), pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cfg = loadConfig(pluginRoot, dir);
  if (process.argv.includes("--record")) {
    if (!KINDS.includes(arg("--kind")) || !TIERS.includes(arg("--tier"))) { console.error(`record needs --kind (${KINDS.join("|")}) and --tier (${TIERS.join("|")}) and --ok yes|no`); process.exit(2); }
    appendLog(dir, { kind: arg("--kind"), tier: arg("--tier"), ok: yes(arg("--ok")), cost: Number(arg("--cost")) });
    console.log("recorded"); return;
  }
  if (process.argv.includes("--stats")) {
    const log = readLog(dir), rows = {};
    for (const r of log) { const k = `${r.kind}/${r.tier}`; (rows[k] ??= { n: 0, ok: 0 }).n++; if (r.ok) rows[k].ok++; }
    console.log(Object.keys(rows).length ? Object.entries(rows).sort().map(([k, v]) => `${k.padEnd(20)} ${v.ok}/${v.n} passed first time (${Math.round((v.ok / v.n) * 100)}%)`).join("\n") : "No outcomes recorded yet.");
    return;
  }
  const f = { kind: arg("--kind") ?? "implement", verifiable: yes(arg("--verifiable")), ambiguity: Number(arg("--ambiguity") ?? 1), files: Number(arg("--files") ?? 1), lines: Number(arg("--lines") ?? 0),
    paths: (arg("--paths") ?? "").split(",").map((s) => s.trim()).filter(Boolean), failures: Number(arg("--failures") ?? 0), sensitive: yes(arg("--sensitive")), causeKnown: yes(arg("--cause-known")), inline: yes(arg("--inline")) };
  const r = route(f, { ladder: { ...DEFAULT_LADDER, ...(cfg.ladder ?? {}) }, models: cfg.models ?? ["haiku", "sonnet", "opus", "fable"], log: readLog(dir) });
  console.log(JSON.stringify(r, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
