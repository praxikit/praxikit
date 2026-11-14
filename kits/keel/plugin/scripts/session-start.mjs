#!/usr/bin/env node
/**
 * Keel SessionStart hook: injects Keel's standing response format once per session.
 * Reads .keel/config.json "defaults" (forYou, taskList, costFooter). Silent when all are off.
 * The cost footer itself is printed by the Stop hook, not written by the model.
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

const rules = [];
if (d.forYou !== false)
  rules.push("**For you**: when the user has something to do (a decision, a command to run, a step outside your tools), end the reply with a section headed **For you**: numbered steps, each detailed enough to follow without asking you again. Leave the section out when there is nothing for them to do.");
if (d.taskList !== false)
  rules.push("**Task list**: when the request has more than one step, end the reply with a section headed **Task list**: every task of this request in order, ✅ done, 🔄 in progress, ⬜ next. Leave it out for single-step answers.");
if (!rules.length) process.exit(0);
rules.push("Never pad these sections and never repeat them when nothing changed. Do not write token or cost numbers yourself: a Keel hook prints that footer.");

const text = "Keel response format (standing rules from the Keel plugin; the user can change them with /keel:settings):\n- " + rules.join("\n- ");
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }) + "\n");
process.exit(0);
