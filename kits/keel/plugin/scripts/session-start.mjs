#!/usr/bin/env node
/**
 * Keel SessionStart hook: injects Keel's standing response format once per session.
 * Reads .keel/config.json "defaults" (forYou, taskList, marks, costFooter). Silent when both
 * sections are off. The cost footer itself is printed by the Stop hook, not written by the model.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/usage.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { /* use cwd */ }
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = loadConfig(pluginRoot, typeof payload.cwd === "string" ? payload.cwd : process.cwd());
const d = cfg.defaults ?? {};
const forYou = d.forYou !== false, taskList = d.taskList !== false, thrift = d.thrift !== false;
if (!forYou && !taskList && !thrift) process.exit(0);

const marks = d.marks === "emoji" ? { done: "✅", doing: "🔄", next: "⬜" } : { done: "[x]", doing: "[>]", next: "[ ]" };
const lines = [];
if (forYou || taskList) lines.push(
  "Keel response format (standing rules from the Keel plugin; change them with /keel:settings). Use it when the work has several steps or the user has something to do; a plain question gets a plain answer with no sections.",
  "Layout, in this order: 1) the result in one or two sentences. 2) the sections below, each only when it applies. 3) nothing after them (a hook prints the cost footer; never write token or cost numbers yourself).",
);
if (forYou) lines.push(
  "### For you — only when the user must act (a decision, a command, a step outside your tools). Numbered. Each step: a bold action, then the exact command or place in code formatting, then `→ expect:` what they should see. Add `(blocks the next step)` where it does. No step the user does not need to do.");
if (taskList) lines.push(
  `### Task list — only for multi-step work. One numbered line per task: ${marks.done} done, ${marks.doing} in progress, ${marks.next} next. Keep the same order and wording from reply to reply; keep finished tasks on the list until the whole request is finished; the first ${marks.next} is the next task. Add a task only when it is real.`);
// the standing habits that keep a context small: short on purpose, because this text is read on every turn of the session
if (thrift) lines.push(
  "Keel thrift (standing rules; turn off with defaults.thrift=false): size the task first (S: one file and a clear check, just do it; M: a short brief; L: scope it with the person before building). " +
  "Open-ended asks (redesign, make it better) get a goal, at most three choice questions and cheap samples before any build. " +
  "Read files with offset and limit and do not re-read what is already in context; batch independent calls; prefer text snapshots, inspections and test output to screenshots, and one browser tool, not three. " +
  "Do not poll: wait for a background task's notice. Give sub-agents a small brief and ask for a short report, not file dumps. " +
  "When the conversation is large, say so and offer /keel:handoff instead of carrying on.");
const text = lines.join("\n");
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }) + "\n");
process.exit(0);
