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
