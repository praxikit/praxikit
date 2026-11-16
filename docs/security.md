# Security

How Praxikit is protected, what each secret does, and what to do when something goes wrong.

## Reporting a problem
Private vulnerability reporting is on for this repository: <https://github.com/praxikit/praxikit/security/advisories/new>. The address is also in `https://praxikit.com/.well-known/security.txt`. Do not post exploit details in a public issue.

## What protects what
- **Sign-in:** GitHub OAuth with only `read:user`. The access token is used once and never stored. Sessions are signed (HMAC), last four hours, and use `__Host-` cookies (HttpOnly, Secure, SameSite=Lax). A maintainer is recognised by a server-side lookup (`GITHUB_ORG_TOKEN`), never by anything the browser says.
- **Requests that change something** need a session and a same-origin request; maintainer actions also need a sign-in from the last 30 minutes. After an account is deleted, its sign-in on other devices stops working for anything that changes data.
- **Pages and data:** every dynamic value is escaped; the browser script builds pages with text nodes; every database query is bound; the policy allows only this site's own scripts (and Cloudflare's cookie-less analytics); no inline scripts.
- **Hostile repositories:** the scanner reads a repository at one commit and never runs or installs anything; links to anything but `github.com/owner/repo` are refused; a README is reduced to plain text before it is shown.
- **Abuse:** per-person limits are counted from an append-only log, so deleting what you made does not give you more; a maintainer's hide or delete sends that person's next note or request back to review; reports are limited per person; a first note or request waits for a maintainer; there is a per-visitor limiter on public reads and sign-in starts; public summaries are cached at the edge.
- **Privacy:** a hidden name stays hidden on kits, notes, requests and the board; account deletion is one all-or-nothing step; the data download covers everything held about a person.
- **Supply chain:** every GitHub Action is pinned to an exact commit; the deploy tool (`wrangler`) is pinned with a lockfile; Dependabot proposes updates weekly; workflows run with minimal permissions and the Cloudflare token exists only in the step that deploys.
- **Checks that keep it this way:** the test suites in `api/` and `site/` (including `api/test-hardening.mjs`, one test per finding of the 2026-11-17 review), `actionlint`, and a weekly passive OWASP ZAP scan of the live site (`zap-baseline` workflow; read its summary on the run page).

## Secrets and tokens
| Name | Where | What it can do | Rotate |
|---|---|---|---|
| `GITHUB_CLIENT_SECRET`, `SESSION_SECRET` | Worker secrets | Sign-in; signing sessions | `wrangler secret put`; changing `SESSION_SECRET` signs everyone out |
| `GITHUB_ORG_TOKEN` | Worker secret | Read organisation membership only | Yearly (fine-grained token, Members: read) |
| `GITHUB_DISPATCH_TOKEN` | Worker secret | Start the publish, scan, edit and remove workflows | Yearly (Actions: read and write on this repository only) |
| `NTFY_TOPIC` | Worker secret (set with `sync-secret`) | Where alerts to the owner are sent; anyone who learns it could read them | Change it if it leaks; messages carry no private text |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets | Deploy and migrate. This token is broad (Workers, routes, DNS, D1): keep it only in the deploy and migrate steps | Yearly, or when anyone leaves |

## Backups and recovery
- The database keeps point-in-time history (D1 Time Travel). To see it: `npx wrangler d1 time-travel info praxikit-admin`; to go back: `npx wrangler d1 time-travel restore praxikit-admin --timestamp=<time>`. The retention window depends on the plan, so check it in the dashboard.
- A manual copy: `npx wrangler d1 export praxikit-admin --remote --output=backup.sql`. The file holds people's usernames and notes: keep it private, never commit it, never attach it to a public workflow run.
- The site and the app are rebuilt from this repository by `deploy`; the catalogue itself (`site/listings.json`) is in git history.

## Worth doing in the Cloudflare dashboard (free)
- A WAF rate-limiting rule on `/api/*` and `/auth/*`, as a second layer behind the app's own limiter.
- Security > Bots > Bot Fight Mode on.
- Email on the account: turn on two-factor sign-in for Cloudflare and GitHub.

## Review log
- **2026-11-17, independent code review:** no critical findings. Fixed: an open redirect on the `www` address; hidden names still showing on notes and requests; limits that reset when things were deleted; moderation that could be sidestepped; sign-ins that survived account deletion; shared login names after a rename; non-atomic deletion; unindexed public reads; tag-pinned Actions and a job-wide token. Left as accepted: a repository that is already listed can be submitted again if GitHub is rate-limited at that moment (a maintainer reads every submission and publishing refuses a duplicate).
