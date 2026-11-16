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

## Reports and removals

- Anyone can report a listing with the **Report a listing** form (label `report`). Malicious code and leaked secrets go through GitHub's **private vulnerability reporting** instead (enabled on this repository); do not discuss those in public.
- To remove a listing: Actions, **Remove listing**, Run workflow, give the repository link and a reason category. It deletes the entry, appends a row to `docs/removals.md` (the public log), commits and redeploys. Only the reason category and a short note are logged.
- The policy page (`/policy/`) states the response aims: reply within 3 days, remove malicious or leaked-secret listings the day you read the report and within 2 days of it, decide other reports within 14 days. They are aims for one part-time maintainer, not a service level. Keep them true or change the page.
- There is no second approver yet. Adding one (a collaborator with write access) is the main remaining gap named on the policy page.

## Changed since review

- The `listing-drift` workflow runs daily (and on demand: Actions, **listing-drift**, Run workflow). For each listing it asks the GitHub API whether the repository's default branch has commits after the reviewed one. It does not clone or run anything.
- Result per listing goes to `site/drift.json` (`same`, `changed` or `unreachable`). The site shows **Changed since review** with a link to the comparison, or **Repository not reachable**. The file, and the site, change only when a status changes. A network or rate-limit failure keeps the previous status.
- Active repositories will show **Changed since review** quickly. That is the point: it says the code moved on, not that it is bad. When you have read the new code, run **Add listing** with **replace** ticked to record the new reviewed commit; it also re-runs the check.

## The admin app (in progress)

`api/` holds a small Cloudflare Worker that signs maintainers in with GitHub (org owners and members of the `maintainers` team). Phase 1 is sign-in and a read-only page; approving, adding and removing move into it in later phases. Setup is in `api/README.md`. The GitHub-side flows described above keep working and stay as the fallback.

Phase 2 adds `/submit` (any GitHub user), `/mine` and, for maintainers, a submissions queue and detail pages on `/admin`. Setup: `api/README.md`. Until phase 3 lets you approve there, new submissions are reviewed by copying them into **Add listing**; the public site still points at the issue forms.

Phase 3 moves approving and rejecting into the app (`/admin/submissions/N`). The app only starts the `approve-submission` workflow; the label flow, **Add listing** and **Remove listing** still work and remain the fallback.

Phase 3b: approving is only possible after the full checks have run (button on the submission page), and the approval is pinned to the commit they ran on. Direct publishing by a maintainer needs a result with nothing to look at.

## Picks and listed kits

The public catalogue has three kinds of entry. **Built by Praxikit** kits are the ones in `kits/`. **My picks** are other people's kits that you actually use: the approve form in the app has an "I use this kit" tick and a one-line "How I use it" note, and the card shows both. Everything else is just **Listed**: scanned and read by a person, not necessarily used, and never called recommended. Who put it forward ("submitted by its author" or "suggested by someone else") is shown small and does not change the tier.

To turn an existing listing into a pick (or to change its note), run **Add listing** on GitHub with the same repository link, **replace** ticked, **pick** ticked and the note filled in.
