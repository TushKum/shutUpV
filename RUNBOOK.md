# Runbook: the night, minute by minute

For the organisers on duty. Deployment and preparation are in [docs/DEPLOY.md](docs/DEPLOY.md); the judge in
[docs/JUDGE.md](docs/JUDGE.md); the briefing, announcements, registration desk and participant handbook in
[docs/event/](docs/event/README.md). Times are IST. Everything the system does by itself is marked *(auto)*; everything
else is a click on the control panel, `/admin/<slug>`. A two-click button asks "Click again to …": the second click
counts only for what the first one showed.

## Roles on the night

| Who | Where | Job |
|---|---|---|
| Event lead (organiser) | laptop 1, Phase page | advances the night, pauses, extends, talks to the room |
| Exchange desk (organiser) | laptop 2, Rounds + Ledger | watches rounds clear, approves corrections (needs a second person) |
| AI desk (organiser) | laptop 3, Judge page | starts judging, keeps "Run the judge here" on, releases scores, appeals |
| Fairness officer | own laptop, Fairness page | decides collusion flags (05:00–05:40) |
| Tech on call | any laptop, Health page + Supabase/Vercel dashboards | connections, errors, the venue network |
| Registration desk | printed cards | one card per team; reprints with `pnpm cards … --only <codes>` (docs/event/staff/REGISTRATION.md) |

Keep laptops 1–3 on a wired or staff network. Keep the Phase page open on laptop 1 all night: an open control panel
also ticks the event (a backup to the database's 2-second heartbeat).

## Before 19:30

- [ ] /admin → Health: the heartbeat is green, no tick errors, the event is in SETUP.
- [ ] The seed commitment is published (Lottery page) and on the projector slide; the secret seed is on paper with the
      event lead only.
- [ ] Both decks are uploaded (Content); the flash bulletin is prepared (Bulletins).
- [ ] Judge → Calibration: a batch from today, samples near their bands, the current prompt SHA and model.
- [ ] Projectors: signed in with display accounts, `/display` in full screen (F11), showing the event.
- [ ] Auto-advance: decide on or off (Phase page). With it on, phases end at their planned time when nothing holds
      them; holds (unreleased scores, open flags) still need a click.
- [ ] A test team login works on a phone on the venue Wi-Fi and on mobile data.

## The night

| Time | Phase | Do | Watch |
|---|---|---|---|
| 20:00 | CHECKIN | Hand out cards. Advance from SETUP when the room is ready. | Health: connected screens rising |
| 20:30 | BRIEFING | Explain the night; show `/team/judging` (the published prompts). | |
| 21:00 | SQUAD_DRAW | Lottery: enter the seed and roll the dice (two clicks). The projector shows the seed check. | "Draw verified" on the Lottery page |
| 21:10 | BUILD | *(auto)* teams that did not pick get their first dealt card at 21:10. | |
| 22:30 | READING | *(auto)* pitches close. **Judge: Start judging (Pitch)**, "Run the judge here" on 2–3 consoles. | Progress view: all sealed well before 23:15 |
| 23:15 | → IPO | After call 1 closes (23:15): **Seal missing as 0**, then **Release pitch scores**. Advance to IPO. | IPO prices on the projector |
| 23:30 | ROUNDS 1–4 | *(auto)* the IPO is allocated; rounds open and clear every 15 minutes. | Rounds page: each round clears in seconds |
| 00:30 | CRISIS | *(auto)* crisis cards, −15%, the seed is revealed. | The crisis takeover on the projector |
| 00:45 | RESCUE_1 | *(auto)* rounds 5–8; default fees at 01:05. | |
| 01:45 | BREAK | Trading paused 15 minutes. | |
| 02:00 | RESCUE_2 | Rounds 9–12; deal bonus cutoff 02:45, plans and deals close 03:00. | |
| 03:00 | PLANS_PUBLISHED | **Start judging (Plan)** at once; plans are public. | Progress: all sealed by 03:25 |
| 03:30 | VERDICTS | **Seal missing as 0**, **Release plan scores**. Advance. | The verdicts takeover |
| 03:30 | ROUNDS 13–21 | 10-minute rounds. **04:00: Publish the flash bulletin** (Bulletins). | |
| 04:15 | | Flash answers close. **Start judging (Flash)** immediately: only 5 minutes until 04:20. | Progress view pace |
| 04:20 | | After round 17 clears: **Seal missing as 0**, **Release flash scores** (round 18 waits for it). | |
| 05:00 | CLOSE | *(auto)* shorts covered, closing prices; the closing bell. | |
| 05:00 | SETTLEMENT | *(auto)* bonuses, results, collusion flags. Fairness officer starts deciding flags. | Fairness page |
| 05:30 | APPEALS | Technical appeals only: Judge → re-run with a reason → apply or dismiss the new score. | The gate lists what still holds the awards |
| 05:40 | AWARDS | Advance when the gate is clear: the rankings appear on every screen. | The awards takeover |

## When something goes wrong

**Rule one: pause first, think second.** "Pause" (Phase page) freezes the order book and every countdown; "Resume"
gives back exactly the time that was left. Tell the room before you resume.

| Symptom | Likely cause | Do |
|---|---|---|
| Rounds do not open or clear on time | the database heartbeat stopped | Keep the Phase page open (it ticks too). Health shows tick errors; if the open round is past its close, use "Close round N now". Check `select * from cron.job` in Supabase. |
| Many teams cannot log in | venue Wi-Fi, or the Auth rate limit | Mobile data; check Supabase → Auth → Rate limits; ask venue IT. Reprint a lost card with `pnpm cards … --only <code>` (the seeding options; docs/event/staff/REGISTRATION.md). |
| Screens show "Reconnecting…" or a grey realtime dot | Realtime limits or the network | Screens re-read by themselves every 10 s; nothing is lost. Check Supabase → Realtime usage; reload a projector if it stays grey. |
| The site is down (Vercel) | deploy or platform problem | Pause the event in the Supabase SQL editor: `select public.pause_event('<event id>');`. Roll back to the last good deployment in Vercel. Resume when back. |
| The database is down | Supabase incident | Nothing can change while it is down, so no state is lost; the heartbeat resumes by itself. Announce, wait, then extend the phase (Phase page → Extend) by the lost minutes. |
| The judge is slow | rate limits or a slow model | Open a third console with "Run the judge here", or run `pnpm judge-worker --event <slug>` on a laptop. |
| The judge reports a configuration error | bad API key or model name | Fix the Vercel variable, redeploy, switch the runner on again: the runs went back to the queue. |
| Many failed runs | the primary model is failing | "Switch to the backup model", then "Retry N failed runs". |
| The AI service is down (primary and backup both fail) | provider outage | Pause or extend the phase. Switch "Run the judge here" off. Call the human panel and follow [docs/event/staff/HUMAN-JUDGING.md](docs/event/staff/HUMAN-JUDGING.md): paper score sheets, one CSV per type, `pnpm human-scores --event <slug> --type <TYPE> --file <csv>`, then release as usual. |
| A score must be re-judged | technical appeal | Judge → the company → Re-run, with the reason. Before the release the new score replaces the old one; after the release it waits until you apply or dismiss it. A released pitch cannot be re-judged (the IPO is done). |
| A team's money or shares are wrong | a mistake to correct | Ledger → Corrections: one organiser requests, a second approves. Nobody can edit a price. |
| A phase needs more time | the room is behind | Phase → Extend by N minutes (moves every later time). |

## After 06:00

1. Exports: ledger, prices, scores, results (CSV) to the shared drive.
2. Revoke the Anthropic key; rotate the Supabase service_role key; delete `out/` from the laptop.
3. Purge rehearsal events: `select public.purge_event('<slug>');` (rehearsals only).
4. Scale the Supabase compute and Vercel plan back down.
