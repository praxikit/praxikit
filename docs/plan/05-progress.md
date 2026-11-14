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
