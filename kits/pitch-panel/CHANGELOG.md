# Changelog — pitch-panel

## 0.2.1 — 2026-11-15
- Fix: the score total was "out of 30" but only five seats score (the devil's advocate does not), so it could never reach 30. It is now out of 25, and the example uses 17/25.
- Fix: the rule for "Go" counted six voting seats. The devil's advocate does not vote, so Go now needs at least four of the five voting seats to say Back it, no stop signal, and a cheap hedge for the devil's advocate's scenario. Found by running the skill on a real idea.

## 0.2.0 — 2026-11-15
- Changed: six seats instead of five. CTO (technology), CMO (market and growth, including competition), COO (operations, regulation, disintermediation), PM (product and validated demand), CFO (financials and business model) and a devil's advocate for catastrophic risk. The devil's advocate speaks last, reads the other five, and must name the one scenario none of them raised, with its trigger, warning sign and cheapest hedge.
- New: every number is tagged `[you]`, `[source: page]` or `[assumption]`; a 1 to 5 score per seat; an assumption ledger; what all six assumed without saying; kill triggers alongside the single test; a coverage check that reports any topic nobody owned.
- New: market size must be built bottom-up, never as a share of a huge market.
- Changed: one pass is the default. Deep mode (parallel sub-agents) is used only when asked or when the stakes are high, and the skill says it costs many times more tokens.

## 0.1.0 — 2026-11-15
- First release: `/pitch-panel:grill`. Five seats (customer, money, build, reach, operations) argue against an idea, each with a vote, one objection, what would change their mind, a question and a number. Then a cross-examination, a verdict (Go, Go if, Stop), three conditions and one cheap real-world test with its pass bar stated in advance.
