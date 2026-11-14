# Changelog — keel

## 0.2.0 — 2026-11-14
- New: drift hook. After an Edit or Write, warns once per session when the file is outside the current (🟨) phase's Files list in `docs/plan/03-phases.md`. Never blocks.
- New: `/keel:security`. Wires gitleaks, Semgrep and dependency audit into CI (`templates/ci/security.yml`), fills the entry-point table from code, ticks the pre-launch checklist only with evidence, writes the OWASP review and a pentest recommendation.
- New: `tiers.json` is the single place for model tiers; CI checks the agents match it. A project can override with `.keel/tiers.json`, and `/keel:delegate` passes the model explicitly.

## 0.1.1 — 2026-11-14
- Fix: skills read the method and templates from outside the installed plugin folder, so they would have failed after install. `method/` and `templates/` now ship inside the plugin.
- Moved into the praxikit monorepo (`kits/keel/`).

## 0.1.0 — 2026-11-07
- First release: five skills (plan, critique, delegate, verify, replan), four agents, the model-required hook, Cursor and Codex adapters.
