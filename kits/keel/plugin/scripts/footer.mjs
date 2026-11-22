#!/usr/bin/env node
/**
 * Keel Stop hook: prints a one-line token and cost footer for the prompt that just finished.
 * Never blocks (always exit 0), silent on any problem or when the footer is turned off.
 * Reads the hook JSON from stdin and the session transcript; writes nothing; no network.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadPrices, summarize, footer } from "./lib/usage.mjs";
import { lastContext, limits, readMonth, touchSession, monthLine, fmtK } from "./lib/guard.mjs";
import { basename } from "node:path";

const quiet = () => process.exit(0);
let payload;
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { quiet(); }
if (!payload || typeof payload.transcript_path !== "string" || !existsSync(payload.transcript_path)) quiet();

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
try {
  const cfg = loadConfig(pluginRoot, project);
  if (cfg.defaults?.costFooter === false) quiet();
  const sum = summarize(payload.transcript_path, loadPrices(pluginRoot, project));
  let line = footer(sum, cfg.budget);
  if (line) {
    const lim = limits(cfg), ctx = lastContext(payload.transcript_path);
    // what every turn re-reads: shown always, with the way out once it is large
    if (ctx > 0) line += ` · context ${fmtK(ctx)}${ctx >= lim.contextWarn ? " (large: /keel:handoff, then start fresh)" : ""}`;
    if (lim.monthlyLimit) {
      // the month is a ledger of sessions: this one is updated here, the others when /keel:report last ran
      touchSession(payload.session_id ?? basename(payload.transcript_path, ".jsonl"), Object.values(sum.session).reduce((a, r) => a + r.cost, 0));
      const text = monthLine(readMonth(), lim);
      if (text) line += ` · ${text}`;
    }
    process.stdout.write(JSON.stringify({ systemMessage: line }) + "\n");
  }
} catch { /* a footer must never break a session */ }
process.exit(0);
