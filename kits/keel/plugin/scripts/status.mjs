#!/usr/bin/env node
/**
 * /keel:status. One screen: phases and where you are, the current phase's checks, the last progress
 * entry, and cost so far. Reads docs/plan/ and the session transcript. Writes nothing.
 *   node status.mjs [--project <dir>] [--transcript <file.jsonl>]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrices, summarize, totals, fmtUsd, fmtTok, latestTranscript } from "./lib/usage.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const project = resolve(arg("--project") ?? process.cwd());
const read = (f) => { try { return readFileSync(join(project, "docs", "plan", f), "utf8"); } catch { return null; } };

// The installed version and a link that fills in the catalog's "Am I up to date?" form for it.
const pluginRootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
let installed = "";
try { installed = JSON.parse(readFileSync(join(pluginRootDir, ".claude-plugin", "plugin.json"), "utf8")).version ?? ""; } catch { /* no manifest */ }
const updateLine = /^\d+\.\d+\.\d+$/.test(installed) ? `Keel v${installed}. Check for updates: https://praxikit.github.io/praxikit/?kit=keel&v=${installed}#updates` : "";

const phasesMd = read("03-phases.md");
if (!phasesMd) { console.log(["No docs/plan/03-phases.md here. Run /keel:plan to start a plan.", updateLine].filter(Boolean).join("\n\n")); process.exit(0); }

const out = [];
const sections = phasesMd.split(/^## /m).slice(1).filter((s) => /^Phase\s/i.test(s));
const mark = (h) => (h.includes("✅") ? "done" : h.includes("🟨") ? "in progress" : h.includes("⛔") ? "blocked" : "next");
const rows = sections.map((s) => { const h = s.split("\n")[0].trim(); return { h, state: mark(h), body: s }; });
const cleanName = (h) => h.replace(/\s*(✅|🟨|⬜|⛔).*$/u, "").trim();
const tick = { done: "[x]", "in progress": "[>]", blocked: "[!]", next: "[ ]" };

out.push("Phases");
for (const r of rows) out.push(`  ${tick[r.state]} ${cleanName(r.h)}${r.state === "blocked" ? "  (blocked: " + (/⛔\s*\(?([^)\n]*)/u.exec(r.h)?.[1]?.trim() || "see 03-phases.md") + ")" : ""}`);

const current = rows.find((r) => r.state === "in progress") ?? rows.find((r) => r.state === "blocked") ?? rows.find((r) => r.state === "next");
if (current) {
  out.push("", `Now: ${cleanName(current.h)}`);
  const goal = /\*\*Goal:\*\*\s*([^\n]*)/.exec(current.body)?.[1]?.trim();
  if (goal) out.push(`  Goal: ${goal}`);
  const checks = /\*\*Checks:\*\*([\s\S]*?)(?=\n\*\*[A-Z][^*]*:\*\*|\n## |$)/.exec(current.body)?.[1] ?? "";
  const list = checks.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
  if (list.length) { out.push("  Checks to pass:"); list.forEach((l) => out.push("   " + l)); }
} else out.push("", "All phases are done.");

const decisions = read("02-decisions.md");
if (decisions) {
  const open = decisions.split("\n").filter((l) => /\b(open|undecided|tbd|to decide)\b/i.test(l) && /^\s*([-*|]|\d+\.)/.test(l)).slice(0, 5);
  if (open.length) { out.push("", "Open decisions"); open.forEach((l) => out.push("  " + l.replace(/^\s*[-*]\s*/, "- ").trim())); }
}

const progress = read("05-progress.md");
if (progress) {
  const last = progress.split(/^## /m).slice(1).pop();
  if (last) { out.push("", "Last progress entry"); out.push("  " + last.split("\n")[0].trim()); }
}

try {
  const file = arg("--transcript") ?? latestTranscript(project);
  if (file && existsSync(file)) {
    const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const prices = loadPrices(pluginRoot, project);
    const s = totals(summarize(file, prices).session);
    out.push("", `Cost this session: ${s.unpriced ? "≥" : "≈"}${fmtUsd(s.cost)} (${fmtTok(s.input + s.cacheRead + s.cacheWrite)} in, ${fmtTok(s.output)} out), an estimate from list prices.`);
  }
} catch { /* cost is optional */ }

if (updateLine) out.push("", updateLine);
console.log(out.join("\n"));
