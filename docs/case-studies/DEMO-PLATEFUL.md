# Demo case study: Plateful (PLTF), one squad through three rounds

A worked example of the Market Simulation night (150 teams: **50 Product, 50 Consulting, 50 Finance**), following one
squad from the draw to the awards. Every number follows the competition rules (docs/archive/BRIEF-market-sim.md) and
was checked by calculation. Use it in the briefing, in training before the event, and at the help desk.

| Squad 12 | Track | Team | Code | Job tonight |
|---|---|---|---|---|
| The company | Product | **Plateful** | P12 | Builds the company, writes the PRD, survives the crisis |
| The advisers | Consulting | **Meridian Advisory** | C31 | Earns a fee, writes the rescue plan with Plateful, makes market calls on two *other* companies |
| The investor | Finance | **Banyan Capital** | F08 | Seeds Plateful, invests in the rescue, trades every other company |

Two outsiders appear too: **Oakwood Fund** (F21), another fund, and **Keystone Partners** and **Lumen Advisory**, the
two consultants the lottery assigned to cover Plateful.

**Problem card picked:** *Food and campus life: college canteens throw away 20–30% of cooked food every day, while
students skip meals to save money.*

---

## Round 1 · Build and IPO (21:00–00:30)

### 21:00 The draw

The lottery (seed + dice, checked against the published commitment) forms squad 12 and deals it three problem cards.
Plateful has 10 minutes to pick one; it takes the canteen-waste card.

| Who | What happens | Cash | Shares |
|---|---|---|---|
| Plateful | 5,000 seed shares sold to Banyan at $10.00 | **$0 → $50,000** | 60,000 retained (locked) |
| Banyan | Buys the seed shares (squad lot) | $500,000 → **$450,000** | 5,000 PLTF in its squad lot |
| Meridian | Assigned two *other* companies to cover (not PLTF) | $0 | – |
| The exchange | 35,000 PLTF shares to sell at the IPO | | |

### 21:10–22:30 Product: the PRD (≤800 words, seven sections)

Plateful's PRD (excerpt from Problem, Solution, Business model and Competitive edge):

> *Every evening, campus canteens bin 20–30% of what they cooked. Plateful sells that surplus as ₹40 "rescue boxes"
> that students reserve on an app between 8 and 9 pm. The canteen gets ₹25 a box for food it would throw away; we keep
> ₹15. Three canteens at our college already waste ~350 meals a day: at a 40% sell-through, that is 140 boxes and
> ₹2,100 a day for us before costs. Our edge is the canteen contracts and the pickup routine, not the app.*

**The judge** reads it three times: **81, 83, 86** → the median **83** is in the **80–89** band → PRD tier **+10%**:

> **IPO price = $10.00 × 1.10 = $11.00.** The AI price also starts at **$11.00**.

*Why 83 and not 90+:* the problem and business model were sharp and the success metrics measurable (boxes a day,
waste %), but the Key risks section skipped hygiene and "our edge is the contracts" is thin: any
rival can sign the next canteen.

### 22:30–23:15 Reading and Q&A

The PRD book goes public. On the Q&A board a fund asks: *"What stops the canteen keeping the ₹25 by selling boxes
itself?"* Plateful answers (≤100 words): the app brings the buyers and the payment; the canteen has neither.

**Consulting, call 1** (due 23:15, baseline = IPO price $11.00, judged at the round 4 clearing):

- Keystone Partners: **BUY** PLTF.
- Lumen Advisory: **SELL** PLTF.

### 23:15–23:30 The IPO (Finance)

Funds bid for the 35,000 IPO shares (max 4,000 each; Banyan cannot bid on its own squad company). Total requests:
**52,000 shares** → oversubscribed → every request is scaled by 35,000 ÷ 52,000, rounded **down** to 10 shares.

> Oakwood requested 4,000 → 4,000 × 35,000 ÷ 52,000 = 2,692.3 → **2,690 shares** for **$29,590**. The money goes to the
> exchange, not to Plateful.

### 23:30–00:30 Trading rounds 1–4

Each round: net = shares bought − shares sold; the price moves 1% per 1,000 net shares (capped at ±10%); every order
fills at the new price.

| Round | Net shares | Change | PLTF price |
|---|---|---|---|
| 1 | +4,200 | +4.2% | $11.00 → **$11.46** |
| 2 | +2,500 | +2.5% | → **$11.75** |
| 3 | −1,800 | −1.8% | → **$11.54** |
| 4 | +600 | +0.6% | → **$11.61** |

**Call 1 judged:** $11.61 > $11.00 → Keystone's BUY is **correct (+$2,500)**; Lumen's SELL is wrong.

---

## Round 2 · Crisis and rescue (00:30–03:00)

### 00:30 The crisis card: *Regulation*

> *New food-safety rules: cooked food may be resold only within 2 hours of cooking and must be kept below 5 °C until
> pickup. Fines start next month.*

Trading halts; both prices fall **15%**:

| | Before | × 0.85 | After |
|---|---|---|---|
| Market price | $11.61 | | **$9.87** ← the post-crisis price |
| AI price | $11.00 | | **$9.35** |

The rescue-deal price band is now **50%–100% of $9.87 = $4.94–$9.87** per share.

### 00:30–01:05 The fee (Product ↔ Consulting)

Meridian proposes **$15,000 cash + 1,500 shares** (shares count at the IPO price: 1,500 × $11.00 = $16,500).
Total **$31,500**: inside $10,000–$35,000 and under the 3,000-share limit. Both confirm at 00:52 (without agreement,
a $22,500 cash fee would move automatically at 01:05).

| | Cash | Shares |
|---|---|---|
| Plateful | $50,000 → **$35,000** | 60,000 → **58,500** |
| Meridian | **$15,000** | **1,500** fee shares |

### 00:30–02:45 The deal (all three teams)

Banyan offers **$72,000** (allowed: $40,000–$80,000) at **$8.00** a share (81% of the post-crisis price).
shares = floor($72,000 ÷ $8.00) = **9,000**; cash moved = 9,000 × $8.00 = **$72,000**.
All three teams sign at **02:10**, before the 02:45 cut-off, so Meridian earns the **$5,000 deal bonus**.

| | Cash | Shares |
|---|---|---|
| Plateful | $35,000 → **$107,000** | 58,500 → **49,500** retained |
| Banyan | −$72,000 | squad lot 5,000 → **14,000** (cost $50,000 + $72,000 = **$122,000**) |

*Why $8.00?* At $4.94 Banyan would get 14,574 shares for the same money, taking 5,574 more from Plateful, and a deal at
≤55% of the post-crisis price with a weak plan raises a collusion flag. At $9.87 Banyan gets only 7,294 shares and may
refuse to sign, and **without a signed deal the plan is capped at 50**.

### 00:30–03:00 The rescue plan (Product + Consulting, ≤500 words)

Plan (excerpt):

> *Move pickup to 7:30–8:30 pm so every box is sold within 2 hours of cooking. Use $30,000 of the deal money for 12
> insulated chillers (₹2.1 lakh, payback in 9 weeks). Raise the box to ₹45; the canteen still gets ₹25. Month 1:
> two canteens compliant; month 3: all three, 160 boxes a day; break-even in month 4. Risk: inspectors reject the
> chillers. Plan B: partner with the college's central kitchen, which already has cold storage.*

Submitted at **02:51** (a late plan scores 0). Meanwhile trading continues in rounds 5–12; at the round 12 clearing
PLTF is at **$9.40**.

---

## Round 3 · Verdicts, flash news and the close (03:00–05:40)

### 03:30 Verdict on the plan

Judge runs **74, 77, 79** → median **77** → the **70–79** band → plan tier **+10%** on both prices (the deal was signed,
so no cap):

| | Before | × 1.10 | After |
|---|---|---|---|
| Market price | $9.40 | | **$10.34** |
| AI price | $9.35 | | **$10.29** |

Meridian's plan bonus: $500 × (77 − 50) = **$13,500**.

**Call 2** (due 03:40, baseline $10.34, judged after the flash tier): Keystone **BUY**, Lumen **SELL**.

### 04:00–04:20 Flash news

The 04:00 bulletin hits every company: *"Cooking-gas prices rise 30% overnight."* Plateful answers in 86 words:
cheaper evening batches and a ₹5 surcharge on boxes for two weeks. Score **74** → the **70–79** flash band → **+5%**,
applied after round 17 clears (PLTF at $11.20):

| | Before | × 1.05 | After |
|---|---|---|---|
| Market price | $11.20 | | **$11.76** |
| AI price | $10.29 | | **$10.80** ← final AI price |

**Call 2 judged:** $11.76 > $10.34 → Keystone's BUY **correct**, Lumen's SELL wrong.
**Call 3** (due 04:30, baseline $11.76, judged at the closing price): Keystone **SELL**, Lumen **BUY**.

### 05:00 The close

Rounds 20 and 21 clear at **$11.90** and **$12.30**.

- Market close = ($11.90 + $12.30) ÷ 2 = **$12.10**
- AI price = **$10.80** ($11.00 → $9.35 → $10.29 → $10.80)
- **Closing price = ($12.10 + $10.80) ÷ 2 = $11.45**

**Call 3 judged:** $11.45 < $11.76 → Keystone's SELL **correct**. Keystone went 3 for 3 on PLTF (**$7,500**); Lumen 0 for 3.

### Final values

| Team | Calculation | Final |
|---|---|---|
| **Plateful** (Product) | 49,500 retained × $11.45 + $107,000 cash | **$673,775** |
| **Meridian** (Consulting) | $15,000 fee cash + $13,500 plan bonus + $5,000 deal bonus + $10,000 from its own calls (4 of 6 correct) = $43,500 cash, plus 1,500 fee shares × $11.45 = $17,175 | **$60,675** |
| **Banyan** (Finance), squad lot only | 14,000 × $11.45 = $160,300 against a cost of $122,000 | **+$38,300** on the lot |

Plateful's turnaround: $11.45 ÷ $9.87 = **1.16×**. Banyan's full result also counts every trade it made in the other
49 companies (it is ranked on its return on $500,000).

---

## What each track should take away

**Product.** Every share you hand over is value you lose at the close: Plateful gave 1,500 (fee) + 9,000 (deal) and
still finished at $673,775 because the plan held the price up. Writing is your only direct lever: the PRD set the
IPO price, the plan added 10%, the flash 5%.

**Consulting.** The plan earns you the most ($13,500 here; a 90 would have been $20,000). Get the deal signed by 02:45
for the $5,000 bonus *and* to avoid the plan cap of 50. Calls are $2,500 each: read the news and the plans, not the
mood of the room.

**Finance.** Price the rescue so all three teams sign: too cheap raises a flag and starves the company; too dear and
the plan is capped. The closing price is half the AI price, so the market can over-shoot ($12.10 vs $10.80): the
written scores pull everyone back towards it.
