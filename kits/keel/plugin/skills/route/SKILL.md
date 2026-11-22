---
name: route
description: Decide which model should do a task, from the task's facts instead of by feel — haiku for lookups and mechanical edits, sonnet for implementation a command can verify, opus for design, root causes, security and critique, fable when the cheaper tier failed or the stakes are highest. Use when the user says "route this", "which model", "who should do this", "pick the model", or before delegating a task.
---

# /keel:route <the task>

Pick the cheapest model that can do the task **and be checked**. A task a command can verify may go cheap: a failed check is caught and the task moves up. A task only judgement can verify goes to a strong model. Sensitive work never goes below the think tier.

## Steps

1. **Work out the facts** (one line each, from the task and the files it touches; do not guess what you can look up):
   - `kind`: find, edit, implement, test, refactor, review, debug, design, critique or security
   - `verifiable`: can a command or a test prove it is right? (yes or no)
   - `ambiguity`: 0 the approach is known, 1 some choices remain, 2 it is an open design question
   - `files` and `lines`: roughly how much changes
   - `paths`: the files it touches (auth, payments, secrets, migrations, CI workflows, hooks and releases are sensitive and set a floor)
   - `failures`: how many times its check has already failed
2. **Run** `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --kind <k> --verifiable yes|no --ambiguity <0-2> --files <n> --lines <n> --paths a,b --failures <n>`. It prints the tier, the model, whether to delegate at all, the floor, and the reasons.
3. **Follow it, or say why not.** If it says do the task inline, do it in this session. If you override it, say so in one line and record why in `docs/plan/02-decisions.md`.
4. **Record the outcome** when the check has run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --record --kind <k> --tier <t> --ok yes|no`. After a few runs the router uses them: a kind that keeps failing at a tier moves up, a kind that keeps passing one tier down may move down (never below a floor).
5. `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --stats` shows the record per kind and tier.

## The tiers

| Tier | Model (default ladder) | For |
|---|---|---|
| haiku | haiku | find, read, measure, summarise, mechanical edits with a check |
| sonnet | sonnet | implement from a clear brief, write tests, refactor, review a normal diff |
| think | opus | design, architecture, a root cause nobody has found, critique, security review, anything sensitive |
| top | fable | the think tier failed its check twice, or the cost of being wrong is highest |

The ladder is `ladder` in `defaults.json` or the project's `.keel/config.json`; a model that is not in `models` is replaced by the next more capable allowed one.

## Rules

- The facts are your judgement; the mapping is code. Do not edit the result to make a task cheaper.
- Never hand a design decision to a cheap model, and never to a task without a check below the think tier unless the ambiguity is 0.
- You cannot change the main session's model. When this phase is design work, tell the person "consider `/model opus` for this phase"; for implementation, Sonnet is enough.
