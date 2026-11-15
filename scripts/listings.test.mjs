#!/usr/bin/env node
// Tests listing validation, mapping from forms and inputs, and the publish step. No network.
// Run from the repo root: node scripts/listings.test.mjs
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseIssue } from "./check-submission.mjs";
import { entryFromIssue, entryFromDispatch, appendListing, clean, computeDrift } from "./listings.mjs";
import { validateListing } from "../site/listings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };
const tmp = mkdtempSync(join(tmpdir(), "praxikit-listings-"));
const SHA = "a".repeat(40);
const scanOk = { page: "https://github.com/o/r", sha: SHA, label: "no-flags-found", text: "<!-- praxikit-submission-check -->\n### Automated checks\nok" };
const good = { name: "Thing", url: "https://github.com/o/r", author: "someone", why: "It does a thing.", kind: "mcp", source: "recommended", added: "2026-11-15", commit: SHA, checks: "no-flags-found" };

// ---- validation
must(validateListing(good).length === 0, "a good entry validates");
for (const [label, bad] of [
  ["non-github url", { ...good, url: "https://evil.example/o/r" }], ["javascript url", { ...good, url: "javascript:alert(1)" }], ["http url", { ...good, url: "http://github.com/o/r" }],
  ["url with path", { ...good, url: "https://github.com/o/r/tree/main" }], ["dotdot", { ...good, url: "https://github.com/o/../r" }],
  ["bad kind", { ...good, kind: "malware" }], ["bad source", { ...good, source: "paid" }], ["short commit", { ...good, commit: "abc123" }],
  ["bad checks label", { ...good, checks: "safe" }], ["empty name", { ...good, name: "  " }], ["control char", { ...good, why: "a\u0000b" }], ["huge why", { ...good, why: "x".repeat(401) }],
  ["bad date", { ...good, added: "yesterday" }], ["extra field", { ...good, html: "<script>" }], ["bad issue", { ...good, issue: -1 }], ["not an object", null],
]) must(validateListing(bad).length > 0, `refused: ${label}`);

// ---- recommendation form -> entry
const recForm = parseIssue("### Name of the kit\n\nPlaywright MCP\n\n### Link\n\nhttps://github.com/o/r\n\n### Who made it?\n\nMicrosoft\n\n### Category\n\nMCP config\n\n### Why do you recommend it?\n\nBrowser automation for agents.\n\nIt worked well.\n");
const r1 = entryFromIssue(recForm, "opener", 7, scanOk, "2026-11-15");
must(r1.ok && r1.entry.source === "recommended" && r1.entry.kind === "mcp" && r1.entry.author === "Microsoft" && r1.entry.issue === 7 && r1.entry.commit === SHA && r1.entry.checks === "no-flags-found", `recommendation maps correctly: ${JSON.stringify(r1.entry ?? r1.reason)}`);
must(!r1.entry.why.includes("\n"), "multi-line text is collapsed to one line");

// ---- submission form -> entry (author is the issue opener)
const subForm = parseIssue("### Kit name\n\nShark Tank\n\n### Repository link\n\nhttps://github.com/o/r\n\n### What is it?\n\nSkill\n\n### What does it do, in two or three sentences?\n\nPitches an idea to a board.\n");
const r2 = entryFromIssue(subForm, "royal-programmer", 8, scanOk, "2026-11-15");
must(r2.ok && r2.entry.source === "community" && r2.entry.kind === "skill" && r2.entry.author === "royal-programmer", "submission maps to a community entry authored by the opener");

// ---- blocked cases never produce an entry
const failed = { ...scanOk, label: "checks-failed" };
must(!entryFromIssue(subForm, "a", 1, failed, "2026-11-15").ok, "failed checks block an approval");
const refused = { refusal: { label: "needs-manual-review", text: "<!-- praxikit-submission-check -->\nnot scanned" } };
const r3 = entryFromIssue(subForm, "a", 1, refused, "2026-11-15");
must(!r3.ok && r3.comment.includes("Not listed"), "an unscannable repository blocks listing and says why");
must(!entryFromIssue(parseIssue("### Kit name\n\nX\n\n### What is it?\n\nVirus\n\n### What does it do, in two or three sentences?\n\nw\n"), "a", 1, scanOk, "2026-11-15").ok, "an unknown type is not listed");

// ---- hostile text is carried as data, never dropped into the comment unsanitised
const hostile = parseIssue("### Kit name\n\n<img src=x onerror=1>[x](http://evil.example)\n\n### Repository link\n\nhttps://github.com/o/r\n\n### What is it?\n\nSkill\n\n### What does it do, in two or three sentences?\n\n@everyone [click](http://evil.example)\n");
const rh = entryFromIssue(hostile, "a", 1, { ...scanOk, label: "checks-failed" }, "2026-11-15");
must(!rh.ok && !rh.comment.includes("<img") && !rh.comment.includes("@everyone"), "blocked comment contains no raw hostile text");

// ---- admin dispatch
const env = { IN_NAME: "Tool", IN_URL: "x", IN_AUTHOR: "me", IN_WHY: "Because.", IN_KIND: "plugin", IN_SOURCE: "community" };
must(entryFromDispatch(env, scanOk, "2026-11-15").ok, "an admin add with a good scan is listed");
must(!entryFromDispatch(env, failed, "2026-11-15").ok, "failed checks block an admin add by default");
must(entryFromDispatch({ ...env, IN_ALLOW_FAILED: "true" }, failed, "2026-11-15").ok, "failed checks can be accepted explicitly by the admin");
must(!entryFromDispatch({ ...env, IN_KIND: "nope" }, scanOk, "2026-11-15").ok, "an invalid kind is refused for admins too");

// ---- approving what was reviewed, and clean-only direct publishing
{
  const withCommit = { ...scanOk, sha: "1f837447b20bb6f0e72d87b80ece1c221c362c7d" };
  must(entryFromDispatch({ ...env, IN_EXPECT_COMMIT: "1f837447b20b" }, withCommit, "2026-11-15").ok, "the repository still at the reviewed commit (a 12-character prefix) is listed");
  const moved = entryFromDispatch({ ...env, IN_EXPECT_COMMIT: "abcdef012345" }, withCommit, "2026-11-15");
  must(!moved.ok && /changed since the checks that were reviewed/.test(moved.reason), "a repository that moved on since the reviewed checks is refused");
  must(!entryFromDispatch({ ...env, IN_EXPECT_COMMIT: "not-a-sha!" }, withCommit, "2026-11-15").ok, "a malformed expected commit is refused");
  must(entryFromDispatch({ ...env, IN_EXPECT_COMMIT: "" }, withCommit, "2026-11-15").ok, "no expected commit means no pin");
  const flagged = { ...scanOk, label: "checks-flagged" };
  must(!entryFromDispatch({ ...env, IN_REQUIRE_CLEAN: "true" }, flagged, "2026-11-15").ok, "direct publishing refuses a result with anything to look at");
  must(entryFromDispatch({ ...env, IN_REQUIRE_CLEAN: "true" }, scanOk, "2026-11-15").ok, "direct publishing accepts a result with nothing found");
  must(entryFromDispatch({ ...env, IN_REQUIRE_CLEAN: "false" }, flagged, "2026-11-15").ok, "an approval after the checks were read may publish a flagged result");
}

// ---- duplicates
let dup = false; try { appendListing([good], { ...good, url: "https://github.com/O/R" }); } catch { dup = true; }
must(dup, "the same repository cannot be listed twice, whatever its case");
must(appendListing([], good).length === 1, "append works on an empty list");
must(clean("a\u0000b\n c   d", 10) === "a b c d", "clean() collapses whitespace and control characters");

// ---- publish step: validates again, appends, refuses duplicates
const list = join(tmp, "listings.json"), entryFile = join(tmp, "entry.json");
const run = (...a) => spawnSync("node", [join(here, "listings.mjs"), ...a], { encoding: "utf8" });
writeFileSync(list, "[]\n"); writeFileSync(entryFile, JSON.stringify(good));
let p = run("publish", "--entry", entryFile, "--file", list);
must(p.status === 0 && JSON.parse(readFileSync(list, "utf8")).length === 1, `publish appends: ${p.stderr}`);
p = run("publish", "--entry", entryFile, "--file", list);
must(p.status === 4 && JSON.parse(readFileSync(list, "utf8")).length === 1, "publishing twice is refused and changes nothing");
writeFileSync(entryFile, JSON.stringify({ ...good, url: "https://evil.example/x" }));
p = run("publish", "--entry", entryFile, "--file", list);
must(p.status === 3 && JSON.parse(readFileSync(list, "utf8")).length === 1, "an invalid entry is refused at publish time even if a scan produced it");

// ---- removal: takes the entry out, logs one validated row, refuses unknown repositories
{
  const list2 = join(tmp, "list2.json"), log = join(tmp, "removals.md");
  writeFileSync(list2, JSON.stringify([{ ...good, name: "Thing | with <b>pipe</b>\nnewline" }, { ...good, name: "Other", url: "https://github.com/o/keep" }]));
  let r = run("remove", "--url", "https://github.com/O/R/", "--reason", "malicious", "--note", "line1\nline2 | x", "--file", list2, "--log", log);
  const after = JSON.parse(readFileSync(list2, "utf8"));
  must(r.status === 0 && after.length === 1 && after[0].url === "https://github.com/o/keep", `removal drops only that repository: ${r.stderr}`);
  const text = readFileSync(log, "utf8");
  const rows = text.split("\n").filter((l) => l.startsWith("| 20"));
  must(rows.length === 1 && rows[0].split("|").length === 7 && rows[0].includes("malicious"), "the log gets exactly one well-formed row, whatever the name and note contain");
  must(text.startsWith("# Removed listings") && text.includes("| Date | Name |"), "a new log gets its header");
  r = run("remove", "--url", "https://github.com/o/nothere", "--reason", "other", "--file", list2, "--log", log);
  must(r.status === 4 && JSON.parse(readFileSync(list2, "utf8")).length === 1, "removing something that is not listed is refused and changes nothing");
  r = run("remove", "--url", "https://github.com/o/keep", "--reason", "because", "--file", list2, "--log", log);
  must(r.status === 2, "an unknown reason is refused");
}

// ---- replace: a re-review swaps the entry in place; without the flag a duplicate is still refused
{
  const re = appendListing([good, { ...good, url: "https://github.com/o/other" }], { ...good, commit: "b".repeat(40), checks: "checks-flagged" }, true);
  must(re.length === 2 && re[0].commit === "b".repeat(40) && re[0].checks === "checks-flagged" && re[1].url === "https://github.com/o/other", "replace swaps the existing entry in place and keeps the others");
  let still = false; try { appendListing([good], good, false); } catch { still = true; }
  must(still, "without replace a duplicate is still refused");
}

// ---- drift: reviewed commit vs the repository's current default branch (gh is faked)
{
  const mk = (url, c = SHA) => ({ ...good, url, commit: c });
  const L = [mk("https://github.com/o/same"), mk("https://github.com/o/moved"), mk("https://github.com/o/gone"), mk("https://github.com/o/rewritten"), mk("https://github.com/o/flaky"), mk("https://github.com/o/limited")];
  const err = (stderr) => Object.assign(new Error("gh failed"), { stderr });
  const fake = (args) => {
    const path = args[1], repo = path.split("/")[2];
    const isCompare = path.includes("/compare/");
    if (repo === "gone" && !isCompare) throw err("gh: Not Found (HTTP 404)");
    if (repo === "flaky") throw err("Post https://api.github.com: net/http: TLS handshake timeout");
    if (repo === "limited" && isCompare) throw err("gh: API rate limit exceeded (HTTP 403)");
    if (!isCompare) return "main\n";
    if (repo === "same") return "0\n";
    if (repo === "moved") return "7\n";
    if (repo === "rewritten") throw err("gh: No common ancestor between the commits (HTTP 404)");
    return "0\n";
  };
  const d = computeDrift(L, { "https://github.com/o/flaky": "same", "https://github.com/o/limited": "changed", "https://github.com/o/not-listed-any-more": "changed" }, fake);
  must(d["https://github.com/o/same"] === "same" && d["https://github.com/o/moved"] === "changed", "same commit is 'same', commits ahead is 'changed'");
  must(d["https://github.com/o/gone"] === "unreachable", "a repository that returns 404 is 'unreachable'");
  must(d["https://github.com/o/rewritten"] === "changed", "a reviewed commit that is no longer in history is 'changed'");
  must(d["https://github.com/o/flaky"] === "same" && d["https://github.com/o/limited"] === "changed", "a network or rate-limit failure keeps the previous answer instead of flipping it");
  must(!("https://github.com/o/not-listed-any-more" in d), "entries that are no longer listed are dropped");
  const none = computeDrift([mk("https://github.com/o/flaky")], {}, fake);
  must(Object.keys(none).length === 0, "a transient failure with no previous answer records nothing");
  // only validated github.com urls are ever turned into API paths
  const seen = []; computeDrift([mk("https://evil.example/x/y"), mk("https://github.com/o/ok")], {}, (a) => { seen.push(a[1]); return a[1].includes("/compare/") ? "0" : "main"; });
  must(seen.every((p) => p.startsWith("repos/o/ok")), "only github.com repositories are queried");
  must(seen.some((p) => p.includes(`/compare/${SHA}...main`)), "the compare call uses the reviewed commit and the default branch");
}

// ---- scan step on a link it will not fetch: blocked, no entry, no network
const out = join(tmp, "out");
const s = spawnSync("node", [join(here, "listings.mjs"), "scan", "--mode", "issue", "--out-dir", out], { encoding: "utf8", env: { ...process.env, ISSUE_BODY: "### Kit name\n\nX\n\n### Repository link\n\nhttps://gitlab.com/a/b\n", ISSUE_AUTHOR: "a", ISSUE_NUMBER: "3" } });
must(s.status === 0 && readFileSync(join(out, "status.txt"), "utf8").trim() === "blocked" && !existsSync(join(out, "entry.json")), "a non-GitHub link is blocked with no entry");
must(readFileSync(join(out, "comment.md"), "utf8").includes("Not listed") && readFileSync(join(out, "label.txt"), "utf8").trim() === "needs-manual-review", "the blocked comment and label are written");

rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: listings validate strictly, map from forms and admin inputs, block failed or unscannable repos, refuse duplicates, and publish only valid entries");
