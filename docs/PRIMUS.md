# PRIMUS on this platform

How the PRIMUS Event Guide (three rounds, 50 + 50 + 50 teams) is built on top of the original one-night game. The
original night (one pitch, one crisis, one rescue plan, flash news) still runs unchanged as the `CLASSIC` format, so
its tests keep guarding the shared engine. A `PRIMUS` event uses the pieces below.

Status: **built** = merged on this branch with tests; **next** = being built; **planned** = designed here, not built.

## Round 1: Foundation

| Piece | Status | How |
| --- | --- | --- |
| PRD (Product) | built | Submission type `PITCH`: seven sections, 800 words, rubric 20/20/15/15/15/15 (`prompts/PITCH.md`). Sets the IPO price as before. |
| Crisis memo (Consultancy) | built | Submission type `MEMO`: the same standalone case for every firm (in `prompts/MEMO.md`), 500 words, rubric 25/20/20/15/10/10. Closes with the PRD. Moves no price; released from READING; final once released. Pays the firm $500 × (score − 50), clamped to −$10,000…+$25,000. |
| Finance practice | planned | A 10-question quiz on the trading rules, auto-marked, shown to organisers. |

Squads are still drawn by lottery (1 Product + 1 Consulting + 1 Finance per company): the Finance team stays tied to its
company (it may not trade it) and the Consulting team's memo is stored with the squad. From Round 2 consultants are
hired on the marketplace instead.

## Round 2: Pressure (four sub-rounds)

Phases: a `PRIMUS` event goes `IPO → PRESSURE → SATURATION → CLOSE` (the classic phases in between are skipped).
Each sub-round is a row of `subrounds` with its own times (defaults for a 6-hour Round 2, 90 minutes each):

| Minute | What happens |
| --- | --- |
| 0 | Crisis cards revealed (one per company, drawn so several companies share a category); price shock −5%; trading halted 5 min |
| 5–20 | Hiring: Product sends offers (cash and/or shares) to firms; firms accept, counter or decline; at most 2 clients per firm, 1 firm per company |
| 20–65 | Work: Product writes the response plan (`CRISIS_n`, 500 words); the hired firm writes its memo to the client (`ADVICE_n`, 500 words) |
| 65 | Hard close for both. The fee in escrow is paid to the firm if its memo is in, refunded otherwise |
| 65–80 | The client rates its firm 1–5; plans are public, scores sealed |
| 80 | Release: plan tier moves the price (the plan column of the tier table); firm reputation bonus $500 × (memo score − 50) + $1,000 × (rating − 3) |
| 80–90 | Final trading window |

Trading rounds run all through `PRESSURE` and `SATURATION` (15-minute windows, ±10% cap), halted at each reveal.

## Round 3: Saturation

| Piece | How |
| --- | --- |
| Problem statements | Organisers upload them (suggested 10, cap 5 companies each). |
| Draft | Product teams ranked by score so far (PRD + Round 2 plans, average); lowest picks first, 20 seconds each; no pick = the least-crowded open statement. |
| Negotiation | The firm posts an asking fee; offers and counters, at most 3 counters each; a fee band (5–20% of the company's cash); binding once accepted; 2 clients per firm. |
| Solution | `SOLUTION`, 600 words, with the hired firm; judged with the statement as context. |
| Saturation | Within each statement, rank by score: 1st full tier, 2nd ×0.75, 3rd ×0.5, 4th–5th ×0.25 on positive tiers; negative tiers in full; a statement with one company gets its full tier. |
| Finance injection | Every fund gets 50% of its starting capital at the start of `SATURATION`. |

## Final scores

| Sector | Score | Tie-break |
| --- | --- | --- |
| Product | Retained shares × closing price + cash | Higher average AI score |
| Consultancy | Firm value: cash (fees and bonuses) + fee shares × closing price | Higher average client rating |
| Finance | Final value ÷ all capital received − 1 | Smaller largest single position |

## Defaults used for the guide's open questions

Round 2 lasts 6 hours (four 90-minute sub-rounds); Round 3 lasts 90 minutes; consultants are paid in cash, shares or
both; the Round 3 injection is 50% of starting capital; the marketplace is open from Round 2 (not lottery squads);
team size and prizes are not modelled by the platform.

## Technical design (for whoever continues this)

- **Format.** `events.format` is `CLASSIC` or `PRIMUS`. The phase after the current one is the next row of the event's
  own `phases` (by `seq`), so a `PRIMUS` event, whose schedule has no classic Round 2 phases, goes
  `IPO → PRESSURE → SATURATION → CLOSE`. In the `phase_code` enum `PRESSURE` and `SATURATION` sit right after `IPO`, so
  `phaseReached(x, "CRISIS")` stays false during them (the classic crisis, rescue and flash screens stay hidden).
- **Sub-rounds as deadlines.** Sub-round k (1–4 in Round 2, 5 = Round 3) is a set of deadlines, so pause, extend and
  late starts shift them like every other deadline: `REVEAL_k` (crisis cards and the −5% shock; k ≤ 4), `HIRE_k`
  (offers lapse), `DUE_k` (hard close for the plan and the firm's memo; escrow paid or refunded), `RATE_k` (ratings
  close; a missing rating counts as 3). Round 3 adds `DRAFT` (end of the draft).
- **Submission types.** `CRISIS_1`…`CRISIS_4` (Product response plans, prompt `CRISIS.md`), `ADVICE_1`…`ADVICE_5`
  (the hired firm's memo to its client, prompt `ADVICE.md`; stored under the client company), `SOLUTION` (Round 3,
  prompt `SOLUTION.md`; co-edited by the hired firm). A firm writes for a client through `save_draft_for` /
  `submit_for` with the client company; the engagement is the permission.
- **Trading rounds** run in `PRESSURE` and `SATURATION`; the last round of a sub-round waits for that sub-round's
  plan scores to be released (`rounds.waits_for`), as round 18 waits for the flash tier in the classic night.
- **Marketplace.** `firm_profiles` (specialities, rate card), `offers` (company → firm, cash and shares, counters,
  status), `engagements` (one firm per company per sub-round, at most two clients per firm per sub-round, the escrow,
  the rating). Escrow moves through the ledger (`ESCROW_HOLD`, `ESCROW_RELEASE`, `ESCROW_REFUND`).
- **Firm value** = the firm's cash (fees and bonuses) + fee shares × current price; reputation bonuses are paid when
  the scores are released (`BONUS_ADVICE`, and `BONUS_MEMO` for Round 1).
