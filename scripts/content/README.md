# Case content and the case book

- `case_twists.py` — the twist on every crisis card and the client brief behind every Round 3 statement. It rewrites
  the card bodies in `seed/sectors/all/`; then `pnpm sectors --pick Luxury,FMCG,Energy --out seed/sectors` writes the
  three-sector files.
- `build.py` + `details.py` + `sector_context.py` + `print.js` — the PDF
  `docs/case-studies/PRIMUS-Problem-Statements-and-Crises.pdf`, read from the game's own files:

```bash
python3 -I scripts/content/case_twists.py
pnpm sectors --pick Luxury,FMCG,Energy --out seed/sectors
python3 -I scripts/content/build.py . scripts/content/sector_context.py out/book.html
node scripts/content/print.js out/book.html docs/case-studies/PRIMUS-Problem-Statements-and-Crises.pdf
```
