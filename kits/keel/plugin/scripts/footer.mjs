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

const quiet = () => process.exit(0);
let payload;
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { quiet(); }
if (!payload || typeof payload.transcript_path !== "string" || !existsSync(payload.transcript_path)) quiet();

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
try {
  const cfg = loadConfig(pluginRoot, project);
  if (cfg.defaults?.costFooter === false) quiet();
  const line = footer(summarize(payload.transcript_path, loadPrices(pluginRoot, project)), cfg.budget);
  if (line) process.stdout.write(JSON.stringify({ systemMessage: line }) + "\n");
} catch { /* a footer must never break a session */ }
process.exit(0);
