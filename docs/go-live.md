# praxikit.com: how it is deployed

One Cloudflare Worker serves the website (static files built from `site/`) and the account app (`api/`) on `praxikit.com`; `www.praxikit.com` redirects to it. There is no GitHub Pages site any more.

## Deploying
- **By hand** (from the `api` folder): `npx wrangler deploy`. It builds the site first (`[build]` in `api/wrangler.toml`).
- **Automatically:** the `deploy` workflow does the same on every push to `main` that touches `kits/`, `site/` or `api/`, and the listing workflows start it after they change `site/listings.json`. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a token that can edit Workers, Workers Routes and DNS on the account and the `praxikit.com` zone) and `CLOUDFLARE_ACCOUNT_ID`. Set them with `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID` (each asks for the value).

## One-time settings
- GitHub OAuth app: Homepage `https://praxikit.com`, callback `https://praxikit.com/auth/callback`.
- Database tables: run `api/migrations/0004` to `0006` once each (`npx wrangler d1 execute praxikit-admin --remote --file=migrations/<file>`).
- Worker secrets: `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `GITHUB_DISPATCH_TOKEN` (and optionally a read-only `GITHUB_TOKEN`), set with `npx wrangler secret put <name>`.

## Maintainers
Signing in with the header button gives a member account. A maintainer then uses **Sign in with organisation access** (on the "No access" page, or in Settings), which asks GitHub to confirm membership of the organisation. After that the **Admin** tab appears first in the navigation.
