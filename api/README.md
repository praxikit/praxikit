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
   The first deploy asks you to choose a `workers.dev` name. Note the address it prints, like `https://praxikit-admin.YOURNAME.workers.dev`.
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

Open a submission on `/admin`: confirm the name, the type and the card text, then **Approve and publish**, or **Reject** with a reason the submitter sees on `/mine`. A maintainer's own submission at `/submit` is published directly (it is held for review if its type is unknown, a quick check failed, or the sign-in is older than 30 minutes).

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
