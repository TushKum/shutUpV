# Registration desk

Two people, one laptop with the repository and `out/` (the cards PDF and the staff logins), a printer, and
the printed cards sorted P01–P50, C01–C50, F01–F50.

## Before 19:45

- [ ] Cards printed (`out/<slug>-login-cards.pdf`), cut, sorted by code. Each card shows the team name, code, password and login address.
- [ ] A printed list of teams (code, team name, members) to tick off. Make it from `seed/teams.csv`: the code is the
      track letter plus the row's number within its track, in file order (P01 is the first product row).
- [ ] A copy of the handbook and the three track cards per team (docs/event/HANDBOOK.md, docs/event/cards/), or a QR
      code to them.
- [ ] Wi-Fi details on a stand.

## At the desk

1. Ask for the team name. Find its code on the list and tick it.
2. Check at least one member's college ID against the roll numbers.
3. Hand over the card (one per team) and the track card.
4. Say: "Sign in now on a phone, at [address], with this code and password. The briefing is at 20:30."

## Problems

| Situation | Do |
|---|---|
| Lost card | Reprint: `pnpm cards --slug <slug> --date <date> --teams seed/teams.csv --only P07` (the same options as at seeding; needs `CARD_SECRET`, `TEAM_EMAIL_DOMAIN` and `APP_URL` in `.env` on this laptop). It writes `out/<slug>-login-cards-reprint.pdf`. The password does not change. |
| Team not on the list | Send them to the event lead. Teams are fixed at seeding; no new teams on the night. |
| A team has 5 people | Max 4 per team (BRIEF). The event lead decides. |
| A member wants to switch teams | No changes after 21:00. Before then, the event lead decides; nothing changes in the system (one login per team). |
| A card works for nobody | Check the code and password against the card (case, dashes and a missing leading zero don't matter). Then the tech on call. |

## Never

- Photograph or share the cards PDF, or leave the laptop unlocked: `out/` holds every team's password.
- Read a password aloud across the desk.
