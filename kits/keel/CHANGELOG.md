# Changelog — keel

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
