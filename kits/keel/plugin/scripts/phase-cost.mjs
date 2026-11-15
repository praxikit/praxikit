#!/usr/bin/env node
/**
 * Records what a phase cost. Keeps a ledger in .keel/ledger.json: each call stores the project's
 * cumulative estimated cost (all sessions and sub-agents) under a label; a phase's cost is the
 * difference from the previous mark. The first call has no earlier mark, so it reports the whole
 * recorded history and says so.
 *   node phase-cost.mjs "Phase 1" [--project <dir>] [--dry-run]
 * Prints one line to paste into docs/plan/05-progress.md. Estimates from list prices.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrices, summarize, totals, fmtUsd, fmtTok, projectTranscripts, readJson } from "./lib/usage.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const label = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (!label) { console.error('Usage: phase-cost.mjs "Phase 1" [--project <dir>] [--dry-run]'); process.exit(1); }
const project = resolve(arg("--project") ?? process.cwd());
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const prices = loadPrices(pluginRoot, project);

const files = projectTranscripts(project);
if (!files.length) { console.log(`${label}: no transcripts found for this project, so no cost recorded.`); process.exit(0); }
const t = { cost: 0, tokens: 0, unpriced: false };
for (const f of files) { const s = totals(summarize(f, prices).session); t.cost += s.cost; t.tokens += s.input + s.cacheRead + s.cacheWrite + s.output; t.unpriced ||= s.unpriced; }

const ledgerPath = join(project, ".keel", "ledger.json");
const ledger = readJson(ledgerPath, { marks: [] });
const prev = ledger.marks.at(-1);
const cost = t.cost - (prev?.cost ?? 0), tokens = t.tokens - (prev?.tokens ?? 0);
const sign = t.unpriced ? "≥" : "≈";
const basis = prev ? `since "${prev.label}"` : "since tracking began (first mark, covers all recorded sessions)";
const line = `Cost: ${label} ${sign}${fmtUsd(Math.max(0, cost))}, ${fmtTok(Math.max(0, tokens))} tokens ${basis}. Estimate from list prices.`;

if (!process.argv.includes("--dry-run")) {
  ledger.marks.push({ label, at: new Date().toISOString(), cost: t.cost, tokens: t.tokens });
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
}
console.log(line);
