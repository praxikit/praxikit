#!/usr/bin/env node
// Tests listing validation, mapping from forms and inputs, and the publish step. No network.
// Run from the repo root: node scripts/listings.test.mjs
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseIssue } from "./check-submission.mjs";
import { entryFromIssue, entryFromDispatch, appendListing, clean, computeDrift, editListing, computeMetrics, roundStars, weekOf, byHandScan, touchesRunning, newlyNeedingReview } from "./listings.mjs";
import { validateListing, healthScore, isNew, fmtStars, validMetric } from "../site/listings.mjs";

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

// ---- picks: the owner uses it, and says how
must(validateListing({ ...good, pick: true, note: "I use it for browser tests every week." }).length === 0, "a pick with a note validates");
for (const [label, bad] of [["pick without a note", { ...good, pick: true }], ["pick with an empty note", { ...good, pick: true, note: " " }], ["pick with a long note", { ...good, pick: true, note: "x".repeat(201) }], ["pick that is not true", { ...good, pick: "yes", note: "n" }], ["pick: false", { ...good, pick: false }], ["note without a pick", { ...good, note: "n" }], ["note with a control character", { ...good, pick: true, note: "a\u0000b" }]])
  must(validateListing(bad).length > 0, `refused: ${label}`);
{
  const withPick = entryFromDispatch({ IN_NAME: "Tool", IN_URL: "x", IN_AUTHOR: "me", IN_WHY: "Because.", IN_KIND: "plugin", IN_SOURCE: "community", IN_PICK: "true", IN_NOTE: "I use it\nevery day." }, scanOk, "2026-11-15");
  must(withPick.ok && withPick.entry.pick === true && withPick.entry.note === "I use it every day.", "a pick passes through with its note cleaned to one line");
  must(!entryFromDispatch({ IN_NAME: "Tool", IN_URL: "x", IN_AUTHOR: "me", IN_WHY: "Because.", IN_KIND: "plugin", IN_SOURCE: "community", IN_PICK: "true", IN_NOTE: "" }, scanOk, "2026-11-15").ok, "a pick without a note is refused");
  const plain = entryFromDispatch({ IN_NAME: "Tool", IN_URL: "x", IN_AUTHOR: "me", IN_WHY: "Because.", IN_KIND: "plugin", IN_SOURCE: "community", IN_PICK: "false", IN_NOTE: "ignored" }, scanOk, "2026-11-15");
  must(plain.ok && !("pick" in plain.entry) && !("note" in plain.entry), "without the pick flag, the note is dropped");
}

// ---- tags
import { parseTags } from "../site/listings.mjs";
must(JSON.stringify(parseTags("Planning, model routing; SEO\nplanning")) === JSON.stringify(["planning", "model-routing", "seo"]), "tags are lowercased, hyphenated, de-duplicated and split on commas, semicolons and lines");
must(parseTags("a, <script>alert(1)</script>, ok-tag, -x-, " + "y".repeat(40)).join("|") === "script-alert-1-script|ok-tag|" + "y".repeat(24), "markup and odd characters become plain hyphenated words, and long ones are cut");
must(parseTags(Array.from({ length: 30 }, (_, i) => "tag" + i).join(",")).length === 12 && parseTags("").length === 0 && parseTags(null).length === 0 && parseTags("a,b,!!!").length === 0, "at most 12 tags; nothing in, nothing out; one-letter and empty ones are dropped");
must(validateListing({ ...good, tags: ["planning", "model-routing"] }).length === 0, "an entry with tags validates");
for (const [label, bad] of [["no tags in the list", { ...good, tags: [] }], ["13 tags", { ...good, tags: Array.from({ length: 13 }, (_, i) => "tag" + i) }], ["an upper-case tag", { ...good, tags: ["Planning"] }], ["a tag with a space", { ...good, tags: ["a b"] }], ["a repeated tag", { ...good, tags: ["abc", "abc"] }], ["a tag that is not text", { ...good, tags: [5] }], ["tags that are not a list", { ...good, tags: "planning" }]])
  must(validateListing(bad).length > 0, `refused: ${label}`);
{
  const e = entryFromDispatch({ IN_NAME: "T", IN_URL: "x", IN_WHY: "w", IN_KIND: "skill", IN_SOURCE: "community", IN_TAGS: "Marketing, SEO tools" }, { ...scanOk, owner: "coreyhaines31" }, "2026-11-15");
  must(e.ok && e.entry.author === "coreyhaines31" && e.entry.tags.join() === "marketing,seo-tools", "the author is the repository's owner when none is given, and tags come through cleaned");
  const none = entryFromDispatch({ IN_NAME: "T", IN_URL: "x", IN_WHY: "w", IN_KIND: "skill", IN_SOURCE: "community", IN_TAGS: "" }, { ...scanOk, owner: "someone" }, "2026-11-15");
  must(none.ok && !("tags" in none.entry), "no tags means no tags field");
}

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

// ---- drift: reviewed commit vs the repository's current default branch (gh is faked): same, newer commits, needs re-review, unreachable
{
  const mk = (url, c = SHA) => ({ ...good, url, commit: c });
  const U = (n) => "https://github.com/o/" + n;
  const L = ["same", "docs", "hooks", "mcp", "pkg", "many", "gone", "rewritten", "flaky", "limited", "oldnum"].map((n) => mk(U(n)));
  const err = (stderr) => Object.assign(new Error("gh failed"), { stderr });
  const cmp = (ahead, files) => JSON.stringify({ ahead, files });
  const fake = (args) => {
    const path = args[1], repo = path.split("/")[2];
    const isCompare = path.includes("/compare/");
    if (repo === "gone" && !isCompare) throw err("gh: Not Found (HTTP 404)");
    if (repo === "flaky") throw err("Post https://api.github.com: net/http: TLS handshake timeout");
    if (repo === "limited" && isCompare) throw err("gh: API rate limit exceeded (HTTP 403)");
    if (!isCompare) return "main\n";
    if (repo === "same") return cmp(0, []);
    if (repo === "docs") return cmp(7, ["README.md", "docs/installation.md", "skills/new/SKILL.md", "src/index.ts", "package-lock.json"]);
    if (repo === "hooks") return cmp(2, ["README.md", "hooks/hooks.json"]);
    if (repo === "mcp") return cmp(1, [".mcp.json"]);
    if (repo === "pkg") return cmp(3, ["packages/cli/package.json"]);
    if (repo === "many") return cmp(40, Array.from({ length: 300 }, (_, k) => "f" + k + ".md"));
    if (repo === "rewritten") throw err("gh: No common ancestor between the commits (HTTP 404)");
    if (repo === "oldnum") return "7\n"; // not JSON: an unexpected answer is kept as it was, never guessed
    return cmp(0, []);
  };
  const before = { [U("flaky")]: "same", [U("limited")]: "review", [U("oldnum")]: "same", [U("not-listed-any-more")]: "review" };
  const d = computeDrift(L, before, fake);
  must(d[U("same")] === "same", "same commit is 'same'");
  must(d[U("docs")] === "newer", "newer commits that touch only docs, instructions, source and lockfiles are 'newer': a quiet note, no re-review");
  must(d[U("hooks")] === "review" && d[U("mcp")] === "review" && d[U("pkg")] === "review", "newer commits that touch hooks, MCP configuration or a package manifest need re-review");
  must(d[U("many")] === "review", "too many changed files to judge from their names need re-review");
  must(d[U("gone")] === "unreachable", "a repository that returns 404 is 'unreachable'");
  must(d[U("rewritten")] === "review", "a reviewed commit that is no longer in history needs re-review");
  must(d[U("flaky")] === "same" && d[U("limited")] === "review" && d[U("oldnum")] === "same", "a network failure, a rate limit or an answer we cannot read keeps the previous answer instead of flipping it");
  must(!(U("not-listed-any-more") in d), "entries that are no longer listed are dropped");
  const none = computeDrift([mk(U("flaky"))], {}, fake);
  must(Object.keys(none).length === 0, "a transient failure with no previous answer records nothing");
  // only validated github.com urls are ever turned into API paths
  const seen = []; computeDrift([mk("https://evil.example/x/y"), mk("https://github.com/o/ok")], {}, (a) => { seen.push(a[1]); return a[1].includes("/compare/") ? cmp(0, []) : "main"; });
  must(seen.every((p) => p.startsWith("repos/o/ok")), "only github.com repositories are queried");
  must(seen.some((p) => p.includes(`/compare/${SHA}...main`)), "the compare call uses the reviewed commit and the default branch");
  // what counts as files that run code, and the owner's alert for the ones that newly need re-review
  must(touchesRunning([{ f: "package.json", p: "@@\n-  \"version\": \"1.0.0\"\n+  \"version\": \"1.0.1\"" }, { f: "plugin.json", p: "@@\n+  \"hooks\": \"x\"" }, { f: "package.json", p: "@@\n+  \"scripts\": { \"postinstall\": \"x\" }" }, { f: "server.json" }]).length === 3, "a manifest counts only when its patch touches what runs, or when there is no patch to read");
  must(touchesRunning(["README.md", "hooks/x.json", "scripts/install.sh", "docs/installation.md", "skills/a/SKILL.md", ".claude-plugin/plugin.json", "src/app.ts"]).join() === "hooks/x.json,scripts/install.sh,.claude-plugin/plugin.json", "files that run code are named by what they are, not by a word in the name");
  const names = newlyNeedingReview([{ ...good, url: U("a"), name: "A" }, { ...good, url: U("b"), name: "B" }, { ...good, url: U("c"), name: "C" }, { ...good, url: U("d"), name: "D" }], { [U("a")]: "same", [U("b")]: "review", [U("c")]: "changed" }, { [U("a")]: "review", [U("b")]: "review", [U("c")]: "review", [U("d")]: "newer" });
  must(names.join() === "A", "the owner is told only about kits that newly need re-review (a kit already waiting, or a legacy 'changed', is not told again)");
}

// ---- the workflow linter we pin allows at most 10 inputs on a manually started workflow; count them here so the limit shows up before CI does
{
  const { readdirSync } = await import("node:fs");
  const dir = join(here, "..", ".github", "workflows");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
    const text = readFileSync(join(dir, f), "utf8");
    // walk the lines: inputs are the keys indented six spaces under workflow_dispatch, up to the next key at a lower indent
    let inDispatch = false, n = 0;
    for (const line of text.split(/\r?\n/)) {
      if (/^  workflow_dispatch:/.test(line)) { inDispatch = true; continue; }
      if (inDispatch && /^ {0,2}\S/.test(line)) break;
      if (inDispatch && /^      [A-Za-z_][A-Za-z0-9_]*:\s*$/.test(line)) n++;
    }
    must(n <= 10, `${f} has ${n} workflow_dispatch inputs; the pinned actionlint allows 10`);
  }
}

// ---- scan step on a link it will not fetch: blocked, no entry, no network
const out = join(tmp, "out");
const s = spawnSync("node", [join(here, "listings.mjs"), "scan", "--mode", "issue", "--out-dir", out], { encoding: "utf8", env: { ...process.env, ISSUE_BODY: "### Kit name\n\nX\n\n### Repository link\n\nhttps://gitlab.com/a/b\n", ISSUE_AUTHOR: "a", ISSUE_NUMBER: "3" } });
must(s.status === 0 && readFileSync(join(out, "status.txt"), "utf8").trim() === "blocked" && !existsSync(join(out, "entry.json")), "a non-GitHub link is blocked with no entry");
must(readFileSync(join(out, "comment.md"), "utf8").includes("Not listed") && readFileSync(join(out, "label.txt"), "utf8").trim() === "needs-manual-review", "the blocked comment and label are written");

// ---- editing a live listing
{
  const base = { name: "Kit", url: "https://github.com/o/r", author: "o", why: "Does a thing.", kind: "skill", source: "community", added: "2026-11-15", commit: "a".repeat(40), checks: "no-flags-found", tags: ["old"] };
  const other = { ...base, url: "https://github.com/o/other", name: "Other" };
  const r = editListing([base, other], "https://github.com/O/R/", { name: "  New   name ", why: "Better text.", tags: "Planning, model routing", note: "I use it daily" });
  must(r.after.name === "New name" && r.after.why === "Better text." && JSON.stringify(r.after.tags) === JSON.stringify(["planning", "model-routing"]), "name, text and tags are cleaned and replaced");
  must(r.after.pick === true && r.after.note === "I use it daily", "a note makes it a pick");
  must(r.after.commit === base.commit && r.after.checks === base.checks && r.after.source === base.source && r.after.author === base.author && r.after.added === base.added && r.after.url === base.url, "what was reviewed never changes");
  must(r.list.length === 2 && r.list[1] === other, "other listings are untouched and order is kept");
  const un = editListing([r.after], base.url, { name: "", why: "", tags: "", note: "" });
  must(!("pick" in un.after) && !("note" in un.after) && !("tags" in un.after) && un.after.name === "New name", "an empty note un-picks, empty tags clear them, empty name or text keep the old ones");
  let threw = false; try { editListing([base], "https://github.com/x/y", { name: "a" }); } catch { threw = true; }
  must(threw, "editing a repository that is not listed is refused");
  threw = false; try { editListing([base], base.url, { why: "x".repeat(900), note: "n" }); editListing([{ ...base, kind: "bogus" }], base.url, { name: "a" }); } catch { threw = true; }
  must(threw, "an edit that leaves an invalid entry is refused");
  // the command-line path writes the file and leaves it valid
  const f = join(tmp, "edit-list.json");
  writeFileSync(f, JSON.stringify([base]));
  const ok = spawnSync("node", [join(here, "listings.mjs"), "edit", "--url", base.url, "--name", "Via CLI", "--why", "CLI text.", "--tags", "a-tag", "--note", "", "--file", f], { encoding: "utf8" });
  const after = JSON.parse(readFileSync(f, "utf8"));
  must(ok.status === 0 && after[0].name === "Via CLI" && after[0].tags[0] === "a-tag" && !after[0].pick && validateListing(after[0]).length === 0, "the edit command writes a valid file");
  const no = spawnSync("node", [join(here, "listings.mjs"), "edit", "--url", "https://github.com/x/y", "--name", "n", "--file", f], { encoding: "utf8" });
  must(no.status === 4, "the edit command fails for an unlisted repository");
}

// ---- what the check found is kept with the listing, in a fixed shape
{
  const found = { files: 120, checks: [{ id: "shape", status: "pass", note: "" }, { id: "network", status: "flag", note: "3 line(s) in code that look like network access:" }, { id: "secrets", status: "pass", note: "" }] };
  const withFound = { ...good, found };
  must(validateListing(withFound).length === 0, "a listing may carry what the check found");
  must(validateListing({ ...good, found: { files: 1, checks: [{ id: "shape", status: "pass", note: "<script>x</script>" }] } }).length > 0, "markup in a note is refused");
  must(validateListing({ ...good, found: { files: 1, checks: [{ id: "weird", status: "pass", note: "" }] } }).length > 0, "only known checks are accepted");
  must(validateListing({ ...good, found: { files: 1, checks: [{ id: "shape", status: "great", note: "" }] } }).length > 0, "only pass, flag and fail are results");
  must(validateListing({ ...good, found: { files: 1, checks: [{ id: "shape", status: "pass", note: "" }, { id: "shape", status: "pass", note: "" }] } }).length > 0, "a check is listed once");
  must(validateListing({ ...good, found: { files: 1, checks: [{ id: "shape", status: "pass", note: "x".repeat(200) }] } }).length > 0, "notes are short");
  const viaDispatch = entryFromDispatch({ ...env, IN_URL: "https://github.com/o/r" }, { ...scanOk, found }, "2026-11-15");
  must(viaDispatch.ok && viaDispatch.entry.found.checks.length === 3, "the entry made from a scan keeps what it found");
  const without = entryFromDispatch({ ...env, IN_URL: "https://github.com/o/r" }, scanOk, "2026-11-15");
  must(without.ok && !("found" in without.entry), "a scan with no detail adds none");
  const edited = editListing([withFound], withFound.url, { name: "Renamed", why: "", tags: "", note: "" });
  must(edited.after.found?.files === 120, "editing the wording keeps what the check found");
  must(appendListing([withFound], { ...withFound, commit: "b".repeat(40) }, true)[0].commit === "b".repeat(40), "a re-review replaces the entry, record included");
}

// ---- approval by hand: only when the automatic scan refused to read the repository
{
  const refusal = { refusal: { text: "repository is about 203 MB, over the 100 MB limit for automatic checks" }, text: "x" };
  const run = (args) => { if (args[1] === "repos/o/big") return "main\n"; if (args[1] === "repos/o/big/commits/main") return SHA + "\n"; throw new Error("not found"); };
  const hand = byHandScan("https://github.com/o/big", refusal, SHA.slice(0, 12), run);
  must(hand.label === "needs-manual-review" && hand.sha === SHA && !hand.refusal && /read it by hand/.test(hand.text), "a repository the scan refused can be pinned to its head commit and marked as read by hand");
  const failed = { sha: SHA, label: "checks-failed", text: "failed" };
  must(byHandScan("https://github.com/o/big", failed, SHA.slice(0, 12), run) === failed, "a scan that ran and failed is never replaced");
  const flagged = { sha: SHA, label: "checks-flagged", text: "flagged" };
  must(byHandScan("https://github.com/o/big", flagged, SHA.slice(0, 12), run) === flagged, "a scan that ran and flagged things is never replaced");
  must(byHandScan("https://github.com/o/big", refusal, "", run) === refusal, "without the commit the maintainer was shown there is no by-hand listing");
  must(byHandScan("https://evil.example/o/big", refusal, SHA.slice(0, 12), run) === refusal && byHandScan("https://github.com/o/big/tree/x", refusal, SHA.slice(0, 12), run) === refusal, "only a plain github.com repository link qualifies");
  must(byHandScan("https://github.com/o/nowhere", refusal, SHA.slice(0, 12), run) === refusal, "if GitHub cannot be read the refusal stands");
  const { IN_AUTHOR: _drop, ...noAuthor } = env; // the workflow sends no author: it comes from the repository owner
  const ok = entryFromDispatch({ ...noAuthor, IN_EXPECT_COMMIT: SHA.slice(0, 12), IN_URL: "https://github.com/o/big" }, hand, "2026-11-15");
  must(ok.ok && ok.entry.checks === "needs-manual-review" && ok.entry.commit === SHA && ok.entry.author === "o", "the entry says it was reviewed by hand, pins the commit and takes the author from the repository owner");
  const moved = entryFromDispatch({ ...env, IN_EXPECT_COMMIT: "b".repeat(12), IN_URL: "https://github.com/o/big" }, hand, "2026-11-15");
  must(!moved.ok, "if the repository moved on from the commit the maintainer was shown, nothing is listed");
}

// ---- GitHub facts, the New tag and the health score
{
  must(roundStars(842) === 842 && roundStars(64946) === 64900 && roundStars(196152) === 196000, "stars are rounded the way they are shown, so the file only changes when the shown number does");
    must(fmtStars(64900) === "64.9k" && fmtStars(196000) === "196k" && fmtStars(1200000) === "1.2M", "large star counts read as 64.9k, 196k, 1.2M");
    must(weekOf("2026-11-19T10:00:00Z") === weekOf("2026-11-25T23:00:00Z") && weekOf("2026-11-26T00:00:00Z") !== weekOf("2026-11-25T23:00:00Z"), "days in the same week snap to the same date, and the next week to a new one");
  must(fmtStars(842) === "842" && fmtStars(1300) === "1.3k", "small star counts are shown as they are");
  const L = [{ ...good, url: "https://github.com/o/a" }, { ...good, url: "https://github.com/o/b" }, { ...good, url: "https://github.com/o/c" }, { ...good, url: "https://evil.example/x/y" }];
  const fake = (args) => {
    const repo = args[1].split("/")[2];
    if (repo === "a") return "64946\tMIT\t2026-11-16T08:00:00Z\tfalse\n";
    if (repo === "b") throw new Error("net/http: TLS handshake timeout");
    return "not-a-number\tMIT\tbad-date\tfalse\n";
  };
  const prev = { "https://github.com/o/b": { stars: 5, licence: "MIT", pushed: "2026-11-09", archived: false } };
  const m = computeMetrics(L, prev, fake);
  must(m["https://github.com/o/a"]?.stars === 64900 && m["https://github.com/o/a"].licence === "MIT" && m["https://github.com/o/a"].archived === false, "facts are read from the repository");
  must(m["https://github.com/o/b"]?.stars === 5, "a network failure keeps the previous facts");
  must(!("https://github.com/o/c" in m), "facts that do not look right are not stored");
  must(!("https://evil.example/x/y" in m), "only github.com repositories are asked about");
  must(isNew("2026-11-17", "2026-11-17") && isNew("2026-10-20", "2026-11-17") && !isNew("2026-10-17", "2026-11-17") && !isNew("2026-11-20", "2026-11-17") && !isNew("nope", "2026-11-17"), "a kit is New for its first 30 days");
  const met = { stars: 10, licence: "MIT", pushed: "2026-11-10", archived: false };
  const top = healthScore({ ...good, checks: "no-flags-found" }, met, "same", "2026-11-17");
  must(top.score === 100 && top.level === "ok" && top.parts.length === 4, "a licensed, recently updated, clean, unchanged kit scores 100 even with 10 stars");
  const few = healthScore({ ...good, checks: "no-flags-found" }, { ...met, stars: 0 }, "same", "2026-11-17");
  must(few.score === top.score, "stars do not change the score");
  must(healthScore({ ...good, checks: "checks-flagged" }, met, "same", "2026-11-17").score === 90, "flagged-then-read checks cost ten points");
  must(healthScore({ ...good, checks: "no-flags-found" }, { ...met, pushed: "2025-01-01" }, "same", "2026-11-17").score === 70, "a repository not touched for over a year loses its upkeep points");
  must(healthScore({ ...good, checks: "no-flags-found" }, { ...met, archived: true }, "same", "2026-11-17").score <= 20, "an archived repository is capped at 20");
  must(healthScore({ ...good, checks: "no-flags-found" }, { ...met, licence: "none" }, "changed", "2026-11-17").score === 66 && healthScore({ ...good, checks: "no-flags-found" }, met, "unreachable", "2026-11-17").level === "ok", "no licence and a changed repository both lose points");
  must(healthScore({ ...good, checks: "no-flags-found" }, met, "newer", "2026-11-17").score === 97 && healthScore({ ...good, checks: "no-flags-found" }, met, "review", "2026-11-17").score === 91, "newer commits cost 3 points of stability, a needed re-review costs 9");
  must(healthScore(good, null, "same", "2026-11-17") === null && healthScore(good, { stars: -1 }, "same", "2026-11-17") === null, "without valid facts there is no score");
  must(!validMetric({ stars: 1, licence: "<script>", pushed: "2026-11-10", archived: false }) && !validMetric({ stars: 1.5, licence: "MIT", pushed: "2026-11-10", archived: false }), "facts with odd values are refused");
}

rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: listings validate strictly, map from forms and admin inputs, block failed or unscannable repos, refuse duplicates, and publish only valid entries");
