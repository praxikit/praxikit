# Going live on praxikit.com

One Cloudflare Worker serves the website and the account app on one address. GitHub Pages keeps the old address and, after the switch, redirects to the new one (it still answers `versions.json` and the feed, because installed kits check those).

## Once, after `git pull` (in the repository folder)

1. **Database tables** (from the `api` folder; run each file once, in order; skip any you ran before; "duplicate column" means already applied):
   `npx wrangler d1 execute praxikit-admin --remote --file=migrations/0004_picks.sql`
   `npx wrangler d1 execute praxikit-admin --remote --file=migrations/0005_tags.sql`
   `npx wrangler d1 execute praxikit-admin --remote --file=migrations/0006_accounts.sql`
2. **GitHub OAuth app** (github.com → Settings → Developer settings → OAuth Apps → the Praxikit app): set **Homepage URL** `https://praxikit.com` and **Authorization callback URL** `https://praxikit.com/auth/callback`.
3. **Deploy** (from the `api` folder), with a Cloudflare token that can edit Workers, Workers Routes, DNS and D1 on the account and the `praxikit.com` zone:
   `$env:NODE_OPTIONS = "--use-system-ca"`, `$env:CLOUDFLARE_API_TOKEN = Read-Host "Cloudflare token"`, `npx wrangler deploy`.
   It builds the site (`site/dist-app`), uploads it, attaches `praxikit.com` and `www.praxikit.com` and creates their DNS records and certificates.
4. **Check** `https://praxikit.com/`, `https://praxikit.com/healthz`, sign in, open `https://praxikit.com/admin` as a maintainer and look for the **Admin** tab first in the navigation.

## Then, to move the old address

5. `gh variable set MIRROR_TO --body "https://praxikit.com"` then `gh workflow run pages.yml`. Every page on `praxikit.github.io/praxikit` now redirects to `praxikit.com`.
6. Optional, later: set `workers_dev = false` in `api/wrangler.toml` and deploy again, so the long `workers.dev` address stops answering.

To undo step 5: `gh variable delete MIRROR_TO` and run the workflow again.
