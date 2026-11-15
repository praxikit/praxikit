#!/usr/bin/env node
/**
 * Builds and publishes catalogue listings. Two steps, so that the step that reads untrusted
 * repositories never holds write access:
 *
 *   node scripts/listings.mjs scan    --mode issue|dispatch --out-dir DIR
 *       Reads the submission (issue form body in ISSUE_BODY, or workflow inputs in IN_*), scans the
 *       linked public GitHub repository without running it, and writes DIR/entry.json (only when the
 *       entry may be listed), DIR/comment.md, DIR/label.txt and DIR/status.txt ("ok" or "blocked").
 *
 *   node scripts/listings.mjs publish --entry DIR/entry.json --file site/listings.json
 *       Treats the entry as untrusted data: validates it again, refuses duplicates, appends it.
 *
 * Nothing here decides who may approve; the workflows check that before these run.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseIssue, scanUrl, safe, MARKER } from "./check-submission.mjs";
import { validateListing, sameRepo } from "../site/listings.mjs";

export const KIND_BY_LABEL = { Plugin: "plugin", Skill: "skill", Agent: "agent", Hook: "hook", "MCP config": "mcp", Template: "template", Adapter: "adapter" };

/** One line of plain text: whitespace collapsed, control characters dropped, length capped. */
export const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

const blocked = (reason, comment) => ({ ok: false, reason, comment: `${comment}\n\n**Not listed:** ${safe(reason, 200)}\n` });

function finish(entry, scan, allowFailed) {
  if (scan.refusal) return blocked("the repository could not be scanned, so there is no commit to pin the listing to", scan.refusal.text);
  if (scan.label === "checks-failed" && !allowFailed) return blocked("the automatic checks failed", scan.text);
  const problems = validateListing(entry);
  if (problems.length) return blocked(`the entry is not valid (${problems.join("; ")})`, scan.text);
  return { ok: true, entry, comment: scan.text, label: scan.label };
}

/** Maps an approved issue form (submission or recommendation) and its scan to a listing entry. */
export function entryFromIssue(form, author, issue, scan, today) {
  const recommend = "Name of the kit" in form;
  const entry = {
    name: clean(form["Kit name"] ?? form["Name of the kit"], 80),
    url: scan.page ?? "",
    author: recommend ? clean(form["Who made it?"], 80) : clean(author, 80),
    why: clean(recommend ? form["Why do you recommend it?"] : form["What does it do, in two or three sentences?"], 400),
    kind: KIND_BY_LABEL[clean(form["What is it?"] ?? form["Category"], 40)] ?? "",
    source: recommend ? "recommended" : "community",
    added: today,
    commit: scan.sha ?? "",
    checks: scan.label ?? "needs-manual-review",
    ...(Number.isInteger(issue) && issue > 0 ? { issue } : {}),
  };
  return finish(entry, scan, false);
}

/** Maps the admin "Add listing" workflow inputs and their scan to a listing entry. */
export function entryFromDispatch(env, scan, today) {
  const entry = {
    name: clean(env.IN_NAME, 80), url: scan.page ?? "", author: clean(env.IN_AUTHOR, 80), why: clean(env.IN_WHY, 400),
    kind: clean(env.IN_KIND, 20), source: clean(env.IN_SOURCE, 20), added: today, commit: scan.sha ?? "", checks: scan.label ?? "needs-manual-review",
    // "I use this": the owner's pick, with a note on how
    ...(String(env.IN_PICK) === "true" ? { pick: true, note: clean(env.IN_NOTE, 200) } : {}),
  };
  // approving what was reviewed: the repository must still be at the commit whose checks the maintainer read
  const expect = clean(env.IN_EXPECT_COMMIT, 40).toLowerCase();
  if (expect && !/^[0-9a-f]{7,40}$/.test(expect)) return blocked("the commit the checks were run on is not valid", scan.text ?? scan.refusal?.text ?? "");
  if (expect && !scan.refusal && !String(scan.sha ?? "").startsWith(expect)) return blocked("the repository changed since the checks that were reviewed. Run the checks again and read them before approving", scan.text);
  // direct publishing has no human reading the result, so only a result with nothing to look at may go through
  if (String(env.IN_REQUIRE_CLEAN) === "true" && !scan.refusal && scan.label !== "no-flags-found") return blocked("the checks found things for a person to read, so it cannot be published without that review", scan.text);
  return finish(entry, scan, String(env.IN_ALLOW_FAILED) === "true");
}

/**
 * Returns the list with the entry added; refuses a repository that is already listed, unless
 * `replace` is true, in which case the existing entry is replaced in place (a re-review).
 */
export function appendListing(list, entry, replace = false) {
  const at = list.findIndex((x) => sameRepo(x.url, entry.url));
  if (at >= 0 && !replace) throw new Error("already listed");
  if (at >= 0) return list.map((x, i) => (i === at ? entry : x));
  return [...list, entry];
}

/**
 * Compares each listing's reviewed commit with its repository's current default branch through the
 * GitHub API. `run(args)` runs `gh` and returns stdout or throws an error with `.stderr`.
 * Returns { url: "same" | "changed" | "unreachable" }. A transient failure (network, rate limit)
 * keeps the previous answer instead of flipping a listing.
 */
export function computeDrift(list, previous, run) {
  const gone = (e) => /HTTP 404|Not Found/i.test(String(e?.stderr ?? e?.message ?? ""));
  const out = {};
  for (const l of list) {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(l.url);
    if (!m) continue;
    const [, owner, repo] = m;
    const keep = () => { if (previous && typeof previous[l.url] === "string") out[l.url] = previous[l.url]; };
    let branch;
    try {
      branch = String(run(["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"])).trim();
      if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch)) { keep(); continue; }
    } catch (e) { if (gone(e)) out[l.url] = "unreachable"; else keep(); continue; }
    try {
      const ahead = String(run(["api", `repos/${owner}/${repo}/compare/${l.commit}...${branch}`, "--jq", ".ahead_by"])).trim();
      if (/^\d+$/.test(ahead)) out[l.url] = ahead === "0" ? "same" : "changed"; else keep();
    } catch (e) { if (gone(e)) out[l.url] = "changed"; else keep(); } // the reviewed commit is no longer in its history
  }
  return out;
}

export const REASONS = ["malicious", "secret", "licence", "misleading", "unmaintained", "owner-request", "other"];

/** Removes the entry for a repository. Returns { list, removed } where removed is null if it was not listed. */
export function removeListing(list, url) {
  const removed = list.find((x) => sameRepo(x.url, url)) ?? null;
  return { list: list.filter((x) => !sameRepo(x.url, url)), removed };
}

/** One row of the public removal log. Only validated fields and a cleaned short note go in. */
export function removalRow(entry, reason, note, today) {
  const cell = (s) => String(s).replace(/[|\r\n]/g, " ");
  return `| ${today} | ${cell(clean(entry.name, 80))} | ${cell(entry.url)} | ${reason} | ${cell(clean(note, 160))} |`;
}

const LOG_HEADER = "# Removed listings\n\nEvery listing taken off the catalogue, with the date and the reason category. Entries are added by the `remove-listing` workflow.\n\n| Date | Name | Repository | Reason | Note |\n|---|---|---|---|---|\n";

function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const cmd = process.argv[2];
  const today = new Date().toISOString().slice(0, 10);

  if (cmd === "scan") {
    const mode = arg("--mode"), dir = arg("--out-dir");
    if (!dir || !["issue", "dispatch"].includes(mode)) { console.error("scan needs --mode issue|dispatch and --out-dir"); process.exit(2); }
    mkdirSync(dir, { recursive: true });
    let result;
    if (mode === "issue") {
      const form = parseIssue(process.env.ISSUE_BODY ?? "");
      const declared = form["What does it read, write and send?"] ?? form["Anything to watch out for?"] ?? "";
      const scan = scanUrl(form["Repository link"] ?? form.Link ?? "", declared);
      result = entryFromIssue(form, process.env.ISSUE_AUTHOR ?? "", Number(process.env.ISSUE_NUMBER), scan, today);
    } else {
      const scan = scanUrl(process.env.IN_URL ?? "", "");
      result = entryFromDispatch(process.env, scan, today);
    }
    writeFileSync(join(dir, "comment.md"), result.comment.startsWith(MARKER) ? result.comment : `${MARKER}\n${result.comment}`);
    writeFileSync(join(dir, "label.txt"), (result.label ?? "needs-manual-review") + "\n");
    writeFileSync(join(dir, "status.txt"), result.ok ? "ok\n" : "blocked\n");
    if (result.ok) writeFileSync(join(dir, "entry.json"), JSON.stringify(result.entry, null, 2) + "\n");
    console.log(result.ok ? `ok: ${result.entry.name}` : `blocked: ${result.reason}`);
    return;
  }

  if (cmd === "publish") {
    const entryFile = arg("--entry"), listFile = arg("--file");
    if (!entryFile || !listFile) { console.error("publish needs --entry and --file"); process.exit(2); }
    const entry = JSON.parse(readFileSync(entryFile, "utf8"));
    const problems = validateListing(entry);
    if (problems.length) { console.error("refusing to publish: " + problems.join("; ")); process.exit(3); }
    const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : [];
    let next;
    try { next = appendListing(list, entry, process.argv.includes("--replace")); } catch (e) { console.error(String(e.message)); process.exit(4); }
    writeFileSync(listFile, JSON.stringify(next, null, 2) + "\n");
    console.log(`listed: ${entry.url} at ${entry.commit.slice(0, 7)}`);
    return;
  }

  if (cmd === "drift") {
    const listFile = arg("--file"), outFile = arg("--out");
    if (!listFile || !outFile) { console.error("drift needs --file and --out"); process.exit(2); }
    const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : [];
    for (const l of list) if (validateListing(l).length) { console.error("listings.json has an invalid entry; not checking"); process.exit(3); }
    let previous = {};
    try { previous = JSON.parse(readFileSync(outFile, "utf8")); } catch { /* first run */ }
    const run = (args) => execFileSync("gh", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    const next = computeDrift(list, previous, run);
    // stable key order, so the file only changes when a status changes
    const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(outFile, JSON.stringify(sorted, null, 2) + "\n");
    const n = Object.values(sorted);
    console.log(`checked ${list.length} listing(s): ${n.filter((s) => s === "same").length} same, ${n.filter((s) => s === "changed").length} changed, ${n.filter((s) => s === "unreachable").length} unreachable`);
    return;
  }

  if (cmd === "remove") {
    const url = arg("--url"), reason = arg("--reason"), note = arg("--note") ?? "", listFile = arg("--file"), logFile = arg("--log");
    if (!url || !listFile || !logFile || !REASONS.includes(reason)) { console.error(`remove needs --url, --file, --log and --reason (${REASONS.join(", ")})`); process.exit(2); }
    const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : [];
    const { list: next, removed } = removeListing(list, url);
    if (!removed) { console.error("that repository is not listed"); process.exit(4); }
    writeFileSync(listFile, JSON.stringify(next, null, 2) + "\n");
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : LOG_HEADER;
    writeFileSync(logFile, log.replace(/\n*$/, "\n") + removalRow(removed, reason, note, today) + "\n");
    console.log(`removed: ${removed.url} (${reason})`);
    return;
  }

  console.error("usage: listings.mjs scan|publish|remove ...");
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
