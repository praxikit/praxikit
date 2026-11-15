# pitch-panel

Put a startup or product idea in front of a six-seat panel that argues against it, then get a verdict, an assumption ledger and one cheap real-world test.

```
/plugin marketplace add praxikit/praxikit
/plugin install pitch-panel@praxikit
/pitch-panel:grill
```

## The six seats

| Seat | Covers |
|---|---|
| **CTO** | Technology: buildable in the time claimed, what is unproven, run cost per user, data and security, platform dependence |
| **CMO** | Market and growth: the exact buyer, bottom-up market size, reaching the first hundred, incumbents and why anyone would switch |
| **COO** | Operations: day-30 reality, regulation and liability, disintermediation, single points of failure |
| **PM** | Product: is the pain validated, the smallest version, why it beats today's alternatives, what success is |
| **CFO** | Financials and business model: unit economics, CAC and payback, lifetime value with the churn assumption stated, cash to break-even, what happens at half the sales |
| **Devil's advocate** | Catastrophic risk: the one scenario that would end the venture and that no other seat raised, with its trigger, warning sign and cheapest hedge |

Together they cover demand, product, competition, market and growth, business model, financials, technology, operations and legal, and catastrophic risk. A topic nobody owned is reported as "not covered".

## What you get

1. Intake: at most five questions, once, or the gaps are listed as assumptions.
2. Six blocks, each with a vote, a 1 to 5 score, one objection, what would change its mind, a question and a number.
3. Where the seats pull against each other, and what all six assumed without saying.
4. An assumption ledger: the five claims the idea leans on most, and the cheapest way to check each.
5. A verdict (**Go**, **Go if**, **Stop**), three conditions, two kill triggers and **one** test you can run this week, with the pass bar written down before you run it.

## What it will not do

- Invent market sizes, prices or competitors. Every number is tagged as yours, sourced from a page it opened, or an assumption.
- Predict success. It is a structured argument from one model, not real investors.
- Replace talking to people who would pay.

The default is one pass, which is cheap. **Deep mode** (separate sub-agents per seat) is used only when you ask or the stakes are high, and it costs many times more tokens.

It has no scripts, no hooks and no network code. It writes a file only if you ask (`docs/pitch-panel.md`).

Not affiliated with any television programme or brand. Written from scratch for Praxikit; MIT licence.
