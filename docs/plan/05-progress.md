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

## 2026-11-15 — Approve, reject and admin-add flow
- `site/listings.json` replaces `recommended.json`; entries are `community` or `recommended`, pinned to the reviewed commit with the check result, validated by `site/listings.mjs` (the build refuses a bad entry). Community and recommended listings appear on the kit and type pages with a "not built by Praxikit" label; the Recommended page shows only recommended ones.
- Workflows: `listing-review` (owner adds label `approved` or `rejected` to an issue; only write-access users obeyed; scan job read-only, publish job validates again, commits to main, redeploys Pages and closes the issue) and `add-listing` (Actions form for the owner, direct publish after the same scan). Failed checks block approval; the admin form has an explicit allow-failed box. Guide: `docs/admin.md`.
- Not done: live end-to-end publish (needs a real entry); per-author rate limit; automatic re-scan of listed kits when they change.

## 2026-11-15 — pitch-panel 0.1.0 (our own idea-grilling skill)
- Instead of listing the licence-less third-party skill, wrote our own from scratch: `/pitch-panel:grill`, five seats (customer, money, build, reach, operations), cross-examination, verdict (Go / Go if / Stop), three conditions, one cheap test with the pass bar stated first. Named `pitch-panel` to avoid a third-party brand name. Packaged as a plugin (so updates arrive through the marketplace) with `kind: skill`, which now counts as a plugin for the manifest, marketplace and trust checks whenever it ships `plugin/.claude-plugin/plugin.json`. No scripts, hooks or network code; a test enforces that.
- The quriousprof/sharktank skill is not listed: no licence file. Could still be recommended by the owner with `allow failed` if wanted.

## 2026-11-15 — Policy, reports and removals
- Added `/policy/` (what a listing means, how to report, what happens, honest limits: one maintainer, aims not service levels), the **Report a listing** issue form, GitHub private vulnerability reporting for malicious code and leaked secrets (enabled on the repo), the owner-only **Remove listing** workflow and the public log `docs/removals.md`. Footer and submit page link to the policy. The pitch-panel run on Praxikit named a policy and a second approver as conditions; the policy is done, the second approver is not.

## 2026-11-15 — pitch-panel 0.2.0 (six seats)
- Upgraded to CTO, CMO, COO, PM, CFO and a devil's advocate (written in our own words; the role titles are generic). Adds claim tagging, 1 to 5 scores, an assumption ledger, hidden-assumption list, kill triggers, a coverage check, bottom-up market sizing, and one pass as the default (deep mode only on request, cost stated, after the five-seat trial used about 57k tokens per sub-agent). Not run live in its six-seat form yet; the test checks the file's structure, not the quality of an answer.

## 2026-11-15 — First six-seat run (on Praxikit) and what it exposed
- Ran `/pitch-panel:grill` (one pass) on Praxikit. Verdict Go if (17/25): CTO 4, CMO 2 (Pass), COO 3, PM 2, CFO 3. The devil's advocate found something no earlier review did: listings show the reviewed commit, but installs follow the author's latest version, so the reviewed commit can give false assurance.
- Fixed the same day: policy and every outside listing card now say installs follow the author's latest version (pitch-panel 0.2.1 also fixes the score total, out of 25 not 30, and the Go rule, which counted six voters when only five vote). Not built: a scheduled check that marks a listing "changed since review" when the repository's latest commit differs from the reviewed one.

## 2026-11-15 — "Changed since review" check
- Built the check the devil's advocate asked for: `listing-drift` workflow (daily + on demand) compares each listing's reviewed commit with its repository's default branch through the GitHub API (no cloning), writes `site/drift.json` only when a status changes, and the site shows "Changed since review" with a compare link, or "Repository not reachable". Transient failures keep the previous status. **Add listing** gained a `replace` option to record a re-review (it then re-runs the check).
- Limits: it says the code changed, not whether the change is bad; active repositories will show "changed" quickly; it uses `compare/<reviewed>...HEAD` links that I have not opened on github.com for a changed case.

## 2026-11-15 — Admin app, phase 1 (sign-in)
- Added `api/` (Cloudflare Worker, no dependencies): GitHub OAuth sign-in with a random state cookie, a fixed redirect URI, and the minimal scopes `read:user read:org`. The token is used once to read the user and their org role and `maintainers` team membership, then dropped. Access = active org owner or `maintainers` team member; sessions are signed (HMAC), stateless, four hours, in `__Host-` HttpOnly Secure SameSite=Lax cookies; logout is POST with an Origin check; pages have no scripts and a strict CSP; read-only queue from the existing issue forms.
- `node api/test.mjs` drives the whole flow against a fake GitHub (owner, team member, plain member, outsider, pending invite, wrong org, forged/expired/tampered sessions, CSRF on logout, escaping, token and secret never in a response). Wired into CI.
- NOT done and NOT tested live: it is not deployed. The owner must create the `maintainers` team, the GitHub OAuth App and the Cloudflare deployment (steps in `api/README.md`), then check the real GitHub org/team responses. The assumption most likely to need adjusting is the exact behaviour of `/user/memberships/orgs/{org}` and `/user/teams` for an org with third-party app restrictions.

## 2026-11-15 — Admin app deployed (not yet signed in)
- Deployed `praxikit-admin` to Cloudflare Workers; `/healthz` answers ok. `BASE_URL` and the public OAuth client id are in `api/wrangler.toml`; the client secret and session secret are set only in Cloudflare with `wrangler secret put`. The `maintainers` team exists in the org. The first deploy attempt exposed a Cloudflare token in a pasted terminal screen; it was revoked, and a short-lived replacement was used. Corporate TLS inspection needed `NODE_OPTIONS=--use-system-ca`.
- Still to do: set the two secrets, redeploy with the client id, first real sign-in, delete the placeholder worker and the API token.

## 2026-11-15 — Admin app phase 1 verified live
- First real sign-in worked: `@royal-programmer` was recognised as an owner of `praxikit` and saw the admin page (maintainer badge, "owner of praxikit", empty waiting list, shortcuts). Verified for the owner path only. The team-member path and the "signed in but no access" path are covered by `api/test.mjs` against a fake GitHub but have not been exercised with a real second account.
- Left to the owner: delete the placeholder worker `raspy-rain-a9c7`, delete the Cloudflare API token used for the deploy (it expires on its own after 7 days), consider requiring two-factor for the org.

## 2026-11-15 — Admin app phase 2 (submit form), built and tested, not deployed
- `/submit` (sign in with GitHub, read:user only), repo-link-only form, server-side lookup of owner, licence, latest commit, tree (kind guess) and README (plain-text excerpt, never rendered), author vs recommender decided by GitHub identity (owner or public org member = community), quick checks (licence, recognisable contents, repository state), submissions in D1 (schema.sql, unique pending index, bound statements), `/mine`, admin queue and detail pages. Limits: 5 per person per day (30 for maintainers), one pending per repo, refused if already listed. The full read-only code scan stays in GitHub Actions and runs at approval (phase 3): the free Worker plan has too little CPU time to scan inside the app.
- `node --no-warnings api/test-submit.mjs` (fake GitHub, real SQLite via node:sqlite) in CI. Not run against the real GitHub or D1 yet. Needs the owner to create the D1 database, apply the schema, add the binding and (advised) a read-only token. Unverified: Worker CPU-time headroom for large repo trees on the free plan.

## 2026-11-15 — Live test of phase 2 found two bugs (fixed)
- The submit form posted from the real browser was refused: with `Referrer-Policy: no-referrer` browsers send `Origin: null` on same-origin form posts, so the Origin check failed. Fixed by using `Referrer-Policy: same-origin` and also accepting a missing or null Origin when `Sec-Fetch-Site: same-origin` (a header a web page cannot set). The fake-browser tests had always sent a proper Origin, so they could not catch it; the new tests send `Origin: null`.
- The form looked unstyled: the stylesheet is cached for an hour and the new rules were not picked up. The stylesheet address now carries a hash of its content.

## 2026-11-15 — Admin app phase 3a (approve, reject, direct publish), built and tested, not deployed
- Detail page: approve (name, type, card text editable; the maintainer's confirmed values are what get listed) and reject (reason shown to the submitter on /mine). Approving is one atomic database step; the app then starts the `approve-submission` workflow with a dedicated token that can only run workflows (fine-grained, Actions read/write on the one repo). The workflow re-scans, validates and commits; a failed scan blocks and there is no allow-failed path. The app follows the run (display title `approve #N`) and shows Publishing, Listed or Blocked, with retry. Maintainer submissions publish directly, or are held. Sessions now carry `iat`; approve, reject, retry and direct publish need a sign-in under 30 minutes old (the role is only re-read at sign-in).
- `node --no-warnings api/test-approve.mjs` (fake GitHub with dispatch and run status, real SQLite) in CI. Not run against the real GitHub or D1. Needs: migration `api/migrations/0002_publish.sql` on the live database, the `GITHUB_DISPATCH_TOKEN` secret, a redeploy. Open: removal, re-review and drift lists in the app (phase 3b), and pointing the public site at the new form (phase 4).

## 2026-11-15 — Admin app phase 3b: checks before approval (built and tested, not deployed)
- Found on the first live approval: the scan ran after the decision, so a flagged repository (marketingskills: 145 network and 309 exec lines, mostly in docs, a .pyc file, a long test line) was published without the maintainer seeing the flags. Fixed: a `scan-submission` workflow ("scan #N", result in the result job's name) run from the submission page; Approve unlocks only after it; a flagged result needs a "read the report" tick; the approval is pinned to the scanned commit (the approve workflow refuses if the repository moved); a failed or unreadable scan cannot be approved; direct publishing by a maintainer requires a result with nothing to look at, and a blocked one can go "back to review".
- Scan report made quieter: code, agent-instruction files and docs are counted separately (docs mentions are noted, not flagged); credential-looking strings in test or example files are a flag, provider-shaped keys always fail, obvious placeholders are ignored. Scanning praxikit/praxikit itself gave 'Fail' on a fake test token before this, now a flag.
- Needs the owner: migration `api/migrations/0003_scan.sql` and a redeploy. Not run against the real GitHub or D1 yet. Still to do: remove, re-review and drift lists in the app, then pointing the public site at the new form.

## 2026-11-16 — "Recommended" replaced by My picks and Listed
- Decision (owner): the word Recommended claimed more than was true (two listings got it without being used). The catalogue now has Built by Praxikit, **My picks** (kits the owner uses, with a one-line note on how; a tick on the approve form, validated: a pick needs a note, a note needs a pick) and **Listed** (scanned and read, not endorsed). Who put it forward stays as small context. New `/picks/` page; `/recommended/` redirects to it; navigation, home page, policy and submit copy updated; the issue form is now "Suggest someone else's kit". The two existing listings (Playwright MCP, marketingskills) are now plain Listed until the owner says they use them.
- Needs the owner: migration `api/migrations/0004_picks.sql` and a redeploy of the app.
- CI caught that the approve workflow had 12 manually-started inputs and the pinned actionlint allows 10. Fixed by deriving two of them (a non-empty `note` marks a pick; an empty `expected_commit` means clean-only), and `scripts/listings.test.mjs` now counts inputs on every workflow so the limit shows up locally.

## 2026-11-16 — Logo, tags, search, a submit form on the site
- **Logo**: six blocks assembled into a P with one amber block set apart (the kits, and the one the owner picked). Favicon and `logo.svg` come from the same source in `site/build.mjs`.
- **Tags**: on listings and built kits (`tags`), validated the same way in the site and the app; the approve form pre-fills them from GitHub topics; cards show at most two rows; `/tags/` and `/tags/<tag>/` pages; a tag row on `/kits/`.
- **Search**: `search-index.json` (kits, skills and commands, picks, listed, tags, pages) matched in the browser; header box with suggestions, `/` shortcut, `/search/` page. Results are built with `textContent` only.
- **Submit**: the site's Submit page is a form that hands the link to the app; the app prefills it and carries it through sign-in. A muted GitHub-issue fallback stays.
- **Scanner**: the "disable the sandbox" phrase now counts only in files that instruct an agent, so a README documenting a flag is no longer flagged.
- Needs the owner: migrations `0004` (if not yet) and `0005`, then `npx wrangler deploy`. Approving from the app fails between the push and the redeploy.

## 2026-11-16 — Manage live listings in the app
- Owner decisions: collections start private; the app stays on Cloudflare D1 (no Supabase: a second database and auth system for no gain at this size); Google sign-in later only if people ask. Order: listing management, then accounts and privacy (note, delete-my-account, rate limits, users table), then My collection.
- Built: `/admin/listings` with edit and remove, new `edit-listing` workflow and `editListing()` in `scripts/listings.mjs`, tests (`api/test-listings.mjs`, added to CI).
- No migration. Redeploy the app (`npx wrangler deploy`) after pulling.

## 2026-11-16 — Accounts, privacy and My collection
- Anyone can sign in with GitHub (`read:user` only) to keep a private collection and submit. Stored: username, numeric id, first and last sign-in, saved items with an optional group, submissions. Token never stored.
- Save links on every card and kit page go to the app (a GET link only opens a confirmation page; saving is a same-origin POST). Only items in the live catalogue (read from `search-index.json`) can be saved. Limits: 300 total, 40 per hour.
- Download my data, delete my account (needs the username typed), privacy pages on the site and in the app.
- Needs the owner: migration `api/migrations/0006_accounts.sql`, then `npx wrangler deploy`.
- Not built, on purpose: public or shareable collections, Google sign-in, an admin view of other people's collections.

## 2026-11-16 — One site, one address (praxikit.com)
- The Worker now serves the website (Workers static assets, built from `site/` with `site/config.worker.json`) and the account app on one origin. Its pages sit inside the site's own frame (`app-shell.html`), so header, footer and styling are shared.
- Header: Sign in, or an account menu (Profile, My collection, Settings, Admin for maintainers, Sign out); maintainers also get an **Admin** tab first in the nav. Driven by `/api/me` from `site.js`; scripts are external, so the CSP has no `unsafe-inline`.
- New pages: `/profile`, `/settings` (data download, sign-out, account deletion). The privacy text lives on the site only. `/mine` redirects to `/profile`; `www` redirects to the main address.
- Pages mirror: with the repository variable `MIRROR_TO` set, github.io pages redirect to the new address; `versions.json` and the feed stay real. Sitemap and robots.txt are generated from the site address.
- Go-live steps: `docs/go-live.md`. Not done by me: buying/attaching the domain (done by the owner), OAuth callback change, deploy.

## 2026-11-16 — Fixes after first deploy, and the old address dropped
- Bug: app pages (`/profile`, `/admin`) kept the old strict policy, which blocked the header script, so the header showed "Sign in" after signing in. The app now allows its own scripts and `/api/me` calls; a test covers every app page.
- Bug: a maintainer who used the header's Sign in was a member, with no way to reach the admin. The "No access" page and Settings now offer **Sign in with organisation access**.
- Dropped for good (owner's decision): the GitHub Pages site and the `MIRROR_TO` redirect, the `workers.dev` address, `/recommended/`, `/mine`, `/assets/admin.css`, the app's own privacy page, the `.nojekyll` file, the second site config. One config: `site/config.json`.
- New: `deploy` workflow (replaces `pages.yml`), needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Keel 0.6.2 prints the update link on `praxikit.com`.
