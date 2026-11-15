# Praxikit admin API (phases 1 and 2: sign in, and the submit form)

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
