---
name: report
description: Show where tokens and money went across every Claude Code session on this machine — by model, token type, project and session, the average context re-read per turn, and the habits that bloat a context. Use when the user says "report", "where did my usage go", "audit my usage", "which sessions cost the most", or "/keel:report".
---

# /keel:report [--days N | --since YYYY-MM-DD] [--project text]

The footer is one prompt, `/keel:cost` is one session. This is everything, so the biggest lever shows up.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs"` with the dates the person asked for (for a month: `--since YYYY-MM-01`). It reads the local transcripts and their sub-agents; nothing leaves the machine.
2. Show the report as printed. Do not recompute or round the numbers yourself.
3. Read it out in four lines: which model took the largest share, how much sits in the top five sessions, the average context per turn, and the one habit with the biggest count (screenshots, polling, a very long session).
4. Give the person one or two concrete next steps from this list, whichever the numbers support: start a fresh session per task (`/keel:handoff`); move implementation to a cheaper tier (`/keel:route`); use text snapshots instead of screenshots; stop polling.
5. Always say the dollars are estimates from list prices (`prices.json`, with its date), not an invoice, and that only sessions on this machine are included. A model marked "no price" shows tokens only.

If the person has a monthly limit, tell them to set it once in `~/.claude/keel.json` as `{"limits": {"monthlyLimit": 1500}}`, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs" --write-month-cache` once. That records every session this month as the starting point; after that the footer keeps its own session up to date and shows the month against the limit from 70%. Run the same command again now and then (other machines and parallel sessions are only counted when it runs).
