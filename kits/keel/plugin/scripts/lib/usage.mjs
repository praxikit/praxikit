/**
 * Shared by the Stop footer hook and the /keel:cost report. No dependencies, no network.
 *
 * Reads a Claude Code session transcript (JSONL) plus its sub-agent transcripts
 * (<session dir>/subagents/*.jsonl) and sums token usage per model, optionally only since the last
 * real user prompt. One assistant message can appear several times in the file (one entry per
 * content block), so entries are de-duplicated by message id.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";

const readJsonl = (file) => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  } catch { return []; }
};
export const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };

/** Config: plugin defaults < project .keel/config.json. */
export function loadConfig(pluginRoot, projectDir) {
  const base = readJson(join(pluginRoot, "defaults.json"), {});
  const proj = projectDir ? readJson(join(projectDir, ".keel", "config.json"), {}) : {};
  return { ...base, ...proj, defaults: { ...(base.defaults ?? {}), ...(proj.defaults ?? {}) } };
}

export function loadPrices(pluginRoot, projectDir) {
  const base = readJson(join(pluginRoot, "prices.json"), { models: {} });
  const proj = projectDir ? readJson(join(projectDir, ".keel", "config.json"), {}) : {};
  return { ...base, models: { ...(base.models ?? {}), ...(proj.prices ?? {}) } };
}

const normModel = (m) => String(m ?? "").replace(/\[.*?\]$/, "");
export const shortModel = (id) => {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?$/.exec(normModel(id));
  return m ? `${m[1]} ${m[2].replace("-", ".")}` : normModel(id);
};

function priceFor(models, id) {
  const n = normModel(id);
  let best = null;
  for (const k of Object.keys(models)) if (n === k || n.startsWith(k + "-")) if (!best || k.length > best.length) best = k;
  return best ? models[best] : null;
}

/** USD for one message's usage, or null when the model has no price. */
export function costOf(prices, model, u) {
  const p = priceFor(prices.models, model);
  if (!p) return null;
  const cc = u.cache_creation ?? {};
  const cw1 = cc.ephemeral_1h_input_tokens ?? 0;
  const cw5 = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - cw1);
  const inp = u.input_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0, out = u.output_tokens ?? 0;
  const prompt = inp + cr + cw1 + cw5;
  const r = p.long && p.longPromptOver && prompt > p.longPromptOver ? p.long : p;
  return (inp * r.input + cw5 * r.cacheWrite5m + cw1 * r.cacheWrite1h + cr * r.cacheRead + out * r.output) / 1e6;
}

const isRealPrompt = (e) => {
  if (e.type !== "user" || e.isSidechain || e.isMeta) return false;
  const c = e.message?.content;
  if (typeof c === "string") return c.trim().length > 0;
  return Array.isArray(c) && c.some((b) => b.type === "text" || b.type === "image") && !c.some((b) => b.type === "tool_result");
};

function addMessages(entries, since, into) {
  const byId = new Map();
  for (const e of entries) {
    if (e.type !== "assistant" || !e.message?.usage || e.message.model === "<synthetic>") continue;
    if (since && String(e.timestamp ?? "") < since) continue;
    byId.set(e.message.id ?? e.uuid, e); // the last copy of a message wins
  }
  for (const e of byId.values()) {
    const m = normModel(e.message.model), u = e.message.usage;
    const cc = u.cache_creation ?? {};
    const cwTotal = u.cache_creation_input_tokens ?? (cc.ephemeral_1h_input_tokens ?? 0) + (cc.ephemeral_5m_input_tokens ?? 0);
    const row = (into[m] ??= { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, unpriced: false });
    row.calls++;
    row.input += u.input_tokens ?? 0;
    row.cacheRead += u.cache_read_input_tokens ?? 0;
    row.cacheWrite += cwTotal;
    row.output += u.output_tokens ?? 0;
    const c = costOf(into.__prices, m, u);
    if (c === null) row.unpriced = true; else row.cost += c;
  }
}

/** { prompt: {model: row}, session: {model: row} } for a transcript path. */
export function summarize(transcriptPath, prices) {
  const main = readJsonl(transcriptPath);
  let promptTs = "";
  for (const e of main) if (isRealPrompt(e)) promptTs = String(e.timestamp ?? promptTs);
  const subDir = join(dirname(transcriptPath), basename(transcriptPath, ".jsonl"), "subagents");
  const subs = existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith(".jsonl")).map((f) => readJsonl(join(subDir, f))) : [];
  const out = { prompt: {}, session: {} };
  for (const k of ["prompt", "session"]) Object.defineProperty(out[k], "__prices", { value: prices, enumerable: false });
  addMessages(main, promptTs, out.prompt);
  addMessages(main, "", out.session);
  for (const s of subs) { addMessages(s, promptTs, out.prompt); addMessages(s, "", out.session); }
  return out;
}

export function totals(rows) {
  const t = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, unpriced: false };
  for (const r of Object.values(rows)) { for (const k of ["calls", "input", "cacheRead", "cacheWrite", "output", "cost"]) t[k] += r[k]; t.unpriced ||= r.unpriced; }
  return t;
}

export const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
export const fmtUsd = (n) => (n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(2));

/** The default footer: one line. */
export function footer(sum) {
  const p = totals(sum.prompt), s = totals(sum.session);
  if (!p.calls) return null;
  const inAll = p.input + p.cacheRead + p.cacheWrite;
  const models = Object.entries(sum.prompt).map(([m, r]) => `${shortModel(m)} ${r.unpriced ? "n/a" : fmtUsd(r.cost)}`).join(", ");
  const money = (t) => (t.unpriced ? "≥ " : "≈ ") + fmtUsd(t.cost);
  return `Keel · this prompt: ${fmtTok(inAll)} in (${fmtTok(p.cacheRead)} cached), ${fmtTok(p.output)} out, ${p.calls} call${p.calls === 1 ? "" : "s"} · ${money(p)} (${models}) · session ${money(s)} · estimate`;
}

/** The full table for /keel:cost. */
export function table(sum, prices) {
  const lines = [];
  const render = (title, rows) => {
    lines.push(`\n${title}`);
    lines.push("model            calls    input  cache-read  cache-write     output       cost");
    for (const [m, r] of Object.entries(rows).sort((a, b) => b[1].cost - a[1].cost)) {
      lines.push(`${shortModel(m).padEnd(16)} ${String(r.calls).padStart(5)} ${fmtTok(r.input).padStart(8)} ${fmtTok(r.cacheRead).padStart(11)} ${fmtTok(r.cacheWrite).padStart(12)} ${fmtTok(r.output).padStart(10)} ${(r.unpriced ? "no price" : fmtUsd(r.cost)).padStart(10)}`);
    }
    const t = totals(rows);
    lines.push(`${"total".padEnd(16)} ${String(t.calls).padStart(5)} ${fmtTok(t.input).padStart(8)} ${fmtTok(t.cacheRead).padStart(11)} ${fmtTok(t.cacheWrite).padStart(12)} ${fmtTok(t.output).padStart(10)} ${((t.unpriced ? "≥ " : "") + fmtUsd(t.cost)).padStart(10)}`);
  };
  render("Last prompt (includes sub-agents)", sum.prompt);
  render("This session (includes sub-agents)", sum.session);
  lines.push(`\nPrices as of ${prices.asOf ?? "unknown"} (${prices.source ?? "no source"}). ${prices.note ?? ""}`);
  return lines.join("\n");
}

/** Newest transcript for a project dir, for the CLI when no path is given. */
export function latestTranscript(cwd) {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return null;
  const encoded = String(cwd).replace(/[^A-Za-z0-9]/g, "-");
  const dirs = readdirSync(root).filter((d) => d.toLowerCase() === encoded.toLowerCase());
  const pool = (dirs.length ? dirs : readdirSync(root)).map((d) => join(root, d));
  let best = null;
  for (const d of pool) {
    let files = [];
    try { files = readdirSync(d).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) { const t = statSync(join(d, f)).mtimeMs; if (!best || t > best.t) best = { f: join(d, f), t }; }
  }
  return best?.f ?? null;
}
