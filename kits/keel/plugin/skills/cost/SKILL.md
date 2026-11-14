---
name: cost
description: Show the full token and cost table per model for the last prompt and the whole session, including sub-agents. Use when the user says "cost", "how much did that cost", "token usage", "which model used what", or "/keel:cost".
---

# /keel:cost

The one-line footer after each prompt is the short version. This is the full table.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/cost.mjs"` from the project directory. It reads this session's transcript and the sub-agent transcripts, and prints a table per model for the last prompt and for the session.
2. Show the table as printed, in a code block. Do not recompute or round the numbers yourself.
3. Add two lines of reading: which model took most of the cost, and whether any work that went to the lead model could have gone to a cheaper tier under `tiers.json`. Say plainly if the sample is too small to tell.
4. Always say the figures are estimates from list prices (`prices.json`, with its date). Subscription users do not pay these amounts. A model marked "no price" shows tokens only; offer to add its price under `prices` in `.keel/config.json`.

If the script reports no transcript, say so; do not estimate from memory.
