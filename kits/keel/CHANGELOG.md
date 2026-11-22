# Changelog — keel

## 0.7.0 — 2026-11-22
Efficiency: the cheap way is the default, and the big costs are visible.
- New: `/keel:scope` and a prompt hook. An open-ended ask ("redesign it", "make it the best") gets a goal, at most three choice questions and cheap samples before anything is built, then a brief with a size, checks and a budget. The hook only reminds the model; turn it off with `defaults.scopeHint=false`.
- New: task sizes (S just do it, M a short brief, L scope and critique) in the method, the brief template and the delegate skill, so small work carries no ceremony.
- New: context meter. The footer shows the conversation's size (what every turn re-reads); from 150k tokens (`limits.contextWarn`) it says so and Keel tells the model to offer `/keel:handoff`.
- New: `/keel:handoff` writes `.keel/handoff.md` (goal, state, decisions, files, checks, next) so the work continues in a fresh session at a fraction of the per-turn cost.
- New: month guard. Set `limits.monthlyLimit` in `~/.claude/keel.json` and run `report.mjs --write-month-cache` once; the footer shows the month against the limit from 70%, and Keel tells the model to take the cheap path from there. Estimates at list prices.
- New: `/keel:route` and `scripts/route.mjs`. Which model gets a task is decided from the task's facts (kind, can a command verify it, ambiguity, size, paths touched, failed checks), with floors (auth, payments, secrets, migrations, CI and releases never below the think tier), escalation after failed checks, a log of outcomes that moves a kind of task up or down after enough runs, and a "do it inline" answer for tiny changes. The ladder is haiku, sonnet, opus, fable and is configurable.
- Changed: the critic has its own tier (`opus`) instead of inheriting the session's model, so a cheap lead session still gets a strong critique.
- New: `/keel:report` shows where tokens and money went across every session on the machine: by model, token type, project and session, the average context per turn, and the habits that bloat a context. It measures, so tuning starts from the real shares.
- New: tool thrift. A reminder after every 8th screenshot (`limits.screenshots`), and a short standing rule in the session-start text (size the task, read with offsets, text before screenshots, no polling, small sub-agent briefs). Off with `defaults.thrift=false`.
- Changed: `/keel:status` prints the update command instead of a link to a checker that no longer exists.

## 0.6.2 — 2026-11-16
- Changed: the update link `/keel:status` prints now points at `praxikit.com`, the catalogue's own address (it was on a GitHub address that no longer answers). Update to get a link that works.

## 0.6.1 — 2026-11-15
- Changed: the update link `/keel:status` prints now points at the catalog's Updates page (`/updates/?kit=keel&v=<version>`), which has its own address since the catalog was split into pages. Links printed by 0.6.0 still work; they are redirected.

## 0.6.0 — 2026-11-15
- New: `/keel:status` ends with the installed version and a link that fills in the catalog's "Am I up to date?" form for it (`https://praxikit.github.io/praxikit/?kit=keel&v=<version>#updates`). A web page cannot read your installed plugins, so the plugin hands the page your version instead.

## 0.5.1 — 2026-11-15
- Changed: the manifest now carries examples of what you will see, what the kit reads, writes and sends, and install steps for Cursor and Codex, so the catalog page can show them. No change to how the plugin behaves.
- New: a test checks that Keel's scripts contain no network or child-process code, because the catalog page says they make no network calls.

## 0.5.0 — 2026-11-15
- New: budget guard. Set `budget.prompt` and/or `budget.session` (estimated USD) in `.keel/config.json`; when a cap is passed the cost footer ends with `OVER prompt cap $X`. Warns only, never stops work. No cap by default.
- New: cost per phase. `/keel:verify` runs `scripts/phase-cost.mjs` when a phase passes and records its estimated cost in `05-progress.md`, using a ledger in `.keel/ledger.json` (difference between marks, all sessions and sub-agents). The first mark covers all recorded history and says so.

## 0.4.0 — 2026-11-15
- New: `/keel:status`. One screen with the phases and where you are, the current phase's goal and checks, open decisions, the last progress entry and the session cost. Read-only.
- New: done-check. When a prompt changed files (other than docs) and no check-like command ran afterwards, a Stop hook prints one line saying so. A heuristic, never blocks. Turn off with `defaults.doneCheck: false`.

## 0.3.1 — 2026-11-15
- Changed: a fixed reply layout. The result first, then `### For you` (bold action, exact command, `→ expect:`, `(blocks the next step)`), then `### Task list`. Task order and wording stay stable across replies and finished tasks stay on the list until the request is done. A plain question still gets a plain answer.
- Changed: task marks default to ASCII `[x] [>] [ ]`, because the emoji marks drew as empty boxes in some terminal fonts. Set `defaults.marks` to `"emoji"` in `.keel/config.json` to get ✅ 🔄 ⬜.
- Changed: the cost footer is one short line (`Keel · ≈$0.03 this prompt (sonnet 5.5) · session ≈$0.25 · 95.8k in, 1.5k out · est.`) so it no longer wraps.

## 0.3.0 — 2026-11-15
- New: a standing response format, injected once per session. Replies end with **For you** (numbered, detailed steps for what only the user can do) and **Task list** (✅ done, 🔄 in progress, ⬜ next) when there is something to show. Left out when empty.
- New: a one-line token and cost footer after every prompt (Stop hook): tokens in/cached/out, cost per model, session total, labelled as an estimate. Includes sub-agent usage. `/keel:cost` prints the full per-model table.
- New: `prices.json` (list prices with source and date, including Haiku 5.5's tier above 100k prompt tokens). Models with no price show tokens only. Override with `prices` in `.keel/config.json`.
- New: `/keel:settings` and `.keel/config.json`: switch the sections and footer on or off, choose which models tasks may be distributed among, and which model each tier uses. `/keel:delegate` honours it.
- Changed: the per-project tier override moved from `.keel/tiers.json` to `tiers` in `.keel/config.json`.

## 0.2.0 — 2026-11-14
- New: drift hook. After an Edit or Write, warns once per session when the file is outside the current (🟨) phase's Files list in `docs/plan/03-phases.md`. Never blocks.
- New: `/keel:security`. Wires gitleaks, Semgrep and dependency audit into CI (`templates/ci/security.yml`), fills the entry-point table from code, ticks the pre-launch checklist only with evidence, writes the OWASP review and a pentest recommendation.
- New: `tiers.json` is the single place for model tiers; CI checks the agents match it. A project can override with `.keel/tiers.json`, and `/keel:delegate` passes the model explicitly.

## 0.1.1 — 2026-11-14
- Fix: skills read the method and templates from outside the installed plugin folder, so they would have failed after install. `method/` and `templates/` now ship inside the plugin.
- Moved into the praxikit monorepo (`kits/keel/`).

## 0.1.0 — 2026-11-07
- First release: five skills (plan, critique, delegate, verify, replan), four agents, the model-required hook, Cursor and Codex adapters.
