#!/usr/bin/env node
/**
 * Keel PostToolUse hook for screenshot tools: counts them per session and, at a limit and every limit after, reminds the model that
 * each image stays in the context and is re-read on every later turn. Never blocks (always exit 0); a small temp file is the only state.
 * Limit: "limits": { "screenshots": 8 } in .keel/config.json. Off with "defaults": { "thrift": false }.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/usage.mjs";
import { limits, readState, writeState } from "./lib/guard.mjs";

let payload;
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
if (!payload || typeof payload !== "object" || !/screenshot/i.test(String(payload.tool_name ?? ""))) process.exit(0);
try {
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cfg = loadConfig(pluginRoot, typeof payload.cwd === "string" ? payload.cwd : process.cwd());
  if (cfg.defaults?.thrift === false) process.exit(0);
  const lim = limits(cfg).screenshots, st = readState(payload.session_id), n = (st.shots ?? 0) + 1;
  writeState(payload.session_id, { ...st, shots: n });
  if (n % lim === 0) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext:
    `Keel tool thrift: that was screenshot number ${n} in this session. Every image stays in the conversation and is re-read on every later turn. ` +
    "Check with text first (a page snapshot, an inspected element, console or network output, a test) and take a screenshot only as final proof for the person, at a small scale." } }) + "\n");
} catch { /* a reminder must never break a tool call */ }
process.exit(0);
