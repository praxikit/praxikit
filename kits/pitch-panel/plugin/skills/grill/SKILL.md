---
name: grill
description: Put a startup or product idea in front of a five-seat panel (customer, money, build, reach, operations) that argues against it, then return a verdict, the conditions that would change it, and one cheap real-world test. Use when the user says "grill my idea", "pitch panel", "would this work", "poke holes in my startup", "tear this idea apart", or "/pitch-panel:grill".
---

# /pitch-panel:grill

Pressure-test an idea before money or months go into it. The panel is simulated: it is a structured argument, not a set of real investors and not a forecast.

## Rules (read these first)

1. **Never invent facts.** A number about market size, prices, conversion, competitors or costs must be one of: given by the user, taken from a page you actually opened in this session (name it), or marked **assumption** with the reasoning. If you cannot source it, say what would.
2. **Argue against the idea, not the person.** Direct and specific. No flattery, no insults, no jokes at the founder's expense.
3. **Every objection names the evidence that would answer it.** An objection nothing could answer is noise; drop it.
4. **Say plainly when the idea is good.** A panel that always says stop is as useless as one that always says go.
5. **You are not an investor.** Say so once, in the last line, and do not predict success or failure.

## Step 1: Intake (one round at most)

Check you have five things: what it is, who pays, what they do or pay today instead, how the first ten customers would hear about it, and what the founder can do without hiring anyone. Ask only for what is missing, in one message, at most four questions, then wait. If the user says "just go", continue and list each missing item as an assumption.

## Step 2: The five seats

Each seat looks through one lens only and does not comment on the others. Do not let one seat see another's block before writing its own. If you can launch sub-agents you may run the five seats in parallel, giving each only the idea and its own lens plus these rules, and set the model explicitly (a mid-tier model is enough). Otherwise write the five blocks yourself, in order.

| Seat | Looks at | Stop signal |
|---|---|---|
| Customer | Is the pain real, frequent and already paid for? What do people do instead? | Nobody pays today to solve it, or doing nothing is fine |
| Money | Price, cost to serve, margin, payback time, cash needed before it pays back | Margin is thin or negative at realistic volume, or payback outlasts the money |
| Build | What must be built, what is hard, what can break, the smallest version | The hard part is unsolved, or the smallest version still takes months |
| Reach | Who the first ten customers are, how they hear of it, cost to win one | No cheap, repeatable way to reach the first hundred |
| Operations | Day 30: support, suppliers, legal, abuse, dependence on one vendor or one person | One outside party or one person can stop it, or the rules forbid it |

Each seat writes, in under 120 words:

- **Vote:** Back it, Back it if, or Pass
- **Strongest objection:** one sentence, then one sentence on why it matters
- **What would change my mind:** a concrete observation or number
- **Question I would ask in the room:** one
- **One number I would want:** and where to get it

## Step 3: Cross-examination

Find the two places where seats pull against each other (for example Reach wants a low price and Money needs a high one). For each, write "X vs Y: what has to be true for both to hold". Three to five lines in total.

## Step 4: Verdict

- **Go** if at least four seats back it and no seat's stop signal is met. **Go if** when the votes are mixed but no stop signal is clearly met. **Stop** when a seat's stop signal is clearly met and no cheap test could change that.
- **Conditions:** the three things that must be true, each tied to a seat.
- **This week's test:** exactly one test that takes days, not months, and gathers evidence from real buyers: a priced waitlist, a pre-sale, ten conversations with the person who pays, or a hand-made version delivered by you. Never "build the MVP". State the pass bar as a number the founder commits to before running it.
- **What the panel did not check:** list it (for example competitors, legal position, real prices).

## Step 5: Saving

Print the result. Write a file only if the user asks, and then only to `docs/pitch-panel.md`.

## Output shape

```
# Pitch panel: <idea in five words>
Assumptions: <anything the user did not say>

## Customer   Vote: ...
...one block per seat...

## Where the panel disagrees
...

## Verdict: Go | Go if | Stop
Conditions: 1. ... 2. ... 3. ...
This week's test: ... Pass bar: ...
Not checked: ...

I am not an investor and this is not a prediction; talk to real buyers before you decide.
```
