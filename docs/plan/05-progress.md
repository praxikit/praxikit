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

## 2026-11-15 — Catalog redesign
- Rebuilt the site: brand shown as "Praxikit", hero with copy-to-clipboard install steps and stats, wide feature card (search and filters appear from 4 kits), What's new feed from changelogs, How it works, kit pages with install panel, skill/agent tiles, limits and a changelog timeline, dark mode toggle, 404 page, skip link, reduced-motion. Site test now proves the only scripts are ours and covers both layouts. Checked in the browser at desktop and 375px, no horizontal overflow. Package and org slugs stay lowercase.

## 2026-11-15 — Catalog: up-to-date checker, what you'll see, install tabs (Keel 0.5.1)
- Home page and kit pages gained "Am I up to date?" (pick the installed version, see only the releases since, from the changelog; no backend), kit pages gained "What you'll see" (examples), "What it does on your machine" (hooks listed from hooks.json, reads/writes/network declared in kit.json) and install tabs for Claude Code, Cursor and Codex. New optional kit.json fields: `installBy`, `preview`, `access` (schema and check-kits updated). A Keel test now proves its scripts contain no network or child-process code, since the page says so. Fixed a mobile overflow on the wide kit card. Keel bumped to 0.5.1 (manifest only; plugin behaviour unchanged).

## 2026-11-15 — Catalog polish, feed, build checks, issue forms (Keel 0.6.0)
- Page rewrite: plainer look (no gradients, pills, stat row or hover lift), container grows with the window (1180 to 1960 px), two-column hero with a real output sample, "Updates" merges the version checker and latest releases, FAQ, submit section. Release feed (`feed.xml`, Atom). Kit pages show "Build checks" computed at build time (manifest, changelog, plugin version, no network code in scripts, licence, tests), failing checks shown as failing, labelled not a security audit.
- The version checker cannot read installed plugins (a web page cannot). It now accepts pasted `claude plugin list` output and `?kit=&v=` links; Keel 0.6.0's `/keel:status` prints that link with the installed version.
- Issue forms `suggest-kit.yml` and `recommend.yml` replace blank issues for submissions. Automated scanning of submitted repos is NOT built yet; the Recommended list is still empty and every entry would be read by a person. Pay-to-list was advised against.

## 2026-11-15 — Submission checker
- Added `scripts/check-submission.mjs` and the `submission-check` workflow. On an issue labelled `submission` or `recommendation` it reads (never runs or installs) the linked public github.com repository at one commit and comments: licence, secret-like strings (values never printed), hooks and install scripts, network access, process execution, binaries (by extension and magic bytes), obfuscation and hidden instructions. Labels: `no-flags-found`, `checks-flagged`, `checks-failed`, `needs-manual-review` (never "clean" or "safe"). Nothing is listed automatically; a person reads the source and the listing is pinned to the reviewed commit.
- Critic findings applied: allowlist sanitiser for anything from the repo or issue, clone hardening (no symlinks, no hooks, no submodules, size precheck, timeout), label names that do not claim safety, per-issue concurrency and timeout, CODEOWNERS on the scanner and workflows. Not done: per-author rate limiting, re-running the scan automatically when a maintainer lists a kit.
- Smoke test: ran against praxikit/praxikit itself (flagged, as expected: hooks, regex lines that look like network and process code). Workflow itself not yet run on a real issue.

## 2026-11-15 — Catalog split into routes (Keel 0.6.1)
- The one long page is now routes: Home (hero, three featured kits with View all, browse-by-type tiles, latest releases, recommended teaser, submit band, FAQ), `/kits/` (all, search from 4 kits, type navigation), `/kits/plugins|skills|mcp|other/`, `/updates/` (version checker and releases), `/recommended/`, `/submit/`. Empty types say so and point to Submit. Old `/?kit=&v=` links redirect to `/updates/`. Keel 0.6.1 prints the new link.
- Live test of the submission workflow: issue #1 (octocat/Hello-World) got one comment and `checks-failed` (no licence, no kit files), the edit re-run updated the same comment. Closed.

## 2026-11-15 — Catalogue home made kit-neutral
- Home no longer features Keel: new hero (what the catalogue is, add the marketplace, Browse and Submit buttons, browse-by-type list), Featured kits as plain cards with an explicit "View details", no latest-releases block (it belongs on Updates). Update checker also accepts `claude plugin list --json`. Facts checked in the docs: installs are recorded in `~/.claude/plugins/installed_plugins.json` (format not documented as stable), `claude plugin list --json` exists, auto-update is per marketplace (`/plugin` > Marketplaces, or `autoUpdate` in `extraKnownMarketplaces`), off by default for third-party marketplaces, and no web page can read installed plugins.
