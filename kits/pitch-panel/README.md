# pitch-panel

Put a startup or product idea in front of a five-seat panel that argues against it, then get a verdict, the conditions that would change it, and one cheap real-world test.

```
/plugin marketplace add praxikit/praxikit
/plugin install pitch-panel@praxikit
/pitch-panel:grill
```

## What it does

1. Asks for anything missing (at most four questions, once), or lists the gaps as assumptions.
2. Five seats each look through one lens: **Customer**, **Money**, **Build**, **Reach**, **Operations**. Each gives a vote, its strongest objection, what would change its mind, one question and one number.
3. Shows where the seats pull against each other.
4. Gives a verdict (**Go**, **Go if**, **Stop**), three conditions, and **one** test you can run this week with the pass bar written down before you run it.

## What it will not do

- Invent market sizes, prices or competitors. Unsourced numbers are marked as assumptions.
- Predict success. It is a structured argument from one model, not real investors.
- Replace talking to people who would pay.

It has no scripts, no hooks and no network code. It writes a file only if you ask (`docs/pitch-panel.md`).

Not affiliated with any television programme or brand. Written from scratch for Praxikit; MIT licence.
