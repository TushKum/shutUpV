# PRIMUS for organisers, explained simply

## Before the night

1. **Content** page, before the squad draw: upload the three files in `seed/sectors/`:
   - problem cards (one per sector; the lottery splits the squads equally);
   - crisis cards (four per sector, one per crisis);
   - Round 3 statements (ten per sector, room for five companies each).
2. **Lottery** page: publish the seed commitment the day before.
3. Check `/api/health` says `"database":"ok"`, and run the AI judge's calibration.

## During the night

- **Phase** page: each phase starts with two clicks (or turn auto-advance on). The heartbeat reveals each crisis,
  closes hiring, pays or refunds fees and fills missing ratings by itself.
- **Judge** page, after each crisis's due time: judge and **release the crisis plans**. The last trading round of the
  crisis waits for them; the Rounds page says so. Release the advice memos once ratings close.
- **Round 3**: the overview shows the draft live (who is on the clock, each sector's statements) and warns in red if
  statements are missing or a sector lacks room. The big screen shows the draft by itself.
- Something wrong? **Pause** freezes every deadline; **Extend** adds minutes to everything after now.

## Timeline

| Time | What |
|---|---|
| 21:00 | Squad draw (sectors drawn) |
| 22:00 | PRDs and crisis memos due; Reading |
| 22:30 | IPO bids |
| 22:45, 00:15, 01:45, 03:15 | Crises 1–4 (each: hiring 20 min, writing until +65, ratings until +80, release, last trading round) |
| 04:45 | Round 3: fresh capital for funds, the draft |
| 06:00 | Solutions due |
| 06:30 | Market closes |
| 07:10 | Awards |
