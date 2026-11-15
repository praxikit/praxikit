---
name: status
description: One-screen project status for a Keel plan — which phases are done, the current phase and its checks, open decisions, the last progress entry and the cost so far. Use when the user says "status", "where are we", "what's next", "catch me up", or "/keel:status".
---

# /keel:status

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs"` from the project directory. It reads `docs/plan/` and this session's transcript and prints the phases, the current phase's goal and checks, open decisions, the last progress entry and the session cost.
2. Show the output as printed, in a code block. Do not recompute or reword it.
3. Add one line: the single next action (usually "run the current phase's checks with /keel:verify" or "start the next phase"). If the script says there is no plan, offer `/keel:plan` and stop.
4. Read-only: change no files.
