# Running the catalogue (admin guide)

The catalogue has no server and no admin website. GitHub is the admin panel: it handles sign-in, permissions and history.

## What people can do

- **Submit a kit** or **recommend someone else's** through the issue forms (`Submit a kit`, `Recommend someone else's kit`). Both open a public issue.
- A bot (`submission-check`) reads the linked github.com repository **without running it** and comments what it found. It adds one label: `no-flags-found`, `checks-flagged`, `checks-failed` or `needs-manual-review`. None of these means "safe".

## What you do (you need write access)

| You want to | Do this | What happens |
|---|---|---|
| **Approve** a submission | Add the label `approved` to the issue | `listing-review` re-reads the repository, pins the entry to that commit, adds it to `site/listings.json`, redeploys the site, comments, labels `listed` and closes the issue. Refused if the checks fail (see below). |
| **Reject** a submission | Add the label `rejected` (write your reason as a comment first) | The issue gets a short comment and is closed. |
| **Add one yourself, no approval** | Actions, **Add listing**, Run workflow, fill in the form | Same scan, then it is committed straight to `main` and the site redeploys. |

- Only people with write access are obeyed when they add `approved` or `rejected`; anyone else's label does nothing.
- If the checks **failed** (secret-like strings, no licence, repository unreachable) an approval is blocked and the issue says why; the `approved` label is removed so you can try again after the submitter fixes it. When you add a kit yourself you can tick **allow failed** to list it anyway.
- A listing records the **commit that was read** and the **check result**; the site shows both. If the kit changes later, nothing updates by itself: edit the issue to re-run the checks, or run **Add listing** again after removing the old entry.

## Where entries live

`site/listings.json`, a list of entries (`name`, `url`, `author`, `why`, `kind`, `source`, `added`, `commit`, `checks`, optional `issue`). `source` is `recommended` (someone else's, you vouch for it) or `community` (submitted by its author). `scripts/listings.mjs` and `site/listings.mjs` validate every entry; the site build refuses an invalid one. To remove a listing, delete its entry from the file and commit.

## Safety notes

- The job that reads a submitted repository has a **read-only** token. A separate job holds the write access and validates the entry again before committing.
- Nothing from a submitted repository is ever executed, installed or checked out with its hooks, symlinks or submodules.
- Everything that comes from an issue or a repository is cleaned before it is shown in a comment and escaped again on the site.
- Nothing is listed for payment.
