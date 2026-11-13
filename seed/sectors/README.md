# Sectors: Luxury, FMCG and Energy (plus Aviation and Fintech)

Upload these on the organiser's Content page, before the squad draw (both decks lock at the draw).

| File | Upload as | What it does |
| --- | --- | --- |
| `problem-cards.csv` | Problem deck | 3 cards, one per sector. The lottery splits the squads equally between them (17, 17 and 16 for 50 squads) and each squad's card is chosen at the draw. |
| `crisis-cards.csv` | Crisis deck | 4 cards per sector. In crisis *k* every company gets its own sector's card number *k* (1 operations, 2 market, 3 trust, 4 money). |
| `statements.csv` | Round 3 problem statements | 10 per sector, cap 5 each (room for 50 companies per sector). A company drafts only its own sector's statements. |

The texts come from the PRIMUS Sector Case Book. Every number on the crisis cards is invented for the game: check them before the event.

## Other sectors: Aviation and Fintech

`all/` holds the same three files with all five sectors (Luxury, FMCG, Energy, Aviation and Fintech): 5 problem cards,
20 crisis cards and 50 statements. Upload them to play all five (the lottery gives 10 squads to each).

To play any other mix of 2 to 6 sectors, for example Aviation instead of Energy, write the three files with:

```bash
pnpm sectors --pick Luxury,FMCG,Aviation
```

It writes `out/sectors/luxury-fmcg-aviation/` (problem cards and statements numbered again in the order given),
checked with the Content page's own rules. Upload those three files instead of the ones in this folder.

Every card, with what a strong answer covers, is in `docs/case-studies/PRIMUS-Problem-Statements-and-Crises.pdf`.
