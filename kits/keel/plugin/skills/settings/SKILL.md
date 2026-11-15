---
name: settings
description: View or change Keel's defaults for this project — the For you section, the Task list section, the cost footer, which models tasks may be distributed among, and which model each tier uses. Use when the user says "keel settings", "change the models", "turn off the footer", "only use sonnet and haiku", or "/keel:settings".
---

# /keel:settings

Settings live in `.keel/config.json` at the project root. The plugin's own defaults are in `${CLAUDE_PLUGIN_ROOT}/defaults.json` and `${CLAUDE_PLUGIN_ROOT}/tiers.json`; the project file overrides them.

1. **Show the current state.** Read `${CLAUDE_PLUGIN_ROOT}/defaults.json`, `${CLAUDE_PLUGIN_ROOT}/tiers.json` and `.keel/config.json` (if present). Print one short table: each default on or off, the allowed models, and the model each tier resolves to.
2. **Ask what to change** with the question tool, only for what the user named. Options:
   - **Sections and footer:** For you, Task list, cost footer (each on or off), and the task marks: `ascii` (`[x] [>] [ ]`, the default, shows in every terminal) or `emoji` (✅ 🔄 ⬜).
   - **Allowed models:** a multi-select from `haiku`, `sonnet`, `opus`, `fable`. These are the models Keel may send tasks to. Claude Code can only route sub-agents to Claude models.
   - **Tiers:** for scout, builder, reviewer and critic, pick a model from the allowed list, or `inherit` to use the session's model.
3. **Check the result makes sense.** Every tier's model must be in the allowed list (or `inherit`). If not, tell the user which tier and propose a fix; do not save an inconsistent file.
4. **Write** `.keel/config.json`, keeping keys the user did not touch:
   ```json
   { "defaults": { "forYou": true, "taskList": true, "costFooter": true, "marks": "ascii" },
     "models": ["haiku", "sonnet"],
     "tiers": { "scout": "haiku", "builder": "sonnet", "reviewer": "sonnet", "critic": "inherit" },
     "prices": {} }
   ```
5. **Say what applies when.** Footer and tier changes apply immediately. For you and Task list are injected when a session starts, so they apply from the next session (or after `/clear`).
6. Mention that `.keel/config.json` can be committed to share the setup, or listed in `.gitignore` to keep it personal.
