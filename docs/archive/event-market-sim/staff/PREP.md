# Preparation: content and people

The technical timeline (accounts, deploys, load test, keys) is in [docs/DEPLOY.md §10](../../DEPLOY.md). This list
covers the content, the people and the room.

## Three weeks before

- [ ] **Team roster** (`seed/teams.csv`, format in `seed/teams.example.csv`): 50 Product, 50 Consulting, 50 Finance,
      team name and up to 4 members with roll numbers. Close registration a week before; the order of rows in each
      track decides the codes (first Product row = P01).
- [ ] **Staff roster** (`seed/staff.csv`): 3 organisers (event lead, exchange desk, AI desk), 1 fairness officer,
      1 display account per projector. Organisers cannot be on a team.
- [ ] **Rules for the room** the brief leaves to you: may teams use AI tools to write? Laptops per team? Food and
      breaks? Write them into the briefing (staff/BRIEFING.md, slide 7).
- [ ] **A standby panel of 9 human judges** (not on any team) for an AI outage: brief them on
      [HUMAN-JUDGING.md](HUMAN-JUDGING.md) and print the score sheets and rubric anchors.
- [ ] **Awards and prizes**: 9 track places + best turnaround + best rescue plan + best-judging fund = 12 awards.

## Two weeks before

- [ ] **Problem deck**: review `seed/problem-cards.csv` (60 cards, 10 sectors). Edit for your college; keep at least 52
      cards for 50 squads (60 recommended); no card is dealt more than 3 times. Columns `number,sector,title,body`.
- [ ] **Crisis deck**: review `seed/crisis-cards.csv` (one card per category, 10 categories, 5 companies each).
- [ ] **Flash bulletin**: choose one from `seed/flash-bulletins/` (recommended: 01-rates-rise) or write your own. Only
      the AI desk and the event lead should know it.
- [ ] **Publish to teams**: the handbook, the three track cards, the case studies and the sample submissions
      (everything in docs/event/ except staff/). The judge prompts are published on the portal under Judging.

## One week before: practice night

Run a **rehearsal event** at 10× speed (one real hour ≈ the whole night) for participants who want to practise:

```
pnpm seed --slug practice --rehearsal --starts-at <time> --staff seed/staff.csv
```

Hand out the rehearsal cards (codes XC01…, XF01…, XP01… on the rehearsal PDF). Fill the empty seats with bots and
leave the teams people play to them:
`JUDGE_FAKE=1 pnpm rehearse --slug practice --autopilot --except XP01,XC07,XF12` (the codes the people play).
`--autopilot` also plays the organisers (draw, releases, flash bulletin). Say in the room whether the judge is the
fake one or the real model.

- [ ] Run one practice night for staff with the RUNBOOK in hand: every button, in order.
- [ ] Run the calibration page with the real model (DEPLOY.md §6) and keep the result.

## The day before

- [ ] Publish the seed commitment (Lottery page) on the event's notice board / group, with the time.
- [ ] Print: 150 login cards, 150 track cards (50 of each), 20 handbooks for the help desk, 3 RUNBOOKs, 1 ANNOUNCEMENTS
      sheet for the event lead, the team list for registration.
- [ ] Briefing slides from staff/BRIEFING.md with the venue's Wi-Fi and help-desk location.
- [ ] Upload the decks and prepare the flash bulletin (Content page); check them on screen.
- [ ] Dice for the draw (a physical die is part of the verifiable draw).

## The room

| Need | For |
|---|---|
| 2 projectors with `/display`, one display account each | the room; the takeovers |
| Power strips at every table | 600 laptops and phones for 10 hours |
| Wi-Fi sized for ~600 devices, plus a staff network | the portal; laptops 1–3 on wired or staff network |
| Help desk near the stage | appeals, login problems |
| Registration desk at the entrance | cards |
| A bell or gong | 05:00 close |
| Quiet corner for the fairness officer | 05:00–05:40 flags |
