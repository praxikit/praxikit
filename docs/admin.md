# Running the catalogue (admin guide)

Everything is done in the app at `https://praxikit.com`. Maintainers (owners of the `praxikit` organisation and members of its `maintainers` team) see an **Admin** tab first in the navigation after signing in. Setup and deployment: `docs/go-live.md` and `api/README.md`.

## What people can do

- **Submit a kit** (their own, or someone else's) at `/submit/`: paste a public GitHub repository link and sign in with GitHub. GitHub decides whether they are the author or a recommender, never the form.
- **Keep a private collection** and download or delete their data in **Settings**.
- **Report a listing** with the **Report a listing** issue form, or privately through GitHub's private vulnerability reporting for malicious code or leaked secrets.

## What you do

| You want to | Do this |
|---|---|
| **Review a submission** | Admin, open the submission, press **Run the full checks**, read the report, then **Approve and publish** (confirm the name, type, card text and tags; tick *I use this kit* and write a note to make it one of your picks) or **Reject** with a reason the submitter sees. Approval is only possible after the checks ran, and is pinned to the commit they ran on. |
| **Submit something yourself** | The same form. As a maintainer your submission is published directly after the scan, but only if the result has nothing to look at; otherwise it waits for review. |
| **Edit a live listing** | Admin, **Manage live listings**: name, card text, tags and the pick note. What was reviewed (repository, commit, checks) never changes here. |
| **Remove a listing** | **Manage live listings**, choose a reason, tick the confirmation. It is logged publicly in `docs/removals.md`. |
| **Review notes** | Admin, **Review notes**: Show, Hide or Delete. A person's first note waits here; a note two people report is hidden here until you decide. |
| **Add one the checks refused** | Actions, **Add listing**, Run workflow (it has a switch to allow failed checks). |

- Approving, editing and removing need a sign-in from the last 30 minutes. The app only starts GitHub Actions jobs with fixed inputs; the jobs commit the change and the site redeploys.
- The checks never run a submitted repository's code. They read it at one commit and report licence, secret-like strings, code that runs automatically, network access, binaries and hidden instructions. A result is a starting point, not a decision, and never says a kit is safe.
- A listing records the **commit that was read** and the **check result**. If the repository moves on, nothing changes by itself: the daily `listing-drift` job marks it **Changed since review** (it only asks the GitHub API whether the default branch has commits after the reviewed one). When you have read the new code, run **Add listing** with **replace** ticked to record the new commit.

## Where entries live

`site/listings.json`: `name`, `url`, `author`, `why`, `kind`, `source`, `added`, `commit`, `checks`, optional `pick` and `note`, `tags`. `source` is `recommended` (someone else's) or `community` (submitted by its author). `scripts/listings.mjs` and `site/listings.mjs` validate every entry, and the site build refuses an invalid one.

## Picks and listed kits

The catalogue has three kinds of entry. **Built by Praxikit** kits are the ones in `kits/`. **My picks** are other people's kits that you actually use, with a one-line note on how. Everything else is **Listed**: scanned and read, not endorsed. Nothing is listed for payment.

## Reports and removals

- The policy page (`/policy/`) states the response aims: reply within 3 days, remove malicious or leaked-secret listings the day you read the report, decide other reports within 14 days. They are aims for one part-time maintainer, not a service level. Keep them true or change the page.
- There is no second approver yet. Adding one (a collaborator with write access) is the main remaining gap named on the policy page.

## Safety notes

- The job that reads a submitted repository has a **read-only** token. A separate job holds the write access and validates the entry again before committing.
- Nothing from a submitted repository is executed, installed or checked out with its hooks, symlinks or submodules.
- Everything that comes from a repository or a person is cleaned before it is shown and escaped again on the site.
