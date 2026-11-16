---
name: primus-night
description: On the event night, tell the PRIMUS staff where the game is and what to do now (judge, release, appeals), and handle failures (logins, frozen screens, the judge, Wi-Fi) with the right first move. Use during the event, or to rehearse the night, when someone asks what's next, what time something is, or something goes wrong.
---

# PRIMUS on the night

The timetable and roles are in `docs/FINAL-DAY.md` (Part B). Times are IST; the event starts at 20:00. If the event
was paused, every later time shifts by the pause: say so and read the real times from the control panel
(`/admin/<slug>`), which is always right.

## "What do I do now?"
Ask the current time (or read it), find the row in the timetable, and answer with the staff action, for example:

| Due time | Judge | Release by |
| --- | --- | --- |
| 22:00 PRD + crisis memo | at 22:00 | 22:30 |
| 23:50 crisis 1 plans + memos | at 23:50 | 00:10 |
| 01:20 crisis 2 | at 01:20 | 01:40 |
| 02:50 crisis 3 | at 02:50 | 03:10 |
| 04:20 crisis 4 | at 04:20 | 04:40 |
| 06:00 Round 3 solutions | at 06:00 | 06:15 |

Appeals 07:00–07:10 (decide each before the awards at 07:10). The control panel's **To do now** list shows the same
jobs as links: point people to it.

## When something goes wrong (first move, then diagnose)
| Problem | First move |
| --- | --- |
| One team cannot sign in | Check the code on its card; QR sign-in; reprint `pnpm cards --slug <slug> --name "<name>" --date <date> --only <CODE>` |
| Many cannot sign in | `pnpm preflight --slug <slug>`; Supabase → Logs → Auth (429 → raise the sign-in rate limit) |
| Screens stop updating | **Pause** (control panel, two clicks), check Supabase and Vercel status pages, resume when screens update |
| Judge failures | Read the error on the Judge page; switch to the backup model if the primary is down; retry failed runs; never release incomplete scores |
| Wi-Fi / power | Pause; move the projector to a hotspot; resume when teams are back |

Rule: **if teams cannot play fairly, pause first, talk second.** Pausing freezes every deadline; resuming shifts the
schedule. Announce the new times.

## Never
Edit prices, scores or deadlines in the database by hand; release scores that are not all sealed; share keys or card
passwords in chat.
