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
The app recognises maintainers by itself. After any normal sign-in it asks GitHub, with a server-side token, whether the person is an owner of the organisation or in the maintainers team; if so the **Admin** tab appears first in the navigation. The token is `GITHUB_ORG_TOKEN`: a fine-grained personal access token whose resource owner is the `praxikit` organisation, with the organisation permission **Members: Read** and nothing else. Set it with `npx wrangler secret put GITHUB_ORG_TOKEN`.

If it is not set (or GitHub cannot answer), the person is a member, never an admin, and a maintainer can use **Sign in with organisation access** (on the "No access" page and in Settings) instead.
