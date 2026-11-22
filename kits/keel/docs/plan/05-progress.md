```# Progress — Keel
```
```## 2026-11-07 — planned, Phase 0 started
```
```- What happened: the method, prompts and templates written; critique round 1 recorded (verdict:
```  build the cut-down version); decisions 1–8; three phases; the five skills and four agents;
```  the model-required hook; marketplace manifest; adapters; README.
```- Checks run (local, 2026-11-07):
```  ```
```  ok .claude-plugin/marketplace.json
```  ok plugins/keel/.claude-plugin/plugin.json
```  ok plugins/keel/hooks/hooks.json
```  hook: no model -> exit 2 with reason; model:sonnet -> 0; keel:builder -> 0; fork -> 0; garbage stdin -> 0
```  frontmatter: 5 skills, 4 agents ok
```  claude plugin validate ./plugins/keel -> Validation passed
```  ```
```  Remaining: the install-from-GitHub smoke test in a Claude Code session.
```- Decisions made: `02-decisions.md` rows 1–8.
```- Open: the install-from-GitHub smoke test needs a Claude Code session (`/plugin marketplace add
```  praxikit/keel`); the trading journal is the first real project to plan with it.
```
```## 2026-11-22 — Phase 3 (v0.7 efficiency) started
```- Why: usage is near the monthly limit and the audit shows context re-reading (long sessions, many screenshots, open-ended asks) is the main cost. Keel needs to make the cheap path the default.
```- First task: `report.mjs` to measure the real shares before tuning. Note: the pasted audit used Opus at $15/$75; `prices.json` (list prices, 2026-11-15) says Opus 5.5 is $4/$20, so that audit's model shares are suspect.
```
```### 2026-11-22 — Phase 3 passed (v0.7.0)
```- Real shares (report.mjs, Nov 1 to 22, list prices from prices.json): about $1,187 estimated; sonnet 39%, fable 33%, opus 26%; cache read 45%, cache write 31%, output 24%; the five heaviest sessions are 97% of it, one session alone is 56%. The pasted audit priced Opus at $15/$75 (prices.json says $4/$20), so its "Opus 58%" was wrong. Cache writes at 31% suggest idle gaps that expire the cache in very long sessions.
```- Built: report.mjs, prompt-hint.mjs (scope gate, context meter, month guard), tool-thrift.mjs, route.mjs, lib/guard.mjs; skills scope, handoff, report, route; critic on its own tier (opus); sizing in METHOD.md and the brief.
```- Checks run:
```  ```
```  node kits/keel/tests/efficiency.test.mjs -> ok
```  node kits/keel/tests/report.test.mjs -> ok
```  node kits/keel/tests/{cost,status,drift}.test.mjs -> ok
```  node scripts/check-kits.mjs -> ok: 2 kit(s) valid
```  claude plugin validate ./kits/keel/plugin -> Validation passed
```  ```
```- Decision: the month guard is a ledger of sessions (no child processes: a test forbids them in the scripts). /keel:report --write-month-cache sets the baseline; the footer updates its own session.
```- Open: not yet tried inside a live session after install (hooks fire from the installed plugin); the router's log starts empty, so it follows the rubric until about five outcomes per kind exist.
