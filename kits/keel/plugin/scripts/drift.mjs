#!/usr/bin/env node
/**
 * Keel PostToolUse hook for Edit / Write / MultiEdit / NotebookEdit.
 *
 * Warns ONCE per session when an edit lands outside the current phase's **Files** list in
 * docs/plan/03-phases.md. It never blocks (always exit 0). Silent when there is no plan, no
 * in-progress (🟨) phase, no Files list, or the edited file is outside the project.
 *
 * Reads the hook JSON from stdin, docs/plan/03-phases.md, and a one-line state file in the OS temp
 * dir (named from the session id). Makes no network calls and writes nothing else.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, sep, isAbsolute } from "node:path";

const quiet = () => process.exit(0);

let payload;
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { quiet(); }
if (!payload || typeof payload !== "object") quiet();

const input = payload.tool_input ?? {};
const edited = input.file_path ?? input.notebook_path;
if (typeof edited !== "string" || !edited) quiet();

// --- find the project root: nearest ancestor of cwd that has docs/plan/03-phases.md
const start = resolve(typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd());
let root = null;
for (let dir = start, i = 0; i < 8; i++, dir = dirname(dir)) {
  if (existsSync(join(dir, "docs", "plan", "03-phases.md"))) { root = dir; break; }
  if (dirname(dir) === dir) break;
}
if (!root) quiet();

const abs = isAbsolute(edited) ? edited : resolve(start, edited);
const rel = relative(root, abs).split(sep).join("/");
if (!rel || rel.startsWith("..")) quiet(); // outside the project
if (rel.startsWith("docs/plan/")) quiet(); // the plan itself is always in scope

// --- once per session
const sid = String(payload.session_id ?? "nosession").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "nosession";
const stateFile = join(tmpdir(), `keel-drift-${sid}`);
if (existsSync(stateFile)) quiet();

// --- read the in-progress phase's Files
let md;
try { md = readFileSync(join(root, "docs", "plan", "03-phases.md"), "utf8"); } catch { quiet(); }
const sections = md.split(/^## /m).slice(1);
const phase = sections.find((s) => s.split("\n")[0].includes("🟨"));
if (!phase) quiet();
const filesBlock = /\*\*Files:\*\*([\s\S]*?)(?=\n\*\*[A-Z][^*]*:\*\*|\n## |$)/.exec(phase)?.[1] ?? "";
const tokens = [...filesBlock.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
if (!tokens.length) quiet();

// --- patterns: brace lists {a,b}, numeric ranges {0..5}, * and ** globs, trailing / = directory
function expandBraces(p) {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  const range = /^(\d+)\.\.(\d+)$/.exec(m[1]);
  const opts = range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => String(Number(range[1]) + i)) : m[1].split(",");
  return opts.flatMap((o) => expandBraces(p.slice(0, m.index) + o + p.slice(m.index + m[0].length)));
}
function toRegex(p) {
  let pat = p.replace(/^\.\//, "");
  const dir = pat.endsWith("/");
  const body = pat.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, "[^/]");
  return new RegExp(dir ? `^${body}` : `^${body}(/.*)?$`);
}
const allowed = tokens.flatMap(expandBraces).map(toRegex);
if (allowed.some((re) => re.test(rel))) quiet();

try { writeFileSync(stateFile, rel + "\n"); } catch { /* still warn once this time */ }

const phaseName = phase.split("\n")[0].replace(/\s*🟨.*/, "").trim();
const msg =
  `Keel drift: ${rel} is outside the Files list of the current phase (${phaseName}). ` +
  `Either add it to that phase's Files in docs/plan/03-phases.md (and say why), or move the change to the phase it belongs to. ` +
  `This warning appears once per session.`;
process.stdout.write(JSON.stringify({ systemMessage: msg, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }) + "\n");
process.exit(0);
