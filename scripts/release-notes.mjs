#!/usr/bin/env node
// Used by release.yml. Reads the tag from $TAG (e.g. keel-v0.2.0), checks it matches
// kits/<name>/kit.json, and writes that version's CHANGELOG section to notes.md.
import { readFileSync, writeFileSync } from "node:fs";

const tag = process.env.TAG ?? "";
const m = /^([a-z][a-z0-9-]*)-v(\d+\.\d+\.\d+)$/.exec(tag);
if (!m) { console.error("bad tag:", tag); process.exit(1); }
const [, name, version] = m;
const kitVersion = JSON.parse(readFileSync(`kits/${name}/kit.json`, "utf8")).version;
if (kitVersion !== version) { console.error(`tag ${tag} does not match kits/${name}/kit.json version ${kitVersion}`); process.exit(1); }
const log = readFileSync(`kits/${name}/CHANGELOG.md`, "utf8");
const start = log.search(new RegExp(`^## ${version.replaceAll(".", "\\.")}( |$)`, "m"));
if (start < 0) { console.error(`no "## ${version}" heading in CHANGELOG.md`); process.exit(1); }
const rest = log.slice(start).split("\n").slice(1).join("\n");
const end = rest.search(/^## /m);
writeFileSync("notes.md", (end > -1 ? rest.slice(0, end) : rest).trim() + "\n");
console.log(`notes for ${tag} written`);
