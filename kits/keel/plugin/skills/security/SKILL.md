---
name: security
description: Run Keel's security track on a project — wire free scanners into CI, fill the entry-point table from the real code, walk the pre-launch checklist ticking only what has evidence, write the OWASP Top-10 review, and say whether a paid human pentest is warranted. Use when the user says "security review", "pre-launch checklist", "OWASP", "add security scanning", "is this safe to launch", or when a phase's Security line is due.
---

# /keel:security

This is a threat model, scanners and an evidenced checklist. It is not a penetration test, and it never says a project is "secure".

## Steps

1. **Read** `docs/plan/04-security.md` (create it from `${CLAUDE_PLUGIN_ROOT}/templates/docs/plan/04-security.md` if missing) and the stack in `docs/plan/02-decisions.md`.
2. **Scanners.** If `.github/workflows/security.yml` is missing, copy `${CLAUDE_PLUGIN_ROOT}/templates/ci/security.yml` there. Remove the jobs the stack does not need (no npm, no pip). Keep gitleaks and Semgrep. Show the user the final file before writing it.
3. **Entry points.** Find every route, API handler, form, upload, webhook and admin surface in the code (search; do not guess). Fill the Entry points table: auth, input, risk, mitigation. An entry point you did not find in code does not go in the table.
4. **Checklist, with evidence.** For each item in the Pre-launch checklist, find evidence in the code or by running a command (a grep of the client bundle, a test that requests each route signed out, a header check). Tick `[x]` only with the evidence written beside it (file:line or command output). No evidence means it stays `[ ]` with what is missing. Never tick from memory or from a plan.
5. **OWASP Top-10.** Fill the table with one finding per category, grounded in files you read. "Not applicable" needs a one-line reason.
6. **Pentest decision.** Write the recommendation: a paid human review is warranted if the project holds payment data, health or other sensitive personal data, handles other people's money, has multi-tenant data, or is a high-value target. Say why or why not.
7. **Log** a short entry in `docs/plan/05-progress.md` with the scanner results and what is still open.
8. **Report** the count of ticked items, the open ones ranked by severity, and the pentest recommendation. State plainly that scanners found no known patterns, which is not proof of safety.

## Rules

- Evidence or no tick. A scanner passing is evidence for "no known vulnerable dependency", not for "auth is correct".
- Never print or store a secret value you find; report the file and rule, and say to rotate it.
- Do not run scanners against anything the user does not own.
