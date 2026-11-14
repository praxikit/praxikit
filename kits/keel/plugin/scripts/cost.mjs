#!/usr/bin/env node
/**
 * /keel:cost report. Prints the full per-model table for the last prompt and the whole session.
 *   node cost.mjs [--transcript <file.jsonl>] [--project <dir>]
 * Without --transcript it uses the newest transcript for the project directory.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrices, summarize, table, latestTranscript } from "./lib/usage.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const project = arg("--project") ?? process.cwd();
const file = arg("--transcript") ?? latestTranscript(project);
if (!file) { console.error("No transcript found. Pass --transcript <file.jsonl>."); process.exit(1); }
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const prices = loadPrices(pluginRoot, project);
console.log(`Transcript: ${file}`);
console.log(table(summarize(file, prices), prices));
