# Praxikit admin API (sign in, the submit form, approve and reject)

A small Cloudflare Worker with no dependencies. Phase 1 signs people in with GitHub, decides whether they may maintain the catalogue, and shows a read-only admin page. The public catalogue stays a static site on GitHub Pages; only this app needs a login, and the pages are served from this app's own address so the sign-in cookie is first-party.

## Who gets in

- An **owner** of the `praxikit` GitHub organisation, or
- a **member of the `maintainers` team** in that organisation.

Add someone to the team and they can sign in; remove them and they lose access within four hours (the session lifetime). The check runs on the server at sign-in. The GitHub token is used once to learn who you are and which org and teams you belong to, then dropped: it is never stored, put in a cookie, or sent to the browser.

## What it does and does not do (phase 1)

- Sign in, sign out, a signed session cookie (`__Host-`, HttpOnly, Secure, SameSite=Lax, four hours).
- A read-only page listing open submissions from the existing issue forms, and shortcuts to the workflows.
- It does not approve, reject, add or remove anything yet. Those still happen on GitHub until phase 3.
- It stores nothing. No database yet (that arrives with the in-app submission form in phase 2).

## Setup (only you can do these steps)

You need: owner access to the `praxikit` org, and a free Cloudflare account. Nobody else, including me, should ever see the secrets.

1. **Create the team.** In the org: Teams, New team, name it `maintainers` (the slug must be `maintainers`). Optionally require two-factor for the org: Settings, Authentication security.
2. **Log in to Cloudflare from this folder and deploy once** to get the app's address:
   ```bash
   cd api
   npx wrangler login
   npx wrangler deploy
   ```
   The app is served at `https://praxikit.com` (see `docs/go-live.md`).
3. **Create a GitHub OAuth App owned by the org** (Org settings, Developer settings, OAuth Apps, New OAuth App):
   - Application name: `Praxikit admin`
   - Homepage URL: the address from step 2
   - Authorization callback URL: that address plus `/auth/callback`
   Copy the **Client ID**, then **Generate a new client secret** and keep that page open.
4. **Put the values in.** Edit `wrangler.toml`: set `BASE_URL` to the address and `GITHUB_CLIENT_ID` to the Client ID. Then set the two secrets (the commands prompt you to paste; nothing is written to a file):
   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   ```
   For `SESSION_SECRET`, paste a fresh random value. Make one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
5. **Deploy again:** `npx wrangler deploy`.
6. **Try it.** Open `YOUR-ADDRESS/admin`, choose Sign in with GitHub. On GitHub's screen, click **Grant** next to `praxikit` (organisations can restrict third-party apps; as an owner you approve it once).
   Expected: the admin page with your name, "maintainer", and "an owner of praxikit".

## If something is off

| You see | Likely cause |
|---|---|
| "Not configured" (503) | A value in `wrangler.toml` still says `REPLACE...`, or a secret is not set, or `SESSION_SECRET` is under 32 characters |
| "No access" after signing in | You are not an owner or a `maintainers` member, or your org invitation is still pending, or the OAuth app has not been granted access to the org |
| "That sign-in link was not valid" | The sign-in took more than ten minutes, or cookies are blocked; start again |
| The waiting list says it could not load | GitHub's rate limit; reload, or set an optional `GITHUB_TOKEN` secret (a fine-grained token with read access to this repo's issues) |

## Safety notes

- Secrets live only in Cloudflare (`wrangler secret put`). Never commit them. If one leaks, rotate it: generate a new client secret on GitHub or a new `SESSION_SECRET` (that signs everyone out).
- The pages contain no scripts, and the content security policy forbids them.
- Every state-changing request must come from the app's own address.
- Local checks: `node api/test.mjs` runs the whole flow against a fake GitHub.

## Phase 2: the submit form

Anyone with a GitHub account can sign in (asking GitHub only for their username) at `/submit`, paste a public repository link, and send it for review. The app reads the repository's name, owner, licence, latest commit and a plain-text excerpt of the README from GitHub, works out whether the submitter is the author or a recommender (GitHub decides: the repo's owner, or a public member of its organisation, is the author), runs quick checks, and stores the submission in a small database. Maintainers see the queue on `/admin` and each submission's details. Approving still happens on GitHub until phase 3, so the form is **not linked from the public site yet**.

Safety: only `https://github.com/<owner>/<repo>` links are accepted; private repositories are refused; at most 5 submissions per person per day; a repository can be pending only once and is refused if it is already listed; README text is cut down to plain text and never rendered as markup; every value is stored through bound SQL parameters.

### Setup for phase 2

1. Create the database (free):
   ```bash
   npx wrangler d1 create praxikit-admin
   ```
   It prints a `database_id`. That value is not secret.
2. In `wrangler.toml`, uncomment the `[[d1_databases]]` block and paste the id.
3. Create the table:
   ```bash
   npx wrangler d1 execute praxikit-admin --remote --file=schema.sql
   ```
4. Strongly advised: a read-only GitHub token, so repository lookups do not hit GitHub's shared rate limit. Create a **fine-grained personal access token** with *Public repositories (read-only)* and no extra permissions, then:
   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```
5. Redeploy: `npx wrangler deploy`, then open `/submit`.

Checks: `node --no-warnings api/test-submit.mjs` runs the submit flow against a fake GitHub and a real SQLite database.

## Phase 3: approve, reject and publish from the app

Open a submission on `/admin`: confirm the name, the type and the card text, then **Approve and publish**, or **Reject** with a reason the submitter sees on `/profile`. A maintainer's own submission at `/submit` is published directly (it is held for review if its type is unknown, a quick check failed, or the sign-in is older than 30 minutes).

**The app never edits the catalogue.** Approving asks GitHub to start the `approve-submission` workflow, which scans the repository again (read-only), validates the entry, and commits it. A failed scan stops it; "list anyway" does not exist on this path (it stays a manual action in the *Add listing* workflow). The app then follows that run and shows Publishing, Listed or Blocked (with a link to the run and a Try again button).

Safety: approving, rejecting and retrying need a maintainer, a request from this site, and a sign-in from the last 30 minutes; an approval is one atomic database step, so double clicks cannot start two jobs; the token the app holds can only start workflows, not change files.

### Setup for phase 3

1. Pull and add the new columns to your existing database, **once** (a database created from the current `schema.sql` already has them):
   ```bash
   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0002_publish.sql
   ```
2. Create a **fine-grained personal access token** for starting the publish job:
   - Name `praxikit-admin-dispatch`, expiry 90 days.
   - Resource owner: the `praxikit` organisation (if it is not offered, an owner must allow fine-grained tokens under the org's Settings, Personal access tokens; a request may then wait for an owner's approval in the same place).
   - Repository access: **only** `praxikit/praxikit`.
   - Permissions: **Actions: Read and write**. Nothing else.
   Then store it (never paste it in chat):
   ```bash
   npx wrangler secret put GITHUB_DISPATCH_TOKEN
   ```
3. Redeploy: `npx wrangler deploy`.
4. Try it with a submission you actually want listed. Approving publishes it for real. Watch the *Actions* tab for a run called `approve #N`.

Checks: `node --no-warnings api/test-approve.mjs` covers approving, rejecting, retrying, blocked and refused jobs, stale sign-ins and direct publishing.

## Phase 3b: the full checks come before the decision

A submission can no longer be approved blind. On its page, **Run the full checks** starts the `scan-submission` workflow on GitHub (read-only: it clones the public repository without running anything). When it finishes, the page shows the result and a link to the full report (open the *scan* job's Summary). **Approve and publish** unlocks only after the checks have run:

- *Found nothing to look at*: approve.
- *Found things to look at*: open the report, then tick the box saying you read it, then approve.
- *Failed* or *could not be read automatically*: it cannot be approved. Reject it, or wait for the submitter to fix it.

An approval is pinned to the commit the checks ran on. If the repository changes before the publish job runs, publishing stops and the checks must be run again. A maintainer's own submission at `/submit` still publishes directly, but only if the checks find nothing to look at; otherwise it is Blocked, and **Back to review** puts it on the normal path.

The scan report is also quieter: network commands and `eval` in ordinary documentation are counted but not flagged; code, and the files that instruct an agent (SKILL.md, agents, commands, rules), are. Credential-looking strings in test or example files are a flag for a person to check; provider-shaped keys always fail.

### Setup for phase 3b

1. Pull and add the new columns to your existing database, **once**:
   ```bash
   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0003_scan.sql
   ```
2. Redeploy: `npx wrangler deploy`. The same dispatch token covers the new workflow (it needs no extra permission).
3. Open a pending submission, click **Run the full checks**, wait for it, read the result, then decide.

Checks: `node --no-warnings api/test-approve.mjs` covers the scan flow, the pin to the checked commit, clean-only direct publishing, retries and reopening.

## Picks (the owner's own list)

The approve form has an **I use this kit** tick and a **How I use it** note (up to 200 characters). A ticked kit is published as one of **My picks** with that note on its card; without the tick it is simply **Listed**. Direct publishing by a maintainer never marks a pick. The publish workflow receives the note, and a non-empty note is what marks a pick (the workflow is limited to 10 inputs, so the flag is derived). The entry validator refuses a pick without a note or a note without a pick.

### Setup for picks

1. Pull and add the two new columns to your existing database, **once**:
   ```bash
   npx wrangler d1 execute praxikit-admin --remote --file=migrations/0004_picks.sql
   ```
2. Redeploy: `npx wrangler deploy`.

### Tags, and the website's submit form

The approve form has a **Tags** field, pre-filled from the repository's own GitHub topics. Tags are lowercase, hyphenated, 2 to 24 characters, at most 12 per kit; the app and the site use the same rules (a test keeps them identical). They show on cards (two rows at most), on `/tags/`, and in site search.

The website's `/submit/` page is a form that sends the repository link to this app (`site/config.json` holds the app's address). `/submit?url=` accepts only a `https://github.com/owner/repo` link, fills it in, and keeps it through the GitHub sign-in in a short-lived `__Host-praxikit-next` cookie that is re-checked when read.

Setup, **once**, after pulling:

```bash
npx wrangler d1 execute praxikit-admin --remote --file=migrations/0005_tags.sql
npx wrangler deploy
```

(Run `0004_picks.sql` first if you have not.) Until the redeploy, approving from the app fails: the approve workflow no longer takes an `author` input.

### Managing live listings

`/admin/listings` shows what is live now (read from `site/listings.json` on GitHub) with, for each listing, an edit form (name, card text, tags, the "how I use it" note) and a remove form (a reason from the list, an optional public note, a confirmation tick). Both need a maintainer signed in within the last 30 minutes and a request from the app's own origin. The app does not edit files: it starts the `edit-listing` or `remove-listing` workflow with fixed inputs, which commit the change and redeploy the site. An edit never changes what was reviewed (repository, commit, checks, source); a note makes the listing a pick, an empty note makes it an ordinary listing. Removals go to the public log in `docs/removals.md`. No migration and no new setting are needed; the dispatch token already covers these workflows.

### Accounts and My collection

Anyone can sign in with GitHub (the `read:user` permission only; the access token is used once and never stored). The app keeps, per person: the GitHub username and numeric id, the first and last sign-in dates, their saved items with an optional group name, and their submissions. Pages: `/collection` (the list, with Download my data and Delete my account), `/collection/save?item=` (a confirmation page; saving is a same-origin form post, never a link), `/account/export`, `/privacy`.

- **What can be saved** is decided by the live catalogue, not the form: the app reads the site's `search-index.json` (`SITE_URL` in `wrangler.toml`) and accepts only a built kit's page path (`k/<name>/`) or a listed github.com repository.
- **Limits:** 300 items in total and 40 additions per hour per person; changing a group on something already saved is not an addition.
- **Private:** no route shows one person's collection to anyone else, maintainers included.
- **Delete:** removes the collection, waiting submissions and the account record; decided submissions stay with the name replaced by `deleted-account`.
- The website's cards and kit pages carry a **Save** link when `site/config.json` has the app address; a signed-out visitor is sent through GitHub and lands back on the confirmation.

Setup, **once**, after pulling:

```bash
npx wrangler d1 execute praxikit-admin --remote --file=migrations/0006_accounts.sql
npx wrangler deploy
```

### "This helped me" and short notes

Signed-in people can press **This helped me** on a kit or listing page (one vote per person per kit; press again to take it back) and write one short note about how it helped (10 to 240 characters, plain text, **no links**, one per person per kit; writing again replaces it). Anyone can read the counts and the approved notes.

- **A person's first note waits** for a maintainer (`/admin/notes`: Show, Hide, Delete). After one note is shown, that person's later notes appear at once. A maintainer's own notes appear at once.
- **Reports:** any signed-in person can report someone else's note; two different people hide it until a maintainer decides. Showing a note again clears its reports.
- **Limits:** 60 votes an hour, 5 notes a day per person.
- **Totals on cards:** "N people found it useful" from one vote up; "saved by N" only from three people, from the existing collections (a number, never names).
- **Privacy:** the vote and the note with the GitHub username; deleting an account removes them; the data download includes them. Only totals are shown for votes and saves.
- Endpoints: `GET /api/counts` (public, cached a minute), `GET /api/item?item=`, `POST /api/vote`, `/api/note`, `/api/note/delete`, `/api/note/report`; admin: `/admin/notes`, `/admin/notes/decide`.

Setup, **once**, after pulling (the site deploys itself; until this runs, the section says it could not be loaded):

```bash
npx wrangler d1 execute praxikit-admin --remote --file=migrations/0007_community.sql
```

### Contributor profiles

A person is public only if they switch it on (**Settings → Public credit**, or the *Credit me publicly* tickbox on the submit form; it can only be turned on there, never off). Then:

- **`/contributors`** lists public people ranked by the kits they put forward that are **live in the catalogue right now** (the app reads the site's own `search-index.json`), then by how many are picks, then by name; ties share a rank. A listing that is later removed stops counting at once, and a repository counts once per person. Sending many submissions earns nothing; only listed kits count.
- **`/u/<name>`** is a person's public page: badges and the kits they put forward. Private, unknown and malformed names are a plain 404.
- **Badges** (computed, never stored): First listing (1), Five listed (5), Ten listed (10), Picked (one of their kits is a pick), Author (they submitted a kit they wrote).
- **Credit on listings:** a listing page shows "Put forward by … · @name" only when that person is public. `/api/item` carries the username and nothing else.
- **Everyone** sees their own count, pending submissions, badges and next milestone on `/profile`, public or not.
- Deleting an account removes the profile, the credit and the count. The data download says whether you were credited.

Setup, **once** (the site deploys itself; until then the Settings switch fails with a plain error):

```bash
gh workflow run migrate.yml -f file=0008_profiles.sql
```

### Kit requests (plain-words board)

`/requests`: anyone can read it; a signed-in person can **Ask for a kit** (a title of 8 to 100 characters and optional detail up to 500, plain text, **no links**) and press **I need this too** on others' requests (one press each, press again to take it back; the person asking counts as needing it). Most-needed first.

- A person's **first request waits** for a maintainer (`/admin/requests`: Show, Hide, Delete, **Mark solved**); after one is shown, their later ones appear at once; maintainers' appear at once.
- **Solving:** a maintainer pastes the address of the listed kit that answers a request (a GitHub link as listed, or a built kit such as `k/keel/`); it must be in the live catalogue. The request moves to **Solved** and links to that kit.
- Limits: 3 requests a day, 60 presses an hour. A person can delete their own request unless it is solved. Hidden requests are visible only to their author, who is told.
- Deleting an account removes the person's requests and presses; the data download includes them.

### Contributors (public by default)

`/contributors` shows a podium for the top three and a list below it, ranked by kits that are live in the catalogue right now (then picks, then name; ties share a place). Everyone with a live listing appears; a person can hide their name any time in **Settings → Your name on the site** (the board, their page and the credit on listings all go at once).

Setup, **once** (from Actions, or `gh workflow run migrate.yml -f file=0009_requests.sql`):
`0009_requests.sql`. The 0008 profiles table stays: it now only records people who chose to hide.

### Alerts to the owner

When something waits for review (a first submission, note or request from a person, or a note hidden by two reports) the app sends a short push to your phone through ntfy.sh. The message names the kind of thing and the GitHub username, never the text. Set it up once:

1. Install the ntfy app on your phone and subscribe to a topic with a long random name.
2. `gh secret set NTFY_TOPIC` (paste the topic at the hidden prompt), then `gh workflow run sync-secret.yml -f name=NTFY_TOPIC`.

Without the secret, nothing is sent and nothing else changes.

### Hardening notes (2026-11-17)

`api/migrations/0010_events.sql` adds an event log (limits and strikes), indexes for the public reads, and a unique case-insensitive login. Run it once: `gh workflow run migrate.yml -f file=0010_events.sql`. The Worker also uses an optional `LIMITER` rate-limit binding (120 reads a minute per visitor) declared in `wrangler.toml`. See `docs/security.md`.
