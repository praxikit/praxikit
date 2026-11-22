---
name: scope
description: Scope an open-ended ask before any building starts — the goal in one sentence, at most three questions as choices, two or three cheap sample options where taste is involved, then a short brief with a size, checks and a budget. Use when the user says "redesign", "makeover", "make it better", "make it the best", "improve everything", "rewrite it", or when Keel's scope-gate reminder appears.
---

# /keel:scope <the ask>

An open-ended ask is the most expensive kind of prompt: the model guesses a direction, builds it, and the person says "not that", and every turn of the rebuild re-reads the whole conversation. Spend a few cheap turns on direction first.

## Steps

1. **Say the goal back in one sentence.** If the conversation already gives the direction (a pick, a reference, a rule), say that and skip to step 4.
2. **Ask at most three questions**, as choices with `AskUserQuestion`, never an open interview. Ask only what changes the work: who it is for, what must not change, what "better" means (faster, calmer, denser, more trustworthy, more on brand). Offer a recommended answer first.
3. **Where taste is involved, show two or three options before building anything.** Cheapest form that can be judged:
   - a text wireframe or a short list (layout, palette, type, density), or
   - one small static page per option, written by a Builder on a cheap tier, a few hundred lines at most.
   Never build the real thing to find out what the person likes. Ask them to pick, mix, or say "none".
4. **Write the brief** (use `${CLAUDE_PLUGIN_ROOT}/method/prompts/brief.md`): goal, what changes, what does not, the task **size** (below), the acceptance checks as commands or observable results, and a **budget** (turns or dollars) after which you stop and report. Put it in `docs/plan/` when the project has one, otherwise in the reply.
5. **Wait for the go.** Building starts after the person approves the brief or picks an option, not before.

## Sizing (how much ceremony a task gets)

| Size | Looks like | Process |
|---|---|---|
| **S** | One file or one behaviour, a clear check | Just do it. No brief, no critique. |
| **M** | A few files, a known approach | A short brief with checks. Delegate the typing. |
| **L** | A redesign, a new feature, a change across the app, anything hard to undo | This skill, the options step, a brief, the critique gate, phases. |

If you are unsure whether it is M or L, treat it as L: the extra turns cost less than a wrong rebuild.

## Rules

- Do not call `Edit`, `Write` or build commands until step 5, except to write the options and the brief.
- Options are for choosing, not for shipping: label them as samples and keep them out of the real source tree.
- If the person says "just do it" after you asked, do it, record the assumption in one line, and keep the budget.
