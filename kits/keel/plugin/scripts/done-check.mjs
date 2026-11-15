#!/usr/bin/env node
/**
 * Keel Stop hook: when files were changed during the prompt that just finished and nothing that
 * looks like a check ran after the last change, print one line saying so.
 * Heuristic, never blocks (always exit 0), silent on any problem or when turned off
 * (defaults.doneCheck:false). Reads the hook JSON from stdin and the session transcript only.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, readJsonl, lastPromptIndex } from "./lib/usage.mjs";

const quiet = () => process.exit(0);
let payload;
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { quiet(); }
if (!payload || typeof payload.transcript_path !== "string" || !existsSync(payload.transcript_path)) quiet();
if (payload.stop_hook_active) quiet();

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = typeof payload.cwd === "string" ? payload.cwd : process.cwd();

const EDIT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL = new Set(["Bash", "PowerShell"]);
const DOC = /\.(md|mdx|txt|rst)$/i;
// shell commands that do not check anything
const NOT_A_CHECK = /^\s*(git\s+(status|log|diff|show|add|commit|push|pull|fetch|branch|checkout|tag)\b|ls\b|dir\b|cat\b|echo\b|cd\b|pwd\b|mkdir\b|cp\b|mv\b|rm\b|type\b|head\b|tail\b|gh\s)/i;

try {
  const cfg = loadConfig(pluginRoot, project);
  if (cfg.defaults?.doneCheck === false) quiet();
  const entries = readJsonl(payload.transcript_path);
  const from = lastPromptIndex(entries);
  let lastEdit = -1;
  const edited = new Set();
  const uses = [];
  entries.slice(from + 1).forEach((e, i) => {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) return;
    for (const b of e.message.content) {
      if (b.type !== "tool_use") continue;
      if (EDIT.has(b.name)) {
        const f = b.input?.file_path ?? b.input?.notebook_path;
        if (typeof f === "string" && !DOC.test(f)) { edited.add(f); lastEdit = uses.length; }
        uses.push({ kind: "edit" });
      } else if (SHELL.has(b.name)) {
        uses.push({ kind: "shell", cmd: String(b.input?.command ?? "") });
      } else uses.push({ kind: "other" });
    }
  });
  if (lastEdit < 0) quiet(); // nothing but docs, or no edits
  const checked = uses.slice(lastEdit + 1).some((u) => u.kind === "shell" && !NOT_A_CHECK.test(u.cmd));
  if (checked) quiet();
  const n = edited.size;
  process.stdout.write(JSON.stringify({ systemMessage: `Keel done-check: ${n} file${n === 1 ? "" : "s"} changed this prompt and nothing was run to check ${n === 1 ? "it" : "them"} afterwards. Run the phase checks or the tests before calling it done.` }) + "\n");
} catch { /* never break a session */ }
process.exit(0);
