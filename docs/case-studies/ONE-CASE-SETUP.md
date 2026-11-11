# One case for every squad: setup guide

**Market Simulation · for organisers** · The Hostel Kitchen

Tonight **every squad plays the same case**. The lottery still forms the 50 squads (one Product, one Consulting and
one Finance team each) and assigns coverage exactly as before; only the cards change.

| Deck | Cards | What happens |
|---|---|---|
| Problem deck | **1** (The Hostel Kitchen) | At the draw every squad gets this card, **already chosen**. No pick, no pick deadline. |
| Crisis deck | **1** (Regulation: the food-safety rule) | At 00:30 **every company** gets the same crisis. |
| Flash bulletin | Cooking gas up 25% | Published at 04:00 to everyone, as usual. |

A deck of 52 or more cards (squads + 2) still works the old way: 3 cards per squad, pick within 10 minutes.

---

## 1. Update the platform (once)

Run these on your laptop, in the project folder:

| Step | Command / action |
|---|---|
| 1. Get the new code | `git pull` |
| 2. Update the database | `npx supabase db push` (adds the one-case change, migration 26) |
| 3. Update the website | Render redeploys from GitHub on its own; wait until the deploy shows **Live** |

If you use Codex for the matrix theme on the same branch, run `git pull` before starting it.

---

## 2. Upload the decks (before the lottery)

Log in as an organiser and open **Admin → Content**:

| Panel | Upload this file |
|---|---|
| Problem deck | `seed/one-case/problem-cards.csv` |
| Crisis deck | `seed/one-case/crisis-cards.csv` |
| Flash bulletin | `seed/flash-bulletins/07-cooking-gas.csv` |

Check the problem panel reads: **"1 card: every squad plays this same case (nothing to pick)."**

**Both decks lock when the lottery is drawn.** Upload them before you run the draw.

Setting up a fresh event instead? Seed it with the decks directly:

    pnpm seed --slug live-2026 --date 2026-11-20 \
      --problems seed/one-case/problem-cards.csv --crises seed/one-case/crisis-cards.csv

---

## 3. On the night

| Time | What you do | What teams see |
|---|---|---|
| Briefing | Hand **CASE-HOSTEL-KITCHEN.pdf** to every squad | – |
| 21:00 Draw | Enter the seed and dice as usual | Squad formed; panel **"The case"** with an **Every squad** badge |
| 21:10 | Nothing to wait for: there is no pick | Product starts the PRD straight away |
| 00:30 Crisis | Advance as usual | Every company gets **the food-safety rule** |
| 04:00 Flash | Publish the prepared bulletin | Cooking gas +25% |

Keep **CASE-HOSTEL-KITCHEN-facilitator.pdf** for organisers and judges only: it has the model answers and the scores
to expect.

---

## 4. Quick checks

| Check | Expected |
|---|---|
| Admin → Content, problem deck | 1 card |
| Admin → Content, crisis deck | 1 card, 1 category |
| Start gate (Setup) | No warning about the deck size |
| After the draw, Admin → Lottery | Every squad shows the same card, chosen |
| A team's Squad page | "The case" panel, no "Pick closes" line |

**If the upload is refused** with "The deck needs exactly 1 card … or at least 52 cards", the file has 2–51 cards: use
the one-card file. **If teams still see "Pick one of the three cards"**, the database update (step 1.2) or the website
deploy (step 1.3) has not run yet.
