#!/usr/bin/env node
/**
 * /keel:report: where the tokens and the money went, across every Claude Code session on this machine.
 *   node report.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--days N] [--project <text>] [--top N] [--root <projects dir>] [--json]
 * Reads the local transcripts (sessions and their sub-agents), de-duplicates messages, prices them with prices.json
 * (list prices: an estimate, not your invoice) and prints the shares that matter: by model, by token type, by project, the
 * heaviest sessions, the average context re-read per turn, and the tool calls that usually bloat a context.
 * No network, no dependencies. Exported for the tests.
 */
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readJsonl, loadPrices, costOf, shortModel, fmtTok, fmtUsd } from "./lib/usage.mjs";
import { writeMonth, monthKey } from "./lib/guard.mjs";

const SCREENSHOT = /screenshot|take_snapshot|computer$/i;
const POLL = /^(Monitor|TaskOutput|ScheduleWakeup)$/;

/** Every transcript under the projects dir: { project, session, files: [main, ...subagents] }. */
export function findSessions(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const d of readdirSync(root)) {
    const dir = join(root, d);
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const f of names.filter((n) => n.endsWith(".jsonl"))) {
      const id = f.slice(0, -6), subDir = join(dir, id, "subagents");
      const subs = existsSync(subDir) ? readdirSync(subDir).filter((n) => n.endsWith(".jsonl")).map((n) => join(subDir, n)) : [];
      out.push({ project: d, session: id, files: [join(dir, f), ...subs] });
    }
  }
  return out;
}

/** Totals for the given sessions between two dates (inclusive, YYYY-MM-DD; empty = open). */
export function aggregate(sessions, prices, { since = "", until = "", project = "" } = {}) {
  const models = {}, projects = {}, tools = {}, rows = [];
  const total = { turns: 0, cost: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, unpriced: 0 };
  const inRange = (ts) => { const day = String(ts ?? "").slice(0, 10); return (!since || day >= since) && (!until || day <= until); };
  for (const s of sessions) {
    if (project && !s.project.toLowerCase().includes(project.toLowerCase())) continue;
    const row = { project: s.project, session: s.session, turns: 0, cost: 0, cacheRead: 0, last: "" };
    for (const file of s.files) {
      const byId = new Map(), blocks = new Map(), mainFile = file === s.files[0];
      for (const e of readJsonl(file)) {
        if (e.type !== "assistant" || !e.message?.usage || e.message.model === "<synthetic>" || !inRange(e.timestamp)) continue;
        const id = e.message.id ?? e.uuid;
        byId.set(id, e); // the last copy carries the final usage
        // a message is written once per content block, so the tool calls are collected from every copy
        const seen = blocks.get(id) ?? new Map(); blocks.set(id, seen);
        for (const b of Array.isArray(e.message.content) ? e.message.content : []) if (b.type === "tool_use") seen.set(b.id ?? `${id}:${seen.size}`, String(b.name ?? ""));
      }
      for (const [id, e] of byId) {
        const m = String(e.message.model ?? "").replace(/\[.*?\]$/, ""), u = e.message.usage, key = shortModel(m);
        const cr = u.cache_read_input_tokens ?? 0, inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
        const cc = u.cache_creation ?? {}, cw = u.cache_creation_input_tokens ?? (cc.ephemeral_1h_input_tokens ?? 0) + (cc.ephemeral_5m_input_tokens ?? 0);
        const c = costOf(prices, m, u);
        const mm = (models[key] ??= { turns: 0, cost: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, context: 0, unpriced: false, sub: 0 });
        mm.turns++; mm.cacheRead += cr; mm.cacheWrite += cw; mm.input += inp; mm.output += out; mm.context += cr + inp + cw; if (!mainFile) mm.sub++;
        if (c === null) { mm.unpriced = true; total.unpriced++; } else { mm.cost += c; total.cost += c; row.cost += c; }
        total.turns++; total.cacheRead += cr; total.cacheWrite += cw; total.input += inp; total.output += out;
        row.turns++; row.cacheRead += cr; row.last = String(e.timestamp ?? row.last);
        const pr = (projects[s.project] ??= { turns: 0, cost: 0, cacheRead: 0 }); pr.turns++; pr.cost += c ?? 0; pr.cacheRead += cr;
        for (const t of blocks.get(id).values()) tools[t] = (tools[t] ?? 0) + 1;
      }
    }
    if (row.turns) rows.push(row);
  }
  const shots = Object.entries(tools).filter(([n]) => SCREENSHOT.test(n)).reduce((a, [, n]) => a + n, 0);
  const polls = Object.entries(tools).filter(([n]) => POLL.test(n)).reduce((a, [, n]) => a + n, 0);
  return { models, projects, tools, shots, polls, total, sessions: rows.sort((a, b) => b.cost - a.cost || b.cacheRead - a.cacheRead) };
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) + "%" : "0%");

export function render(r, { top = 5, since = "", until = "" } = {}) {
  const t = r.total, L = [];
  L.push(`# Keel report${since || until ? ` (${since || "start"} to ${until || "now"})` : ""}`);
  L.push("", `${t.turns} model turns in ${r.sessions.length} sessions. Estimated cost at list prices: **${fmtUsd(t.cost)}**. This is an estimate, not your invoice.`);
  if (t.unpriced) L.push(`${t.unpriced} turns used a model with no price in prices.json; their tokens are counted but not their cost.`);
  L.push("", "## By model", "", "| Model | Turns | Context per turn | Output | Est. cost | Share |", "|---|---|---|---|---|---|");
  for (const [k, m] of Object.entries(r.models).sort((a, b) => b[1].cost - a[1].cost)) L.push(`| ${k}${m.sub ? ` (${m.sub} in sub-agents)` : ""} | ${m.turns} | ${fmtTok(Math.round(m.context / Math.max(1, m.turns)))} | ${fmtTok(m.output)} | ${m.unpriced && !m.cost ? "no price" : fmtUsd(m.cost)} | ${pct(m.cost, t.cost)} |`);
  const typeCost = { "cache read": 0, "cache write": 0, "fresh input": 0, output: 0 };
  // split the estimate by token type with each model's own prices
  for (const [k, m] of Object.entries(r.models)) {
    const full = Object.keys(r.__prices?.models ?? {}).filter((id) => shortModel(id) === k).sort().pop();
    const p = full ? r.__prices.models[full] : null; if (!p) continue;
    typeCost["cache read"] += (m.cacheRead * p.cacheRead) / 1e6; typeCost["cache write"] += (m.cacheWrite * p.cacheWrite5m) / 1e6;
    typeCost["fresh input"] += (m.input * p.input) / 1e6; typeCost.output += (m.output * p.output) / 1e6;
  }
  const tc = Object.values(typeCost).reduce((a, b) => a + b, 0);
  L.push("", "## By token type (estimate)", "", "| Type | Est. cost | Share |", "|---|---|---|");
  for (const [k, v] of Object.entries(typeCost)) L.push(`| ${k} | ${fmtUsd(v)} | ${pct(v, tc)} |`);
  L.push("", "## By project", "", "| Project | Turns | Cache read | Est. cost |", "|---|---|---|---|");
  for (const [k, p] of Object.entries(r.projects).sort((a, b) => b[1].cost - a[1].cost).slice(0, 8)) L.push(`| ${k.replace(/^C--Users-[^-]+-/, "").slice(0, 60)} | ${p.turns} | ${fmtTok(p.cacheRead)} | ${fmtUsd(p.cost)} |`);
  L.push("", `## Heaviest sessions (top ${top})`, "", "| Session | Project | Turns | Cache read | Est. cost |", "|---|---|---|---|---|");
  for (const s of r.sessions.slice(0, top)) L.push(`| ${s.session.slice(0, 8)} | ${s.project.replace(/^C--Users-[^-]+-/, "").slice(-30)} | ${s.turns} | ${fmtTok(s.cacheRead)} | ${fmtUsd(s.cost)} |`);
  const topShare = r.sessions.slice(0, top).reduce((a, s) => a + s.cost, 0);
  L.push("", `The top ${Math.min(top, r.sessions.length)} sessions are ${pct(topShare, t.cost)} of the estimate.`);
  L.push("", "## Habits that bloat a context", "", `- Screenshot-type tool calls: **${r.shots}**. Each image stays in the context and is re-read on every later turn; prefer text snapshots and inspections.`, `- Polling and waiting tool calls (Monitor, TaskOutput, ScheduleWakeup): **${r.polls}**.`);
  const hot = Object.entries(r.tools).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n} ${c}`).join(", ");
  if (hot) L.push(`- Most used tools: ${hot}.`);
  const long = Object.entries(r.models).map(([k, m]) => [k, Math.round(m.context / Math.max(1, m.turns))]).filter(([, c]) => c > 150000);
  if (long.length) L.push(`- Average context re-read per turn is over 150k tokens for ${long.map(([k, c]) => `${k} (${fmtTok(c)})`).join(", ")}. Starting a fresh session per task is the biggest saving.`);
  return L.join("\n");
}

function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const root = arg("--root") ?? join(homedir(), ".claude", "projects");
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const prices = loadPrices(pluginRoot, process.cwd());
  if (process.argv.includes("--write-month-cache")) {
    // for the footer and the month guard: this calendar month's estimated spend, worked out here so a hook never has to
    const start = monthKey() + "-01", r0 = aggregate(findSessions(root), prices, { since: start });
    writeMonth(Object.fromEntries(r0.sessions.map((s) => [s.session, s.cost])));
    return;
  }
  let since = arg("--since") ?? "", until = arg("--until") ?? "";
  if (arg("--days")) since = new Date(Date.now() - Number(arg("--days")) * 864e5).toISOString().slice(0, 10);
  const r = aggregate(findSessions(root), prices, { since, until, project: arg("--project") ?? "" });
  Object.defineProperty(r, "__prices", { value: prices, enumerable: false });
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ total: r.total, models: r.models, projects: r.projects, shots: r.shots, polls: r.polls, sessions: r.sessions.slice(0, 20) }, null, 2)); return; }
  console.log(render(r, { top: Number(arg("--top") ?? 5), since, until }));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
