#!/usr/bin/env node
/**
 * Keel UserPromptSubmit hook: adds a short reminder for the model when it matters, and stays silent otherwise.
 *   1. scope gate   the ask is open-ended ("redesign it", "make it the best"): scope it before building anything.
 *   2. context      the conversation is large and every turn re-reads all of it: offer a fresh start with a hand-off.
 *   3. month        the month's estimated spend is close to the limit the person set: prefer the cheap path.
 * Never blocks (always exit 0), never writes anywhere but a small temp file, no network. Turn each part off in .keel/config.json
 * ("defaults": { "scopeHint": false, "contextHint": false }).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/usage.mjs";
import { openEnded, lastContext, limits, readMonth, monthLine, readState, writeState, fmtK } from "./lib/guard.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
if (!payload || typeof payload !== "object") process.exit(0);

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const cfg = loadConfig(pluginRoot, typeof payload.cwd === "string" ? payload.cwd : process.cwd());
  const d = cfg.defaults ?? {}, lim = limits(cfg);
  const hints = [];

  if (d.scopeHint !== false && openEnded(payload.prompt)) hints.push(
    "Keel scope gate: this ask is open-ended, so do not start building yet. Reply in this order and then wait: " +
    "(1) the goal in one sentence; (2) at most three questions, as choices (use AskUserQuestion); " +
    "(3) where taste is involved, two or three options shown as cheap samples (a text wireframe, a short palette and type note, or one small static page built on a cheap model), never a full build; " +
    "(4) a brief with the task size (S, M or L), the acceptance checks and a budget in turns or dollars. " +
    "Skip the questions only if the direction was already given earlier in this conversation. Building starts after the person picks.");

  if (d.contextHint !== false && typeof payload.transcript_path === "string") {
    const ctx = lastContext(payload.transcript_path), st = readState(payload.session_id);
    if (ctx >= lim.contextWarn && ctx >= (st.warnedAt ?? 0) + lim.contextStep) {
      hints.push(`Keel context meter: this conversation holds about ${fmtK(ctx)} tokens and every turn re-reads all of it, which is most of the cost. ` +
        "Say so to the person in one sentence before you start anything new, and offer /keel:handoff to continue in a fresh session. Do not keep working in a context this size without telling them.");
      writeState(payload.session_id, { ...st, warnedAt: ctx });
    }
  }

  const month = monthLine(readMonth(), lim);
  if (month && d.contextHint !== false) {
    const st = readState(payload.session_id);
    if (!st.monthSaid || st.monthSaid !== month.slice(0, 18)) {
      hints.push(`Keel month guard: ${month}. Prefer the cheapest model that can do each task, keep sub-agent briefs small, avoid screenshots and polling, and ask before any large piece of work.`);
      writeState(payload.session_id, { ...readState(payload.session_id), monthSaid: month.slice(0, 18) });
    }
  }

  if (hints.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: hints.join("\n\n") } }) + "\n");
} catch { /* a reminder must never break a prompt */ }
process.exit(0);
