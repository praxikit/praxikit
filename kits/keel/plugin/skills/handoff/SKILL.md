---
name: handoff
description: Write a short hand-off note so the work can continue in a fresh session at a fraction of the cost — where things stand, decisions made, files touched, what is next. Use when the user says "handoff", "hand off", "start fresh", "new session", "the context is too big", or when Keel's context meter says the conversation is large.
---

# /keel:handoff

Every turn re-reads the whole conversation. After a long session most of that is finished work the next task does not need. A fresh session with a good note costs a fraction as much per turn and answers as well.

## Steps

1. **Write `.keel/handoff.md`** (create the folder if needed; keep it under 60 lines). Sections, in this order:
   - **Goal**: one or two sentences, what the person is trying to get done.
   - **State**: what is built and working, what is half done, what is broken. Include the branch and whether there are uncommitted changes (`git status --short`, summarised).
   - **Decisions**: the choices made and why, one line each, so they are not re-argued. Name the ones the person made themselves.
   - **Files**: the paths that matter for the next step, one line on each.
   - **Checks**: the commands that prove the work, and their last result.
   - **Next**: the single next step, then the ones after it.
   - **Do not**: things already tried and rejected, and standing rules (for example the commit trailer).
2. **Say what is not in the note**: anything you could only know from reading the conversation and chose to leave out. If something important is only in the chat, put it in the note instead.
3. **Give the person the one-line start** for the new session, in a code block: `Read .keel/handoff.md and continue with "Next".` Tell them to open a new session (not /compact: a compacted conversation keeps a long summary and still re-reads it every turn).
4. **Do not keep working** on new tasks in this session after writing it, unless the person asks.

## Rules

- No secrets, tokens or personal data in the note.
- State facts you checked this session; mark anything you did not verify.
- The note is for the next session, not a report for the person: keep it plain and short.
