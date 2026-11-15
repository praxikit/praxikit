# Progress — praxikit

## 2026-11-14 — Phase 0 done, Phase 1 built
- Phase 0: repo renamed `praxikit/praxikit`; Keel moved to `kits/keel/`; fixed skills reading `../../method` outside the plugin (now `plugin/method`); keel 0.1.1. CI green on fa23166.
- Phase 1: `schema/kit.schema.json`, `kits/keel/kit.json`, `kits/keel/CHANGELOG.md`, `scripts/check-kits.mjs`, `check.yml` (validate + version-bump), `release.yml` (tag `<kit>-vX.Y.Z` -> release with CHANGELOG notes).
- Checks run locally (scratch copy for the negative cases):
  ```
  valid repo                      -> ok: 1 kit(s) valid
  shipped file changed, no bump   -> FAIL keel: shipped files changed ... version is still 0.1.1 (exit 1)
  docs-only change                -> ok (exit 0)
  bad kind / bad semver           -> FAIL x3 (exit 1)
  ```
- Open: install smoke test (`/plugin marketplace add praxikit/praxikit`) still to be run by the owner.

## 2026-11-14 — Phase 2 live, Phase 3 built
- Phase 2: catalog live at https://praxikit.github.io/praxikit/ (all pages 200; site test passes hostile-input check).
- Phase 3 (keel 0.2.0): drift hook, `/keel:security` + `templates/ci/security.yml`, `tiers.json` with CI check.
- Checks:
  ```
  node kits/keel/tests/drift.test.mjs -> ok (warns once per session outside Files; silent inside; garbage/no plan silent)
  node scripts/check-kits.mjs         -> ok; builder model changed to opus in a scratch copy -> FAIL (tier mismatch)
  claude plugin validate              -> Validation passed
  CI: actionlint v1.7.7 (sha256-verified) on workflows + security template -> passed after moving the release-notes script out of inline shell
  ```
- Not done: `/keel:security` run on a real repo; Cursor adapter used on a real project; install smoke test.

## 2026-11-15 — install smoke test (owner-run), partial
- Owner installed `keel@praxikit` from GitHub (settings show the marketplace as `praxikit/praxikit`), ran `/keel:plan a small CLI that converts markdown to HTML` in an empty folder.
- Result: `docs/plan/` with six files; `00-brief.md` and `01-critique.md` were filled (critique ~10 KB with sources and a list of edits the plan needs). `02-decisions.md`, `03-phases.md`, `04-security.md`, `05-progress.md` are still the templates: the run stopped at the critique gate awaiting the owner's decision. This is the path fix working: the skill read method/templates from inside the installed plugin.
- First attempts failed with `API Error: 400 Invalid effort level` and a `UserPromptSubmit` timeout: neither is Keel (Keel registers no such hook and sets no effort). Resolved by the owner.
- Not yet confirmed in a live session: the drift hook warning and the model-required hook refusal (steps 6 and 7).
- To do: remove "smoke test not recorded" from `kits/keel/kit.json` limits in the next release (0.2.1).

## 2026-11-15 — Keel 0.3.0 built (For you / Task list, cost footer, model settings)
- Added: SessionStart hook (standing response format), Stop hook (one-line token and cost footer, sub-agents included), `/keel:cost`, `/keel:settings`, `prices.json` (sourced from platform.claude.com pricing page, 2026-11-15), `defaults.json`, `.keel/config.json` overrides.
- Findings that shaped it: transcripts repeat a message once per content block (de-dupe by message id); sub-agent usage is in `<session>/subagents/*.jsonl`; Claude Code's own `cost-state` entries are too sparse to use per prompt.
- Cross-check against the app: an earlier `cost-state` snapshot of this session showed $2.80 for 11.4M cache-read / 74k out / 227k 1h cache-write tokens; the same tokens at Sonnet 5.5 list prices = $2.795.
- Checks run locally: `cost.test.mjs` ok (exact dollars for dedupe, Haiku long tier, sub-agent, unpriced model, config switches); drift and site tests ok; `claude plugin validate` passed; `check-kits` ok. The checker caught an unescaped-quote JSON error in `tiers.json` before commit.
- Not yet verified live: the Stop footer and SessionStart rules inside a fresh installed session (needs 0.3.0 installed).

## 2026-11-15 — Keel 0.3.0 seen live; 0.3.1 layout fixes
- Owner's installed 0.3.0 (screenshots): the cost footer printed after a prompt; For you and Task list appeared on their own for a multi-step request and not for a one-line request (automatic, nothing to enable).
- Found: task marks ⬜ drew as empty boxes in the owner's terminal; reply layout varied; footer wrapped to two lines. Claude Code prefixes hook output with "Stop says:", which Keel cannot remove.
- 0.3.1: fixed layout (result, ### For you, ### Task list), ASCII marks by default (emoji optional), shorter footer. Tests updated and passing.

## 2026-11-15 — Keel 0.4.0
- Added `/keel:status` (phases, current checks, open decisions, last entry, cost) and the done-check Stop hook (warns when non-doc files changed and no check-like command ran after). Both covered by `tests/status.test.mjs`, wired into CI. Not yet seen live in a fresh install.

## 2026-11-15 — Keel 0.5.0
- Added the budget guard (`budget.prompt` / `budget.session` caps, footer warns, never blocks) and cost per phase (`phase-cost.mjs`, ledger in `.keel/ledger.json`, called by `/keel:verify`). Covered by `cost.test.mjs` and `status.test.mjs`. Not yet seen live in a fresh install.
