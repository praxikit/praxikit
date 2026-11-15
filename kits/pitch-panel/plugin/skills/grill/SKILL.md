---
name: grill
description: Put a startup or product idea in front of a six-seat panel (CTO, CMO, COO, PM, CFO and a devil's advocate) that argues against it across technology, market, operations, product, money and catastrophic risk, then return a verdict, an assumption ledger and one cheap real-world test. Use when the user says "grill my idea", "pitch panel", "would this work", "poke holes in my startup", "pre-mortem this", "tear this idea apart", or "/pitch-panel:grill".
---

# /pitch-panel:grill

Pressure-test an idea before money or months go into it. The panel is simulated: a structured argument, not real investors and not a forecast.

## Rules (read these first)

1. **Never invent facts.** Tag every number, competitor and claim: `[you]` given by the user, `[source: <page>]` taken from a page you opened in this session, or `[assumption]` with your reasoning. If you cannot source something, say what would.
2. **Argue against the idea, not the person.** Direct and specific. No flattery, no insults, no jokes at the founder's expense.
3. **Every objection names the evidence that would answer it.** An objection nothing could answer is noise; drop it.
4. **Say plainly when the idea is good.** A panel that always says stop is as useless as one that always says go.
5. **Market size is built bottom-up** (number of buyers times price you can defend), never "1% of a huge market".
6. **You are not an investor.** Say so once, in the last line. Do not predict success or failure.

## Modes

- **Default: one pass.** Write the six blocks yourself, in order. It is cheap and usually enough.
- **Deep, only if the user asks or the stakes are high** (money, a job, other people's savings): run the first five seats in parallel as sub-agents, each given only the idea, its own lens and these rules, with the model set explicitly. Tell the user first that this costs many times more tokens than one pass. The devil's advocate always runs last, in your own context, after reading the other five.

## Step 1: Intake (one round at most)

You need: what it is; who pays and what they pay or do today instead; the alternatives a buyer has; how the first ten customers would hear about it; how it makes money (price and model); who the founder is (skills, time, cash and runway); whether it touches anything regulated (money, health, children, personal data, safety). Ask only for what is missing, in one message, at most five questions, then wait. If the user says "just go", continue and list each gap as an `[assumption]`.

## Step 2: Research (only if the user allows web access)

Look up at most three real alternatives and any rule that obviously applies. Name the pages you opened. If you do not search, write "not checked" and make every seat tag its claims `[assumption]`.

## Step 3: The six seats

Each seat looks through its own lens and does not comment on the others, except the devil's advocate, who speaks last and reads the other five. Together the seats must cover: demand, product, competition, market and growth, business model, financials, technology, operations and legal, and catastrophic risk. If a topic ends up with no owner, say "not covered" in the verdict.

| Seat | Scrutinises | Stop signal |
|---|---|---|
| **CTO**, technology | Can this team build it in the time claimed? What is hard and unproven? Run cost per user, data and security exposure, dependence on one platform or vendor | The core claim is unproven, or run cost per user exceeds what a customer pays |
| **CMO**, market and growth | Exactly who the buyer is (ICP). Bottom-up market size. How the first hundred customers are reached and at what cost. Incumbents and substitutes, and why a buyer would switch | No cheap, repeatable way to reach the first hundred, or the reachable market cannot pay the founder |
| **COO**, operations | Day 30: support, fulfilment, suppliers, hiring. Regulation, licences, liability. Disintermediation: buyers and sellers dealing directly once introduced. Single points of failure | A needed permission cannot be obtained, or one outside party can switch it off |
| **PM**, product | Is the pain validated (who said what, and what did they do about it)? The smallest version that solves it. Why it beats what users do today. What success is, as a metric and a date | The pain is unvalidated with no cheap way to validate it, or no success metric can be named |
| **CFO**, financials and business model | How it earns and whether the model fits the buyer. Unit economics (revenue minus cost to serve). CAC and payback. Lifetime value with the churn assumption stated. Cash to break-even. What happens at half the expected sales | Contribution margin is negative at realistic volume, or payback outlasts the cash |
| **Devil's advocate**, catastrophic risk | The one scenario that would end the venture and that none of the other five raised | The scenario is likely, fatal and cannot be hedged |

Each of the first five seats writes, in under 130 words:

- **Vote:** Back it, Back it if, or Pass
- **Score:** 1 to 5 (5 = strong on this lens; 3 = fixable; 1 = fatal as it stands)
- **Strongest objection** with its evidence tag, and one sentence on why it matters
- **What would change my mind:** a concrete observation or number
- **Question I would ask in the room:** one
- **One number I would want:** and where to get it

The devil's advocate writes: the **scenario** (the mechanism, in two sentences); the **trigger**; **likelihood** (low, medium or high, tagged `[assumption]`); the **earliest warning sign**; the **cheapest hedge**. If every scenario it can think of was already raised, it names the worst one and says why the others under-weighted it.

## Step 4: Cross-examination

Find the two or three places where seats pull against each other (for example the CMO needs a low price and the CFO needs a high one). For each, write "X vs Y: what has to be true for both to hold". Then list **what all six assumed without saying**.

## Step 5: Assumption ledger

A table of the five assumptions the idea leans on most: the claim, which seat relies on it, and the cheapest way to check it.

## Step 6: Verdict

- **Go** if at least five seats back it and no stop signal is met. **Go if** when votes are mixed but no stop signal is clearly met. **Stop** when a stop signal is clearly met and no cheap test could change it.
- **Score:** the total out of 30, shown for reference only. It does not decide the verdict.
- **Conditions:** the three things that must be true, each tied to a seat.
- **Kill triggers:** two numbers that, if seen, mean stop (for example "fewer than 5 of 20 buyers will pay").
- **This week's test:** exactly one test that takes days, not months, and gathers evidence from real buyers: a priced waitlist, a pre-sale, ten conversations with the person who pays, or a hand-made version delivered by you. Never "build the MVP". State the pass bar as a number the founder commits to before running it.
- **Not checked:** list it (competitors, legal position, real prices, anything tagged `[assumption]` that mattered).

## Step 7: Saving

Print the result. Write a file only if the user asks, and then only to `docs/pitch-panel.md`.

## Output shape

```
# Pitch panel: <idea in five words>
Mode: one pass | deep      Research: done | not checked
Assumptions: <anything the user did not say>

## CTO   Vote: ...   Score: n/5
...one block per seat; the devil's advocate last...

## Where the panel disagrees
...
What all six assumed without saying: ...

## Assumption ledger
| Claim | Relied on by | Cheapest check |

## Verdict: Go | Go if | Stop   (score n/30)
Conditions: 1. ... 2. ... 3. ...
Kill triggers: ... / ...
This week's test: ... Pass bar: ...
Not checked: ...

I am not an investor and this is not a prediction; talk to real buyers before you decide.
```
