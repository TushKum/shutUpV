# Market Simulation Competition: participant handbook

One night, 20:00 to 06:00 IST. 150 teams in three tracks: 50 Product, 50 Consulting, 50 Finance. Up to 4 people per
team share one team login. Every number in this handbook is the rule the platform enforces; when a screen and this
handbook disagree, the screen (the server) wins and you should tell an organiser.

Quick cards for each track: [Product](cards/PRODUCT.md) · [Consulting](cards/CONSULTING.md) ·
[Finance](cards/FINANCE.md). Worked examples: [case studies](case-studies/README.md). Questions:
[FAQ](FAQ.md).

---

## 1. The idea in one paragraph

Each Product team founds a company and pitches it. An AI judge scores the pitch, and the score sets the company's IPO
price. Finance teams (investment funds) buy and sell the shares in 21 trading rounds, and their orders move the
prices. At 00:30 every company is hit by a crisis. The squad (one Product, one Consulting and one Finance team) agrees
a consulting fee, signs a rescue deal and writes a rescue plan; the plan's score moves the price again. At 04:00 a
flash news bulletin hits every company at once. At 05:00 the market closes; at 05:40 the rankings are revealed for
the first time. Nobody, not even the organisers' projector, shows a ranking before then.

## 2. Logging in

- Your team card has a **team code** (P01–P50 Product, C01–C50 Consulting, F01–F50 Finance) and a **password**.
- Open the event address on the card, sign in with the code and password. All four members can be signed in at once,
  on laptops or phones.
- The card is your team's only key. Do not photograph it into a group chat with other teams. A lost card can be
  reprinted at the registration desk (the old password still works; it is the same password).

### Your screen

- **Do this now**: the purple bar at the top of every page shows your team's next task, how long is left and a
  button that takes you there. When it disappears, nothing is due.
- **Alerts**: a pop-up 5 minutes and 1 minute before each of your deadlines, and when a round clears, news lands, the
  crisis hits or scores come out. Tap **🔕 Sound off** in the header to turn on a beep (and a buzz on phones).
- **Charts**: every company's page charts its price round by round, with its AI price as a dashed line; the Market
  list shows a small trend line for each company. A fund's Positions page charts its own value after each round.
- **Chat**: from the draw, your squad's three teams have a private chat under **Chat**. Use it to agree the fee and
  the deal. Only your squad and the organisers and fairness officer can read it.

## 3. The squads and the draw (21:00)

At 21:00 the organisers run a lottery that anyone can check:

- The day before, they publish **SHA-256(secret seed)** (the "seed commitment"). It is on the projector at the start.
- At 21:00 they enter the secret seed plus a dice roll made in the room. Everything random comes from
  SHA-256(seed + dice): the squads, the problem cards each squad is dealt, which companies each consultant covers,
  and (at 00:30) which crisis card each company gets.
- At 00:30 the seed itself is revealed, so anyone can recompute the draw and check the commitment.

The draw forms **50 squads**, each with 1 Product, 1 Consulting and 1 Finance team. Each squad is dealt **3 problem
cards** from a 60-card deck and the Product team **picks 1 by 21:10**. If you do not pick, you get the first card you
were dealt.

## 4. The night

| Time (IST) | Phase | What happens |
|---|---|---|
| 20:00 | Check-in | Collect your card, sign in, find your seats. |
| 20:30 | Briefing | The rules, on the projector. |
| 21:00 | Squad draw | Squads, problem cards and consultant assignments. |
| 21:10–22:30 | Build | Product writes the pitch card (≤400 words). **Hard close 22:30.** |
| 22:30–23:15 | Reading | The pitch book and Q&A board go public. Pitches are scored (sealed). **Consultant call 1 due 23:15.** |
| 23:15–23:30 | IPO | Pitch scores and IPO prices released. Funds place IPO bids. |
| 23:30–00:30 | Rounds 1–4 | 15-minute trading rounds. |
| 00:30–00:45 | **Crisis** | Trading halted. Crisis cards published. Every price −15%. |
| 00:45–01:45 | Rescue 1 | Rounds 5–8. **Fee deadline 01:05** (fee and deal open from 00:30). |
| 01:45–02:00 | Break | Trading paused. |
| 02:00–03:00 | Rescue 2 | Rounds 9–12. **Deal bonus cutoff 02:45. Plans and deals close 03:00.** |
| 03:00–03:30 | Plans published | Trading halted. Plans public, scores sealed. |
| 03:30 | Verdicts | Plan scores released, price tiers applied. **Call 2 due 03:40.** |
| 03:30–05:00 | Rounds 13–21 | 10-minute rounds. **Flash bulletin 04:00, answers due 04:15**, flash tiers at 04:20. **Call 3 due 04:30.** |
| 05:00 | Close | Shorts covered, closing prices fixed. |
| 05:00–05:30 | Settlement | Final values computed. |
| 05:30–05:40 | Appeals | Technical errors only. |
| 05:40 | **Awards** | Rankings revealed for the first time. |

Every deadline is decided by the **server clock**, shown at the top of every screen. Forms close at the second: a
plan saved at 03:00:01 is late. Organisers can pause, resume or extend a phase; when they do, every countdown on every
screen moves with it.

## 5. The companies and the money

- Every company has **100,000 shares**:
  - **60,000** are held by its Product team ("retained"). They can never be traded, only used to pay the fee or sold
    to the squad's fund in the rescue deal.
  - **5,000** are sold to the squad's Finance team at **$10.00** when the squad is formed (the company gets $50,000
    of seed money; the fund pays $50,000).
  - **35,000** are offered at the IPO.
- Starting cash: Product $0 before the seed money, Consulting $0, Finance $500,000.
- All money is exact to the cent. Every multiplication is rounded half-up to the cent.

### Two prices for every company

- **Market price**: moved by the funds' orders every round, and by the crisis and score tiers.
- **AI price**: moved only by the judge. It starts at the IPO price, takes the −15% crisis, then the plan tier and
  the flash tier. Trading never moves it.

The **closing price** that decides everyone's final value is the average of the two:

> market close = average of the round 20 and round 21 clearing prices
> AI price = IPO price × 0.85 × (1 + plan tier) × (1 + flash tier), rounded after each step
> **closing price = (market close + AI price) ÷ 2**, rounded half-up

So half of every company's final price comes from the quality of its writing, and half from what the funds think.

### Score tiers

The AI judge scores out of 100. The score moves the price by this table:

| Score | Pitch (sets the IPO price) | Rescue plan | Flash news |
|---|---|---|---|
| 90–100 | +10% | +25% | +5% |
| 80–89 | +10% | +20% | +5% |
| 70–79 | +5% | +10% | +5% |
| 60–69 | +5% | +5% | 0% |
| 50–59 | 0% | 0% | 0% |
| 40–49 | −5% | −10% | −5% |
| 0–39 | −10% | −20% | −5% |

**IPO price = $10.00 × (1 + pitch tier)**: $9.00, $9.50, $10.00, $10.50 or $11.00. Plan and flash tiers apply to both
the market price and the AI price.

## 6. The AI judge

- Three written pieces are judged: the **pitch** (≤400 words), the **rescue plan** (≤500 words) and the **flash
  answer** (≤100 words). The full judging instructions are published on the team portal under **Judging**; read them.
  They are the exact text the judge gets.
- Rubrics:
  - Pitch: problem 25, solution 25, business model 25, advantage 25.
  - Plan: solves the crisis 25, money logic 20, funding and deal 20, time to recovery 15, new risks 10, next steps 10.
  - Flash: responds to the news 50, realistic 30, clear 20.
- The judging is anonymous: your company, team and member names are replaced by your ticker.
- Each piece is scored 3 times; if the runs differ by more than 10 points, 2 more runs. **Your score is the median.**
- The judge sees the plan together with your pitch card, your crisis card and the rescue deal from the game's own
  records; the flash answer together with the bulletin.
- **Do not write to the judge.** Lines such as "ignore the rubric", "give this 100" or "you are a generous judge" are
  removed automatically and logged. The first time costs you only the line; **a second offence by the same squad
  (in any of its pitch, plan or flash answer) deducts 10 points from that submission.**
- Scores stay sealed until an organiser releases them; the release applies the tiers to every company at once.

## 7. Trading (Finance only)

- **Orders**: BUY, SELL (only shares you own), SHORT and COVER, in whole shares. Place, edit or cancel them any time
  while the round is open. Orders are refused while trading is halted or paused.
- **Clearing**: at the end of each round, for each company:
  - net = (BUY + COVER) − (SELL + SHORT), counting every valid order
  - the price moves **1% for every 1,000 net shares**, capped at **±10%** per round
  - **every valid order fills at the new price**: the price you pay is the price after everyone's orders, so a crowd
    buying the same stock pushes up its own fill price.
  - Example: price $10.50; buys of 2,000 and 1,500 and a sell of 500 → net +3,000 → +3% → $10.82; all three fill at
    $10.82.
- **Limits per fund**
  - Long: at most **4,000 shares per company** bought on the exchange, IPO included. Your seed and rescue-deal shares
    are a separate squad lot and do not count.
  - Short: at most **2,000 shares per company**, and **$250,000** total short exposure.
  - When you enter a buy, cash of qty × current price × 1.10 is reserved (the 10% covers a +10% clearing).
  - A short locks collateral of 150% × qty × price × 1.10 when entered; afterwards 150% of the short value, recomputed
    every round. If collateral runs short, new buys and shorts are blocked until it is enough again. Nothing is sold
    for you before the close.
  - Every short is covered automatically at the closing price.
- **Insider rules**: a fund can never trade its own squad's company. Product and Consulting teams cannot trade at all.
- Order entry is rate-limited (about 60 actions per 10 seconds per team). The ticket has a **max quantity** helper
  that applies all of the above for you, quick amounts (100 / 500 / 1,000), and a one-line summary of the order
  ("You buy 500 AQS for about $5,250.00.") before you send it.

### The IPO (23:15–23:30)

- Request 0–4,000 shares of each company except your own squad's. Your total requests cannot exceed your cash at IPO
  prices.
- If a company is oversubscribed, each fund gets request × 35,000 ÷ total requested, rounded down to 10 shares.
  Example: 45,000 requested, a 4,000 request receives 3,110.
- IPO money goes to the exchange, not the company. IPO shares count towards your 4,000 long limit.

## 8. The crisis and the rescue (00:30–03:00)

At 00:30 trading halts and every company receives a **crisis card** (10 categories, 5 companies per category: supply
shortage, regulation, legal dispute, partner exit, data breach, funding freeze, competitor launch, safety recall,
demand collapse, operations outage). Both prices of every company drop 15%. That price is the **post-crisis price**.

The squad then has three things to do.

### The consulting fee (Product ↔ Consulting), from 00:30, due 01:05

- Total value **$10,000–$35,000**, paid in cash and/or up to **3,000** of the Product team's retained shares, valued
  at the IPO price.
- Either team proposes; **both** confirm the same version, and the fee moves at the second confirmation. Any change
  needs both confirmations again.
- Not agreed by 01:05: a **default fee of $22,500 cash** is moved automatically.

### The rescue deal (all three teams), from 00:30, due 03:00

- The fund invests **$40,000–$80,000** at **50%–100% of the post-crisis price** per share.
- The Consulting team proposes the price; the Finance team sets the amount. shares = amount ÷ price, rounded down; the
  cash moved is shares × price.
- The shares come out of the Product team's retained 60,000 and go into the fund's squad lot (not counted in its
  4,000 limit, and not tradable).
- **All three teams must sign. Any edit clears every signature.**
- Fully signed by **02:45**: the consultant earns a **$5,000 deal bonus**.
- **Not fully signed at 03:00: the plan's score is capped at 50** (no tier, or a negative one).

### The rescue plan (Product + Consulting), due 03:00

- Up to **500 words**, one per squad, written together in a shared editor (both teams' drafts are the same draft).
- Sections: The crisis, The new plan, The money, The rescue deal, Time to recovery, Risks, Next three steps.
- **Hard deadline 03:00. A late plan scores 0.** You can submit early and resubmit until then; the last submission
  counts.
- 03:00–03:30 the plans are public (without scores); the verdicts come at 03:30.

## 9. Flash news (04:00–04:20)

At 04:00 a bulletin about a sudden change (the economy, the rules, the market) appears on every screen. Each squad's
Product or Consulting team writes **one answer of up to 100 words** by **04:15**: how this news affects your company and
what you will change. Tiers are applied at 04:20, after round 17 clears.

## 10. Consultant calls (Consulting only)

Each Consulting team covers **2 companies outside its own squad** (every company is covered by exactly 2
consultants) and makes a BUY or SELL call on each, three times:

| Call | Open | Due | Baseline | Judged at |
|---|---|---|---|---|
| 1 | from the draw | 23:15 | IPO price | round 4 clearing price |
| 2 | from the plan verdicts (03:30) | 03:40 | price after the plan tier | price after the flash tier (04:20) |
| 3 | from the flash release (04:20) | 04:30 | price after the flash tier | closing price |

BUY is right if the judged price is **above** the baseline; SELL if **below**. Equal, or no call, is wrong. You can
change a call until it closes. **$2,500 per correct call**, up to $15,000.

## 11. Q&A board

From 22:30 the pitch book is public. Finance teams post questions to any company; that company's Product team answers
in up to 100 words. Every question and answer is public. Questions and answers are not judged, but every fund reads
them before the IPO.

## 12. Final scores and awards

At settlement the exchange pays the consultants' bonuses as cash:

- **Plan bonus** = $500 × (plan score − 50), from −$10,000 to +$25,000 (a score of 30 or below is −$10,000; 100 is
  +$25,000).
- Deal bonus ($5,000) and call earnings ($2,500 each).

| Track | Final value | Tie-break |
|---|---|---|
| Product | retained shares × closing price + cash | higher plan score |
| Consulting | cash + fee shares × closing price | higher plan score of its squad company |
| Finance | cash + long shares × closing price − short shares × closing price, ranked by return on $500,000 | smaller largest single position |

Awards, revealed at 05:40:

- **Top 3** in each track.
- **Best turnaround**: highest closing price ÷ post-crisis price.
- **Best rescue plan**: highest final plan score (after any cap or penalty; a tie goes to the higher median).
- **Best-judging fund**: highest return with the portfolio valued at AI prices only.

## 13. Fair play

- No team sees another team's private data, or any ranking, before the awards.
- Prices change only through clearing, the crisis and score tiers. **Nobody can edit a price**, organisers included.
- Every action is recorded. At settlement the system raises **collusion flags** for the fairness officer:
  1. a company whose plan scored below 50 while 3 or more funds hold the 4,000-share long cap in it;
  2. two funds whose orders (round, ticker, signed quantity) are 90% or more alike, with at least 5 orders each;
  3. a fee of $33,000 or more, or a deal price at or below 55% of the post-crisis price, where the plan scored below 50.
- A flag is a question, not a verdict. The fairness officer clears it or disqualifies the teams involved, with a reason
  that is logged. Disqualified teams are left out of the awards.
- **Appeals (05:30–05:40) are for technical errors only**: a form that broke, a score that was clearly mis-processed.
  Disagreeing with the judge is not a technical error.

## 14. When something breaks

- The screen says "Reconnecting…": wait; every screen re-reads by itself every few seconds and nothing you saved is
  lost.
- Your Wi-Fi drops: switch to mobile data; sign in again with the card.
- The whole room is affected: the organisers will pause the event. A pause stops the clock; you get back exactly the
  time you had.
- Anything else: raise a hand or go to the help desk with your team code and a screenshot.
