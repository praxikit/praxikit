#!/usr/bin/env node
// Tests the drift hook against a temp project. No dependencies. Run from the repo root:
//   node kits/keel/tests/drift.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const hook = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "scripts", "drift.mjs");
const proj = mkdtempSync(join(tmpdir(), "keel-drift-proj-"));
mkdirSync(join(proj, "docs", "plan"), { recursive: true });
writeFileSync(join(proj, "docs", "plan", "03-phases.md"), `# Phases

## Phase 0 — done ✅
**Files:**
- \`old/\`

## Phase 1 — build 🟨
**Goal:** x

**Files:**
- \`src/app.js\`, \`src/lib/\`
- \`templates/docs/plan/0{0..2}-*.md\`
- \`scripts/**/*.mjs\`

**Tasks:**
1. Edit \`elsewhere/not-a-file-entry.js\`
`);

const run = (file, session, extra = {}) => {
  const r = spawnSync("node", [hook], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file }, cwd: proj, session_id: session, ...extra }), encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim() };
};
const failures = [];
const must = (c, m) => { if (!c) failures.push(m); };
const sid = "t" + Date.now();

for (const f of ["src/app.js", "src/lib/deep/x.js", "templates/docs/plan/01-critique.md", "scripts/a/b.mjs", "docs/plan/05-progress.md"]) {
  const r = run(join(proj, f), sid);
  must(r.code === 0 && r.out === "", `inside file ${f} should be silent, got: ${r.out.slice(0, 80)}`);
}
const first = run(join(proj, "src", "other.js"), sid);
must(first.code === 0 && /Keel drift: src\/other\.js/.test(first.out) && /Phase 1/.test(first.out), "first outside edit should warn and name the file and phase");
const second = run(join(proj, "lib", "more.js"), sid);
must(second.code === 0 && second.out === "", "second outside edit in the same session must be silent");
const other = run(join(proj, "lib", "more.js"), sid + "b");
must(/Keel drift/.test(other.out), "a new session warns again");
must(run(join(tmpdir(), "somewhere-else.js"), sid + "c").out === "", "a file outside the project is ignored");
must(run(join(proj, "elsewhere", "not-a-file-entry.js"), sid + "d").out.includes("Keel drift"), "paths in Tasks must not count as Files");
must(run("relative/path.js", sid + "e").out.includes("Keel drift"), "relative paths resolve against cwd");

const bad = spawnSync("node", [hook], { input: "garbage", encoding: "utf8" });
must(bad.status === 0 && bad.stdout === "", "garbage stdin must exit 0 silently");
const noPlan = spawnSync("node", [hook], { input: JSON.stringify({ tool_input: { file_path: "/x/y.js" }, cwd: tmpdir(), session_id: "np" }), encoding: "utf8" });
must(noPlan.status === 0 && noPlan.stdout === "", "no plan means silent");

for (const s of ["", "b", "c", "d", "e"]) { try { rmSync(join(tmpdir(), `keel-drift-${sid}${s}`)); } catch {} }
rmSync(proj, { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => "FAIL " + f).join("\n")); process.exit(1); }
console.log("ok: drift hook warns once per session outside the phase Files list, silent inside, never blocks");
