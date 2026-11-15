# keel

**Keeps a software project on course when AI agents build it.**

Keel is a method plus a Claude Code plugin. The method: write the plan at the project root, argue
against it before any code, split it into phases that each prove themselves, give each task to the
cheapest model that can do it, and go back through the same gate the moment the idea changes. The
plugin automates that inside Claude Code. The method and prompts work with any agent.

Honest scope: Keel is not a pentest, not a model classifier, and does not route models for tools
other than Claude Code. It will tell you when a project warrants paying a human for security.

## Install (Claude Code)

```
/plugin marketplace add praxikit/praxikit
/plugin install keel@praxikit
```

Then, in any project:

| Command | What it does |
|---|---|
| `/keel:plan` | Brief → critique gate → decisions → phases with checks → security notes, all in `docs/plan/` |
| `/keel:critique` | The gate alone, on a plan, an idea or a PR. Returns a verdict. |
| `/keel:delegate <task>` | Writes a full brief and hands the task to the right tier (Scout / Builder / Reviewer) |
| `/keel:verify [phase]` | Runs a phase's acceptance checks, pastes the output, marks it passed or not |
| `/keel:cost` | Full token and cost table per model for the last prompt and the session, sub-agents included |
| `/keel:settings` | Turn the For you / Task list / cost footer on or off; choose which models tasks are distributed among and each tier's model |
| `/keel:security` | Free scanners in CI, entry-point table from the code, pre-launch checklist ticked only with evidence, OWASP review |
| `/keel:replan <change>` | The idea changed: back through the gate, decisions and phases edited, logged |

Agents the plugin adds: `keel:critic` (your session's model), `keel:builder` (Sonnet),
`keel:reviewer` (Sonnet), `keel:scout` (Haiku).

Each prompt ends with a **For you** section (what only you can do, step by step) and a **Task list** (`[x]` done, `[>]` in progress, `[ ]` next; emoji marks optional) when there is something to show, followed by a one-line token and cost estimate per model. These are on by default, with nothing to enable; switch any of them off in `/keel:settings`.

A drift hook warns once per session when an edit lands outside the current phase's Files list.

A hook refuses any `Agent` call that names no model, so nothing runs on your most expensive model
by accident. `fork` and Keel's own agents pass; set `KEEL_ALLOW_AGENTS=my-agent,other` for agents
you have pinned yourself.

## The method, without the plugin

Read [`plugin/method/METHOD.md`](plugin/method/METHOD.md). Copy [`plugin/templates/docs/plan/`](plugin/templates/docs/plan/)
into your project. Paste the prompts in [`plugin/method/prompts/`](plugin/method/prompts/) into whatever model
you use. Adapters for Cursor and Codex-style agents are in [`adapters/`](adapters/).

## The six documents

```
docs/plan/
  00-brief.md       what, who, why now, done-looks-like, constraints, non-goals
  01-critique.md    the critic's eight answers and a verdict, dated, every round kept
  02-decisions.md   one row per decision with why and what was rejected; the stack and its tiers
  03-phases.md      MVP then sub-phases: goal, files, tasks with tiers, acceptance checks, security
  04-security.md    threat model, scanners, pre-launch checklist, OWASP review
  05-progress.md    what happened, newest first, with pasted check output
```

## Why the critique gate

Most wasted work is work that should not have started. The critic answers eight questions in
writing before a line is written: is it needed, does it exist, the simplest version,
over-engineering, what breaks, cost by tier, attack surface, the counter-argument. The verdict is
one of three words. The owner decides, and the decision is recorded. See
[`plugin/method/prompts/critique.md`](plugin/method/prompts/critique.md).

## Why tiers, and what they save

The saving is the brief, not the routing. A mid-tier model with a tight brief (goal, exact files,
steps, acceptance checks, do-nots) finishes in one pass. The same model with "improve the CSS"
costs more than the lead doing it. Expect a third to a half off on implementation-heavy work, and
little on work that is mostly judgment. Running the lead one tier down for routine sessions saves
more than any sub-agent routing.

## Status

v0.3 — drift hook, security skill, configurable models, For you / Task list format and a per-prompt cost footer. Install tested by the owner on 2026-11-15. Still to do: adapters tested on a real project. See [Keel's own plan](docs/plan/03-phases.md).

## Licence

MIT.
