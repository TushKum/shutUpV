# Runbook: the night, step by step

For the organisers on duty on Friday 20 November 2026. Setting up is in [docs/DEPLOY.md](docs/DEPLOY.md); how the
judge works is in [docs/JUDGE.md](docs/JUDGE.md). Times are IST. *(auto)* marks what the system does by itself (the
database's clock ticks every 2 seconds); everything else is a click on the control panel, `/admin/<slug>`. A
two-click button says "Click again to …": the second click counts only for what the first one showed.

## Roles

| Who | Where | Job |
|---|---|---|
| Event lead (organiser) | laptop 1, the event's main page (Phase) | starts the night, runs the lottery, pauses, extends, talks to the room |
| AI desk (organiser) | laptops 2 and 3, **Judge** | keeps **Run the judge here** on, watches every score seal, handles re-runs |
| Exchange desk (organiser) | laptop 4, **Rounds** and **Ledger** | watches rounds open and clear; approves ledger corrections and appeals (the second organiser) |
| Fairness officer (faculty) | own laptop, **Fairness** | reviews collusion flags in Settlement and decides each one |
| Tech on call | any laptop, **Health** and the Supabase and Vercel dashboards | connections, errors, the venue network |
| Registration desk | printed login cards | one card per team; reprints with `pnpm cards … --only <codes>` |
| Projector | a laptop signed in with a display account | `/display/<slug>` in full screen (F11) |

Keep the organiser laptops on wired or staff network, on power. Keep the main page open on laptop 1 all night: an
open control panel also ticks the event, as a backup to the database's clock.

## Before 19:30

- [ ] **Health:** the heartbeat is green, no tick errors, the event is in SETUP.
- [ ] **Lottery:** the seed commitment shows, and it is the one published to teams. The secret seed is with the event
      lead only (sealed envelope).
- [ ] **Content:** 50+ problem cards, 10 crisis cards, the twist written. The SETUP gate is clear (the main page says
      nothing is missing).
- [ ] **Judge:** a calibration batch from this week, samples in range; both rounds on the **primary** model; the
      prompt files show their SHA-256. No FAKE JUDGE badge.
- [ ] **Projector:** signed in with a display account, full screen, showing the evening countdown.
- [ ] **Auto-advance:** on (main page). Phases then end at their planned time unless something holds them (the
      lottery, unsealed scores, open flags), which the main page shows.
- [ ] A test team card works on a phone on the venue Wi-Fi and on mobile data.
- [ ] Two rumours written and ready to publish (Bulletins), for 00:30 and 01:00.

## The night

| Time | Phase | Do | Watch |
|---|---|---|---|
| 20:00 | CHECKIN | Hand out the cards (one per team). Advance from SETUP when the room is ready. | Health: connected screens rising towards 600 |
| 20:45 | BRIEFING | Explain the night; show "How judging works" (`/team/judging`) on the projector. | |
| 21:15 | BRIEFING → BUILD | **Lottery:** enter the secret seed and roll the dice in front of the room (two clicks). The problem cards are dealt; BUILD starts. | Lottery page: "verified"; teams' **Round 1** pages show their card |
| 22:15 | BUILD | *(auto)* the twist is published to every screen. | The twist takeover on the projector |
| 23:00 | → JUDGING_1 | *(auto)* the PRD forms lock; three readings per PRD are queued. **Judge:** "Run the judge here" on, on laptops 2 and 3. | Judge: readings done climbing; every score sealed by about 23:25 |
| 23:30 | REVEAL_1 | *(auto, once every PRD score is sealed)* starting prices and the top 5 PRDs. | The reveal on the projector; teams see score and reason |
| 23:45 | CRISIS_QA | *(auto)* crisis cards, every price −15%, the rescue circle, the seed published. Q&A board opens. | The crisis takeover |
| 00:15 | RESCUE | *(auto)* questions close; crisis solutions continue. **00:30 and 01:00:** publish a rumour (Bulletins). | |
| 01:45 | → JUDGING_2 | *(auto)* the solution forms lock; readings queued. Keep "Run the judge here" on. | Every score sealed well before 02:45 (they stay secret) |
| 02:15 | MARKET_BLIND | *(auto)* all solutions published (no scores); trading rounds 1 and 2. | Rounds: each round clears within seconds of its close |
| 02:45 | MARKET | *(auto, once every solution score is sealed)* the score reveal moves prices; rounds 3–9. | The reveal takeover; Rounds page |
| 03:30 | MARKET | *(auto)* the leaderboard freezes (hidden from teams and the projector until the awards). | |
| 04:30 | → SETTLEMENT | *(auto)* the closing bell: closing prices, Round 3 points, totals, awards, collusion flags. | The closing bell takeover |
| 04:30–05:10 | SETTLEMENT | **Fairness officer:** review each flag (Fairness), clear or disqualify with a written reason. | The main page shows what still holds the awards |
| 05:15 | AWARDS | *(auto, once every flag is decided)* the awards, revealed one by one on the projector, the winner last. | |
| after | AWARDS | `pnpm certificates --event <slug>` and print. | |

## When something goes wrong

**First rule: pause, then think.** **Pause** (main page, two clicks) freezes every countdown and refuses every action;
**Resume** gives back exactly the time that was left. Tell the room before you resume.

| Symptom | Likely cause | Do |
|---|---|---|
| A lock, reveal or round does not happen on time | the database clock stopped | Keep the main page open (it ticks too). Health shows the heartbeat and tick errors. If a round is past its close: Rounds → "Close round N now". |
| The phase does not move on | something holds it | The main page says what: the lottery not run, scores not sealed, flags not decided. Deal with that; auto-advance continues. |
| Many teams cannot sign in | venue Wi-Fi, or Supabase's sign-in rate limit | Mobile data; raise Auth → Rate Limits in Supabase; ask venue IT. Reprint a lost card with `pnpm cards … --only <code>`. |
| Screens show a grey live dot | Realtime limit or the network | Screens re-read by themselves; nothing is lost. Reload a projector if it stays grey. Check Supabase → Realtime usage. |
| The website is down | a Vercel problem | Pause (Supabase SQL editor: `select public.pause_event('<event id>');`). Roll back to the last good deployment in Vercel. Resume when it is back. |
| The database is down | a Supabase incident | Nothing changes while it is down, so nothing is lost. Announce, wait, then **Extend** the phase by the lost minutes. |
| Judging is slow | rate limits or a slow model | Switch "Run the judge here" on a third laptop, or run `pnpm judge-worker --event <slug>` on a laptop. |
| "The judge stopped: …" (a configuration error) | a bad API key or model name | Fix the Vercel variable, redeploy, switch "Run the judge here" on again: the readings went back to the queue. |
| Many failed readings | a round's model is failing | Judge → "Switch to backup" for that round, then "Retry failed readings". |
| The AI service is down (both models fail) | a provider outage | **Extend** the judging phase. Switch "Run the judge here" off. Three human judges score each submission on paper against the published rubric; type the marks into a CSV and run `pnpm human-scores --event <slug> --type PRD --file prd.csv` (or `SOLUTION`). Scores seal and reveal as usual. |
| A score must be re-judged | a technical error (a submission cut off) | Judge → the company → Re-run, with the reason. Before its reveal, the new score replaces the old. After its reveal, a **second** organiser approves or dismisses it under "Re-runs and appeals"; approving re-applies the score's price effect. |
| A team's money or shares are wrong | a mistake to correct | Ledger → Corrections: one organiser requests, a second approves. Nobody edits a price or a score. |
| The room needs more time | a phase is behind | Main page → **Extend** by N minutes (moves every later time). |
| Power cut in the hall | power | Pause. Move the projector and organiser desk to backup power; resume when teams can work again. |

## After 06:00

1. Print the certificates (`pnpm certificates --event <slug>`).
2. **Exports:** download the ledger, prices, scores and results (CSV), and the public lottery record; store them
   encrypted on the shared drive.
3. Rotate the Anthropic key and the Supabase service_role key; delete `out/` from the laptop once its files are
   archived.
4. Purge rehearsal events (`select public.purge_event('<rehearsal slug>');`, rehearsals only) and scale the Supabase
   and Vercel plans back down.
