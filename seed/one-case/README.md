# One case for every squad: The Hostel Kitchen

Upload these two decks (Admin → Content) instead of the full decks to make **every squad play the same case**:

| File | Upload as | Effect |
|---|---|---|
| `problem-cards.csv` | Problem deck | One card: at the draw every squad gets it, already chosen (no pick) |
| `crisis-cards.csv` | Crisis deck | One card: at 00:30 every company gets the same crisis |
| `../flash-bulletins/07-cooking-gas.csv` | Flash bulletin | The case's 04:00 news |

Both decks lock at the draw, so upload them before running the lottery. Hand out
`docs/case-studies/CASE-HOSTEL-KITCHEN.pdf` to every squad; keep the facilitator notes for organisers and judges.
The squads, the coverage and the seed check work exactly as with the full decks.

From the command line, seed a fresh event with them:

    pnpm seed --slug live-2026 --date 2026-11-20 \
      --problems seed/one-case/problem-cards.csv --crises seed/one-case/crisis-cards.csv
