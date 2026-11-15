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
  };
  return finish(entry, scan, String(env.IN_ALLOW_FAILED) === "true");
}

/** Returns the list with the entry added; refuses a repository that is already listed. */
export function appendListing(list, entry) {
  if (list.some((x) => sameRepo(x.url, entry.url))) throw new Error("already listed");
  return [...list, entry];
}

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
    try { next = appendListing(list, entry); } catch (e) { console.error(String(e.message)); process.exit(4); }
    writeFileSync(listFile, JSON.stringify(next, null, 2) + "\n");
    console.log(`listed: ${entry.url} at ${entry.commit.slice(0, 7)}`);
    return;
  }

  console.error("usage: listings.mjs scan|publish ...");
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
