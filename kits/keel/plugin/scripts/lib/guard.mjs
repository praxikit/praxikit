/**
 * Keel's efficiency guards: no dependencies, no network, nothing here ever blocks a tool call or a prompt.
 *   openEnded(prompt)      does this ask leave the work unbounded ("redesign it", "make it the best")?
 *   lastContext(file)      how many tokens the conversation holds right now (what every turn re-reads)
 *   limits(cfg)            the thresholds, from the plugin defaults, a project's .keel/config.json and ~/.claude/keel.json
 *   readMonth / writeMonth month-to-date spend, written by a detached refresh so a hook never waits for it
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const readJson = (f, fb) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fb; } };

/** Verbs and phrases that turn a request into an unbounded one. Lower case; matched as plain text. */
export const OPEN_WORDS = [
  "redesign", "re-design", "makeover", "make over", "make-over", "revamp", "overhaul", "rebrand", "reimagine",
  "rewrite everything", "rewrite the whole", "refactor everything", "refactor the whole", "fix everything", "improve everything", "polish everything",
  "make it better", "make this better", "make it the best", "best ever", "one of the best", "no bugs", "no flaws", "bold changes", "from scratch",
  "whole website", "whole app", "whole application", "entire website", "entire app", "entire application", "complete makeover", "look and feel",
];

/** True when the ask is open-ended and no direction was given. Long, detailed asks and slash commands are left alone. */
export function openEnded(prompt) {
  const p = String(prompt ?? "").trim();
  if (!p || p.startsWith("/") || p.length > 1200) return false;
  const low = p.toLowerCase();
  if (/(^|\W)(option|variant|concept) [a-c1-3](\W|$)/.test(low) || low.includes("go with") || low.includes("i choose") || low.includes("i pick")) return false; // a choice was made
  return OPEN_WORDS.some((w) => low.includes(w));
}

/** Tokens in the conversation now: the last main-thread assistant message's whole prompt (input + cache read + cache write). 0 if unknown. */
export function lastContext(transcriptPath) {
  let text = "";
  try { text = readFileSync(transcriptPath, "utf8"); } catch { return 0; }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]; if (!l || !l.includes('"usage"')) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type !== "assistant" || e.isSidechain || !e.message?.usage || e.message.model === "<synthetic>") continue;
    const u = e.message.usage, cc = u.cache_creation ?? {};
    return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? (cc.ephemeral_1h_input_tokens ?? 0) + (cc.ephemeral_5m_input_tokens ?? 0));
  }
  return 0;
}

export const DEFAULT_LIMITS = { contextWarn: 150000, contextStep: 50000, monthlyLimit: 0, monthWarn: [0.7, 0.9], screenshots: 8 };

/** ~/.claude/keel.json, for settings that belong to the person and not to a project (the monthly limit). */
export const userConfigPath = () => join(homedir(), ".claude", "keel.json");

export function limits(cfg, userCfg = readJson(userConfigPath(), {})) {
  const l = { ...DEFAULT_LIMITS, ...(cfg?.limits ?? {}), ...(userCfg?.limits ?? {}) };
  if (process.env.KEEL_MONTHLY_LIMIT) l.monthlyLimit = Number(process.env.KEEL_MONTHLY_LIMIT);
  l.contextWarn = Number(l.contextWarn) > 0 ? Number(l.contextWarn) : DEFAULT_LIMITS.contextWarn;
  l.contextStep = Number(l.contextStep) > 0 ? Number(l.contextStep) : DEFAULT_LIMITS.contextStep;
  l.monthlyLimit = Number(l.monthlyLimit) > 0 ? Number(l.monthlyLimit) : 0;
  l.screenshots = Number(l.screenshots) > 0 ? Number(l.screenshots) : DEFAULT_LIMITS.screenshots;
  return l;
}

export const monthPath = () => join(homedir(), ".claude", "keel-month.json");
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export function readMonth(file = monthPath(), now = new Date()) {
  const m = readJson(file, null);
  return m && m.month === monthKey(now) && Number.isFinite(m.cost) ? m : null;
}
/** The month's ledger: the cost of each session this month, so the total is a sum and never a re-read of every transcript. */
export function writeMonth(sessions, file = monthPath(), now = new Date(), base = true) {
  const cost = Object.values(sessions).reduce((a, b) => a + (Number(b) || 0), 0);
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ month: monthKey(now), at: now.getTime(), base, cost, sessions })); } catch { /* a cache */ }
  return cost;
}
/** The footer records the session it is in; /keel:report records them all (and sets base: the total is complete as of then). */
export function touchSession(id, cost, file = monthPath(), now = new Date()) {
  const m = readMonth(file, now);
  return writeMonth({ ...(m?.sessions ?? {}), [String(id).slice(0, 60)]: cost }, file, now, m?.base === true);
}

/** The month line for the footer and the model: null under the first warning level or with no limit set. */
export function monthLine(month, lim) {
  if (!month || !lim.monthlyLimit || month.base !== true) return null;
  const share = month.cost / lim.monthlyLimit, hit = [...lim.monthWarn].sort((a, b) => b - a).find((w) => share >= w);
  if (!hit) return null;
  return `month ≈$${Math.round(month.cost)} of $${lim.monthlyLimit} (${Math.round(share * 100)}%, est.)`;
}

/** One small state file per session, in the temp folder: what Keel has already said, so it never nags. */
export const statePath = (sid) => join(process.env.TMPDIR || process.env.TEMP || "/tmp", `keel-${String(sid ?? "x").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || "x"}.json`);
export const readState = (sid) => readJson(statePath(sid), {});
export const writeState = (sid, s) => { try { writeFileSync(statePath(sid), JSON.stringify(s)); } catch { /* optional */ } };
export const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");
