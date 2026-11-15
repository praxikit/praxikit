#!/usr/bin/env node
/**
 * Automated, read-only checks for a kit submitted through the issue forms.
 *
 *   node scripts/check-submission.mjs --issue-env ISSUE_BODY --out comment.md --label-out label.txt
 *   node scripts/check-submission.mjs --url https://github.com/owner/repo   (local use)
 *   node scripts/check-submission.mjs --dir path/to/checkout               (local use)
 *
 * Nothing from the submitted repository is ever run or installed. The scan only reads files.
 * Everything that came from the repository or the issue is untrusted: it is sanitised before it is
 * written into the comment, and secret values are never printed (only file, line and pattern name).
 * The result says what was checked and that it is not proof of safety; a person decides.
 */
import { readFileSync, writeFileSync, readdirSync, lstatSync, openSync, readSync, closeSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, devNull } from "node:os";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER = "<!-- praxikit-submission-check -->";
const LIMITS = { files: 3000, fileBytes: 1_000_000, lineScan: 20_000, repoBytes: 100_000_000, repoKb: 100_000, shown: 4, comment: 60_000 };

// ---------- untrusted text ----------
/**
 * Safe to put inside a markdown table cell or list item. An allowlist, not a blocklist: anything that
 * is not a letter, digit or one of . _ / : , + = - becomes a space, so no markup, mentions, images,
 * links or cross-references survive. Links that would still auto-link (scheme://, www.) are broken.
 */
export const safe = (s, n = 90) => String(s ?? "").replace(/[^A-Za-z0-9._/:,+= -]/g, " ").replace(/:\/\//g, " //").replace(/\bwww\./gi, "www ").replace(/\s+/g, " ").trim().slice(0, n);

// ---------- issue form body ----------
/** GitHub issue forms render "### Heading\n\nanswer". Returns { heading: answer }. */
export function parseIssue(body) {
  const out = {};
  const parts = String(body ?? "").split(/^### +/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const head = (nl < 0 ? p : p.slice(0, nl)).trim();
    const val = (nl < 0 ? "" : p.slice(nl + 1)).trim();
    out[head] = val === "_No response_" ? "" : val;
  }
  return out;
}

/** Only https://github.com/<owner>/<repo>; everything else is refused, never fetched. */
export function repoUrl(text) {
  const m = /https:\/\/[^\s)>\]"']+/.exec(String(text ?? ""));
  if (!m) return { ok: false, why: "no link found" };
  let u;
  try { u = new URL(m[0]); } catch { return { ok: false, why: "not a valid link" }; }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password || u.port) return { ok: false, why: "not a plain https://github.com link", host: u.hostname };
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length < 2) return { ok: false, why: "link does not name a repository" };
  const [owner, repoRaw] = seg;
  const repo = repoRaw.replace(/\.git$/, "");
  const name = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_.-])?$/;
  if (!name.test(owner) || !name.test(repo) || owner.includes("..") || repo.includes("..")) return { ok: false, why: "owner or repository name looks unusual" };
  return { ok: true, owner, repo, clone: `https://github.com/${owner}/${repo}.git`, page: `https://github.com/${owner}/${repo}` };
}

// ---------- fetching (does not execute anything from the repo) ----------
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_CONFIG_NOSYSTEM: "1", ...(process.platform === "win32" ? {} : { GIT_CONFIG_GLOBAL: devNull }) });

/** Repository size in KB from the GitHub API through the gh CLI, or null when it cannot be learned. */
export function repoSizeKb(owner, repo) {
  try {
    const out = execFileSync("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".size"], { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^\d+$/.test(out) ? Number(out) : null;
  } catch { return null; }
}

export function cloneRepo(url, dest) {
  const env = gitEnv();
  execFileSync("git", ["-c", "core.symlinks=false", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", `core.hooksPath=${devNull}`, "-c", "submodule.recurse=false",
    "clone", "--depth", "1", "--no-tags", "--single-branch", "--filter=blob:limit=2m", "--no-recurse-submodules", url, dest],
  { env, timeout: 120_000, stdio: ["ignore", "ignore", "pipe"] });
  return execFileSync("git", ["-C", dest, "rev-parse", "HEAD"], { encoding: "utf8", env }).trim();
}

// ---------- scanning ----------
const SKIP_DIRS = new Set([".git", "node_modules"]);
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".rb", ".go", ".rs", ".php", ".pl", ".lua"]);
const TEXT_EXT = new Set([...CODE_EXT, ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".env", ".cursorrules"]);
const BIN_EXT = new Set([".exe", ".dll", ".so", ".dylib", ".bin", ".jar", ".class", ".wasm", ".node", ".o", ".a", ".pyc", ".msi", ".dmg", ".apk", ".scr"]);

const walk = (root) => {
  const files = []; const symlinks = []; let bytes = 0, truncated = false;
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    let names; try { names = readdirSync(join(root, rel)); } catch { continue; }
    for (const n of names) {
      const r = rel ? `${rel}/${n}` : n; const p = join(root, r);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { symlinks.push(r); continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(n)) stack.push(r); continue; }
      if (!st.isFile()) continue;
      if (files.length >= LIMITS.files) { truncated = true; continue; }
      files.push({ rel: r, size: st.size }); bytes += st.size;
    }
  }
  return { files, symlinks, bytes, truncated };
};

const head = (p, n = 4) => { try { const fd = openSync(p, "r"); const b = Buffer.alloc(n); const k = readSync(fd, b, 0, n, 0); closeSync(fd); return b.subarray(0, k); } catch { return Buffer.alloc(0); } };
const isExecutableMagic = (b) => (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) || (b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) || (b.length >= 4 && ((b[0] === 0xcf && b[1] === 0xfa) || (b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe)));

// Patterns are built from parts so this file does not itself look like a leaked secret.
const SECRETS = [
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/, true],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, true],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, true],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, true],
  ["private key block", new RegExp("-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE " + "KEY-----"), true],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/, true],
  ["Anthropic API key", new RegExp("\\bsk-ant-" + "[A-Za-z0-9_-]{20,}"), true],
  ["OpenAI-style API key", new RegExp("\\bsk-" + "[A-Za-z0-9]{32,}\\b"), true],
  ["Stripe live key", new RegExp("\\bsk_" + "live_[0-9a-zA-Z]{20,}"), true],
  ["hard-coded credential", /\b(?:api[_-]?key|secret|token|passwd|password)\b\s*[:=]\s*["'][A-Za-z0-9/+_-]{20,}["']/i],
];
const PLACEHOLDER = /example|xxxx|your[_-]|placeholder|dummy|fake|changeme|sample/i;
const TESTISH = /(^|\/)(tests?|__tests__|spec|fixtures?|examples?|samples?|mocks?|docs?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test[-_.][^\/]*$/i;
const NETWORK = [
  ["fetch call", /\bfetch\s*\(/], ["node http(s)", /node:https?|require\(\s*["']https?["']\s*\)/], ["XMLHttpRequest or WebSocket", /XMLHttpRequest|\bnew WebSocket\s*\(/],
  ["curl or wget", /\b(?:curl|wget)\s+-?\S/], ["PowerShell web request", /Invoke-WebRequest|Invoke-RestMethod/],
  ["python http client", /\brequests\.(?:get|post|put|delete)\s*\(|\burllib\.|\bhttp\.client\b|\baiohttp\b|\bhttpx\b/],
];
const EXEC = [
  ["child process", /child_process|\bexecSync\s*\(|\bspawnSync?\s*\(/], ["shell from python", /\bos\.system\s*\(|\bsubprocess\.|\bPopen\s*\(/],
  ["eval or Function", /\beval\s*\(|\bnew Function\s*\(/], ["PowerShell Invoke-Expression", /Invoke-Expression|\biex\s/],
  ["pipe to a shell", /\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/], ["decode then run", /base64\s+(?:-d|--decode)|\batob\s*\(/],
];
const INJECTION = [
  ["tells the model to ignore earlier instructions", /ignore (?:all |any )?(?:previous|prior|above|earlier) instructions/i],
  ["tells the model to hide something from the user", /do not (?:tell|inform|mention (?:this )?to) the user|without (?:telling|informing|asking) the user/i],
  ["mentions exfiltration", /exfiltrat/i], ["tells the model to disable safeguards", /disable (?:the )?(?:sandbox|permission|safety)/i],
];
const LICENCES = [["MIT", /\bMIT License\b|Permission is hereby granted, free of charge/i], ["Apache-2.0", /Apache License[\s\S]{0,40}Version 2\.0/i], ["BSD", /Redistribution and use in source and binary forms/i],
  ["ISC", /\bISC License\b/i], ["MPL-2.0", /Mozilla Public License[\s\S]{0,30}2\.0/i], ["GPL", /GNU (?:Affero |Lesser )?General Public License/i], ["Unlicense", /This is free and unencumbered software/i]];

/** Scans a checked-out directory. Pure: reads files, returns a list of findings. */
export function scanDir(root, declared = "") {
  const { files, symlinks, bytes, truncated } = walk(root);
  const R = { files: files.length, bytes, checks: [] };
  const add = (id, title, status, notes = []) => R.checks.push({ id, title, status, notes });
  // Network and process patterns are counted separately for code, for files that instruct an agent
  // (SKILL.md, agents, commands, rules) and for ordinary documentation. Only the first two are findings:
  // a README that shows `curl` in an example is not the kit calling the network.
  const hits = { secrets: [], secretsSoft: [], netCode: [], netInstr: [], netDocs: 0, execCode: [], execInstr: [], execDocs: 0, injection: [], long: [] };
  const binaries = [];
  const hooks = []; const installScripts = []; let manifestKind = [];

  for (const f of files) {
    const p = join(root, f.rel); const ext = extname(f.rel).toLowerCase(); const name = basename(f.rel);
    if (BIN_EXT.has(ext)) { binaries.push(f.rel); continue; }
    if (f.size > 0 && f.size <= LIMITS.fileBytes && !TEXT_EXT.has(ext) && isExecutableMagic(head(p))) { binaries.push(f.rel); continue; }
    if (f.size > LIMITS.fileBytes || (!TEXT_EXT.has(ext) && name !== ".cursorrules" && name !== "Dockerfile")) continue;
    let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
    const lines = text.split("\n");
    const isCode = CODE_EXT.has(ext), isMd = ext === ".md" || ext === ".mdx" || name === ".cursorrules";
    const instr = isMd && (name === "SKILL.md" || name === ".cursorrules" || ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].includes(name) || /(^|\/)(agents|commands|skills|prompts|\.claude)\//.test(f.rel));
    const bucket = isCode ? "Code" : instr ? "Instr" : "Docs";
    lines.forEach((full, i) => {
      const ln = full.length > LIMITS.lineScan ? full.slice(0, LIMITS.lineScan) : full; // keep regex work bounded
      const at = `${safe(f.rel, 60)}:${i + 1}`;
      if (full.length > 2000 && isCode) hits.long.push(at);
      for (const [label, re, strong] of SECRETS) {
        const m = re.exec(ln);
        if (!m || PLACEHOLDER.test(m[0])) continue;
        // a loose "token = '...'" match in a test or example file is usually a fake; provider-shaped keys never get that pass
        if (!strong && TESTISH.test(f.rel)) hits.secretsSoft.push(`${at} (${label})`); else hits.secrets.push(`${at} (${label})`);
        break;
      }
      if (isCode || isMd) {
        for (const [label, re] of NETWORK) if (re.test(ln)) { if (bucket === "Docs") hits.netDocs++; else hits[`net${bucket}`].push(`${at} (${label})`); break; }
        for (const [label, re] of EXEC) if (re.test(ln)) { if (bucket === "Docs") hits.execDocs++; else hits[`exec${bucket}`].push(`${at} (${label})`); break; }
      }
      if (isMd) for (const [label, re] of INJECTION) if (re.test(ln)) { hits.injection.push(`${at} (${label})`); break; }
    });
    if (name === "hooks.json" || (name === "settings.json" && /\.claude\//.test(f.rel)) || name === "plugin.json") {
      try {
        const j = JSON.parse(text); const h = j.hooks;
        if (h && typeof h === "object" && !Array.isArray(h)) for (const [ev, groups] of Object.entries(h)) for (const g of Array.isArray(groups) ? groups : []) for (const x of g.hooks ?? []) hooks.push(`${safe(ev, 30)} runs ${safe([x.command, ...(x.args ?? [])].join(" "), 80)}`);
      } catch { /* not JSON we understand */ }
    }
    if (name === "package.json") {
      try { const s = JSON.parse(text).scripts ?? {}; for (const k of ["preinstall", "install", "postinstall", "prepare"]) if (s[k]) installScripts.push(`${k}: ${safe(s[k], 70)}`); } catch { /* ignore */ }
    }
    if (name === "setup.py") installScripts.push("setup.py runs when the package is installed");
  }

  // what is it
  const rels = files.map((f) => f.rel);
  if (rels.some((r) => r.endsWith(".claude-plugin/plugin.json"))) manifestKind.push("Claude Code plugin");
  if (rels.some((r) => basename(r) === "SKILL.md")) manifestKind.push("skill");
  if (rels.some((r) => basename(r) === ".mcp.json")) manifestKind.push("MCP config");
  if (rels.some((r) => basename(r) === ".cursorrules" || basename(r) === "AGENTS.md")) manifestKind.push("agent rules");
  manifestKind = [...new Set(manifestKind)];
  add("shape", "Recognisable kit contents", manifestKind.length ? "pass" : "flag", [manifestKind.length ? `Found: ${manifestKind.join(", ")}` : "No plugin manifest, SKILL.md, .mcp.json or agent rules file found. A person needs to check what this is."]);

  // licence
  const licFile = rels.find((r) => /^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(r));
  let lic = "";
  if (licFile) { try { const t = readFileSync(join(root, licFile), "utf8").slice(0, 20000); lic = LICENCES.find(([, re]) => re.test(t))?.[0] ?? ""; } catch { /* unreadable */ } }
  add("licence", "Licence", licFile ? (lic ? "pass" : "flag") : "fail", [licFile ? (lic ? `${safe(licFile, 40)} looks like ${lic}` : `${safe(licFile, 40)} is present but not a licence this check recognises`) : "No LICENSE or COPYING file. Listing requires a licence that lets others use the kit."]);

  // secrets (values are never shown)
  add("secrets", "Secret-like strings", hits.secrets.length ? "fail" : hits.secretsSoft.length ? "flag" : "pass",
    hits.secrets.length ? [`${hits.secrets.length} match(es), values hidden:`, ...hits.secrets.slice(0, LIMITS.shown)]
      : hits.secretsSoft.length ? [`${hits.secretsSoft.length} credential-looking string(s) in test or example files, values hidden. They are usually fakes; a person should confirm:`, ...hits.secretsSoft.slice(0, LIMITS.shown)]
      : ["No matches for common key and token patterns. This is a basic pattern check, not a full secret scan."]);

  // hooks and install scripts: code that runs without being asked
  add("autorun", "Runs automatically", hooks.length || installScripts.length ? "flag" : "pass", hooks.length || installScripts.length ? [...hooks.map((h) => `hook: ${h}`), ...installScripts].slice(0, LIMITS.shown + 4) : ["No hooks or install-time scripts found."]);

  // network and process execution
  const wantsNone = /\b(?:nothing|none|no network|no network calls)\b/i.test(String(declared).slice(0, 2000));
  const docsNote = (n, what) => (n ? [`${n} mention(s) of ${what} in documentation files. Not counted as findings: documentation often shows examples.`] : []);
  const netNotes = hits.netCode.length ? [`${hits.netCode.length} line(s) in code that look like network access:`, ...hits.netCode.slice(0, LIMITS.shown)] : ["No network access patterns in code."];
  if ((hits.netCode.length || hits.netInstr.length) && wantsNone) netNotes.push("The submission said it sends nothing. That does not match the lines found; a person should look.");
  add("network", "Network access in code", hits.netCode.length ? "flag" : "pass", [...netNotes, ...docsNote(hits.netDocs, "network commands")]);
  add("exec", "Runs other programs or code, in code", hits.execCode.length ? "flag" : "pass", hits.execCode.length ? [`${hits.execCode.length} line(s) in code:`, ...hits.execCode.slice(0, LIMITS.shown), ...docsNote(hits.execDocs, "running programs or eval")] : ["No process-execution or eval patterns in code.", ...docsNote(hits.execDocs, "running programs or eval")]);
  const instrHits = [...hits.netInstr, ...hits.execInstr];
  add("instructions", "Commands in agent instructions", instrHits.length ? "flag" : "pass", instrHits.length ? [`${instrHits.length} line(s) in skill, agent, command or rules files that tell an agent to use the network or run programs:`, ...instrHits.slice(0, LIMITS.shown)] : ["None found in skill, agent, command or rules files."]);

  // oddities
  const odd = [];
  if (binaries.length) odd.push(`${binaries.length} compiled or binary file(s): ${binaries.slice(0, 4).map((b) => safe(b, 50)).join(", ")}`);
  if (symlinks.length) odd.push(`${symlinks.length} symbolic link(s), not followed`);
  if (hits.long.length) odd.push(`${hits.long.length} code line(s) over 2000 characters (possible minified or obfuscated code): ${hits.long.slice(0, 3).join(", ")}`);
  if (hits.injection.length) odd.push(`${hits.injection.length} instruction(s) in markdown that ask a model to act against the user: ${hits.injection.slice(0, 3).join(", ")}`);
  if (truncated) odd.push(`More than ${LIMITS.files} files; only the first ${LIMITS.files} were read`);
  add("odd", "Binaries, hidden instructions, obfuscation", odd.length ? "flag" : "pass", odd.length ? odd : ["None found."]);
  if (bytes > LIMITS.repoBytes) add("size", "Size", "fail", [`Repository is over ${LIMITS.repoBytes / 1e6} MB; not scanned in full.`]);
  return R;
}

// ---------- the comment ----------
const WORD = { pass: "Pass", flag: "Look closer", fail: "Fail" };
// the label names say what was found, never "clean" or "safe"
export function overall(checks) { return checks.some((c) => c.status === "fail") ? "checks-failed" : checks.some((c) => c.status === "flag") ? "checks-flagged" : "no-flags-found"; }

export function renderComment({ page, sha, result, declared }) {
  const label = overall(result.checks);
  const lines = [MARKER, "### Automated checks", "",
    `Read-only checks on commit \`${safe(sha, 12)}\` of ${page ? `[${safe(page.replace("https://github.com/", ""), 80)}](${page}/tree/${safe(sha, 40)})` : "the submitted repository"}. **Nothing from the repository was run or installed.** These checks look for common problems. They do not prove a kit is safe, and they do not decide whether it is listed: a person does that.`, "",
    "| Check | Result |", "|---|---|", ...result.checks.map((c) => `| ${c.title} | ${WORD[c.status]} |`), ""];
  for (const c of result.checks.filter((x) => x.status !== "pass")) { lines.push(`**${c.title}: ${WORD[c.status]}**`); for (const n of c.notes) lines.push(`- ${n}`); lines.push(""); }
  lines.push(`Overall: **${label === "no-flags-found" ? "nothing found by these checks" : label === "checks-flagged" ? "some things for a person to look at" : "failed at least one check"}**. Files read: ${result.files}.`);
  lines.push("", "What these checks cannot see: code that builds a command or address at run time, anything fetched after install, obfuscated or encoded code, and whether the kit does what it says. This result applies to the commit above only. If the kit changes, the checks run again before anything is listed, and a listing is pinned to the commit a person reviewed.", "", "_Edit the issue to run the checks again._");
  void declared;
  return { text: lines.join("\n").slice(0, LIMITS.comment), label };
}

export function renderRefusal({ why, host }) {
  return { label: "needs-manual-review", text: [MARKER, "### Automated checks", "",
    `These checks only read public repositories at \`https://github.com/<owner>/<repo>\`, so this submission was not scanned (${safe(why, 80)}${host ? `; host: ${safe(host, 60)}` : ""}). A person will review it by hand. Edit the issue to give a GitHub link if there is one.`].join("\n") };
}

/**
 * Reads a public github.com repository (never runs it) and returns what the listing scripts need:
 * { refusal } when it cannot be scanned, otherwise { page, sha, label, text, owner, repo }.
 */
export function scanUrl(text, declared = "") {
  const r = repoUrl(text);
  if (!r.ok) return { refusal: renderRefusal(r) };
  const kb = repoSizeKb(r.owner, r.repo);
  if (kb !== null && kb > LIMITS.repoKb) return { refusal: renderRefusal({ why: `repository is about ${Math.round(kb / 1000)} MB, over the ${LIMITS.repoKb / 1000} MB limit for automatic checks` }) };
  const tmp = mkdtempSync(join(tmpdir(), "praxikit-sub-"));
  try {
    const sha = cloneRepo(r.clone, join(tmp, "repo"));
    const c = renderComment({ page: r.page, sha, result: scanDir(join(tmp, "repo"), declared), declared });
    return { page: r.page, sha, label: c.label, text: c.text, owner: r.owner, repo: r.repo };
  } catch (e) {
    return { refusal: { label: "checks-failed", text: [MARKER, "### Automated checks", "", `Could not fetch ${safe(r.page, 90)} (${safe(String(e.stderr ?? e.message).split("\n")[0], 100)}). Is the repository public? Edit the issue to run the checks again.`].join("\n") } };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- command line ----------
async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const out = arg("--out"), labelOut = arg("--label-out"), commitOut = arg("--commit-out");
  const emit = ({ text, label, sha }) => { if (commitOut) writeFileSync(commitOut, (/^[0-9a-f]{40}$/.test(String(sha ?? "")) ? String(sha).slice(0, 12) : "none") + "\n"); if (out) writeFileSync(out, text + "\n"); else console.log(text); if (labelOut) writeFileSync(labelOut, label + "\n"); else console.error(`label: ${label}`); };

  let declared = "", url = arg("--url"), dir = arg("--dir");
  const envName = arg("--issue-env");
  if (envName) {
    const form = parseIssue(process.env[envName] ?? "");
    declared = form["What does it read, write and send?"] ?? form["Anything to watch out for?"] ?? "";
    url = repoUrl(form["Repository link"] ?? form["Link"] ?? "");
    if (!url.ok) return emit(renderRefusal(url));
    url = url.page;
  }
  let page = null, sha = "local", tmp = null;
  if (url) { const r = repoUrl(url); if (!r.ok) return emit(renderRefusal(r)); page = r.page;
    const kb = repoSizeKb(r.owner, r.repo);
    if (kb !== null && kb > LIMITS.repoKb) return emit(renderRefusal({ why: `repository is about ${Math.round(kb / 1000)} MB, over the ${LIMITS.repoKb / 1000} MB limit for automatic checks` })); tmp = mkdtempSync(join(tmpdir(), "praxikit-sub-")); dir = join(tmp, "repo"); try { sha = cloneRepo(r.clone, dir); } catch (e) { rmSync(tmp, { recursive: true, force: true }); return emit({ label: "checks-failed", text: [MARKER, "### Automated checks", "", `Could not fetch ${safe(r.page, 90)} (${safe(String(e.stderr ?? e.message).split("\n")[0], 100)}). Is the repository public? Edit the issue to run the checks again.`].join("\n") }); } }
  if (!dir || !existsSync(dir)) { console.error("Give --issue-env, --url or --dir"); process.exit(2); }
  try { emit({ ...renderComment({ page, sha, result: scanDir(dir, declared), declared }), sha }); } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
