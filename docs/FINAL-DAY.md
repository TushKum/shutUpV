# PRIMUS: full deployment and the final day

Event `live-2026`, Friday 20 November 2026, doors 20:00 IST, 150 teams (600 people). All times IST.
The how-to behind each step: [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) (step by step), [DEPLOY-OWN-DOMAIN.md](DEPLOY-OWN-DOMAIN.md) (short), [DEPLOY.md](DEPLOY.md) (detail and
failures), [GO-LIVE.md](GO-LIVE.md) (what was tested). Tick each box; a box not ticked by its time is escalated to
the event lead.

## Roles (one name each, written here before the day)

| Role | Owns | Where they sit |
| --- | --- | --- |
| **Event lead** | Phase control, pause/resume, every announcement | Organiser laptop 1, control panel |
| **AI operator** | Judging, release of scores, appeals | Organiser laptops 1 and 2, Judge page |
| **Exchange operator** | Rounds, the projector, bulletins | Organiser laptop 3, Rounds + Display |
| **Fairness officer** | Lottery record, appeals decisions, disputes | Own laptop, Fairness page |
| **Tech / network** | Wi-Fi, power, Vercel and Supabase status, `pnpm preflight` | Organiser laptop with the repo and `.env` |
| **Help desk (2)** | Lost cards, login help, phones | Desk by the door, printed spare cards |

---

## Part A · Deployment (the week before)

### D−7 (Fri 13 Nov): build it
- [ ] `git pull && pnpm install` on the organiser laptop.
- [ ] Supabase: rotate the secret key; plan **Pro, spend cap off** (or Team); compute **≥ 4 dedicated cores**;
      **pg_cron** on; `supabase db push` (migrations up to 51); **sign-ups off**; **Site URL** = your domain;
      sign-ins **≥ 1,000 per 5 min**; Realtime limits above 1,800 connections.
- [ ] Vercel: root `apps/web`; production env (Supabase URL and keys, `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` =
      laptop's `TEAM_EMAIL_DOMAIN`, Anthropic key, judge models); **no** `CARD_SECRET`, **no** `JUDGE_FAKE`; deploy.
- [ ] Domain: add it in Vercel → Domains, create the DNS record shown, wait for the green tick.
- [ ] `https://<domain>/api/health` → `"database":"ok","schema":"ok"`.

### D−6 (Sat 14 Nov): logins and cards
- [ ] `.env`: `APP_URL=https://<domain>`.
- [ ] `pnpm seed --slug live-2026 --name "Market Simulation 2026" --date 2026-11-20 --staff seed/staff.csv`
      (event exists: resets logins, prints `out/live-2026-login-cards.pdf` with QR codes to your domain).
- [ ] `pnpm preflight --slug live-2026 --rush 60` → **all PASS**.
- [ ] Sign in on two phones: scan a card's QR, type the password.

### D−5 to D−3 (15–17 Nov): rehearse
- [ ] Separate rehearsal event: `pnpm seed --slug reh-1 --rehearsal --starts-at <now> --speed 10`, upload the decks,
      `pnpm rehearse --slug reh-1 --autopilot` (bots play the whole night). Watch it end to end on the projector.
- [ ] Load tests on your domain against `reh-1`:
      `pnpm app-load-test --base https://<domain> --slug reh-1 --rush 10` (check-in),
      `… --burst 1.2` (a round clearing), `pnpm load-test --slug reh-1` (realtime and trading). All PASS; if not,
      raise Supabase compute one size and run again.
- [ ] Real judge calibration (Judge → Calibration) with the Anthropic key; medians inside the bands. Note the cost
      per call (about $0.001 with Haiku; about $5 for the night). Anthropic balance **$10–20**.
- [ ] Staff rehearsal: every role does its job once on `reh-1` with this document in hand.

### D−2 (Wed 18 Nov): content and print
- [ ] Upload the FMCG / Aviation / Luxury decks into `live-2026`: `pnpm upload-decks --slug live-2026` (problem
      deck, crisis deck and Round 3 statements from `seed/sectors/`; the decks lock at the squad draw). Or by hand on the
      Content page. The control panel's **To do now** list must show no "Upload" item.
- [ ] Publish the lottery seed commitment (`pnpm new-seed`; keep the secret seed offline).
- [ ] Print: 150 login cards (cut), 20 spare blank cards, this document ×6, the case-study PDF for judges' reference.

### D−1 (Thu 19 Nov): freeze
- [ ] **Code freeze**: no deploys after today unless a fix is rehearsed first.
- [ ] `pnpm preflight --slug live-2026` → all PASS. Screenshot it.
- [ ] Charge every laptop; pack chargers, two 4G hotspots, an HDMI adapter, an extension board.
- [ ] Venue: test the Wi-Fi with 10 phones; get the network contact's number; wired line for the projector laptop.

---

## Part B · The day (Fri 20 Nov)

### Before doors
| Time | Who | Do |
| --- | --- | --- |
| 15:00 | Tech | Check [Vercel](https://www.vercel-status.com/), [Supabase](https://status.supabase.com/), [Anthropic](https://status.claude.com/) status. `pnpm preflight --slug live-2026` → all PASS. |
| 16:00 | Tech | Venue: Wi-Fi up, projector on the wired line, `https://<domain>/display/live-2026` full screen. |
| 17:00 | All staff | Sign in on the organiser laptops; open the control panel, Judge (×2), Rounds, Display. To do now: empty. |
| 18:00 | AI operator | Judge page: model **claude-haiku-5-5** (backup the same), "Run the judge here" ready on laptops 1 and 2. |
| 18:30 | Event lead | Staff briefing: roles, this timetable, pause rule ("if teams cannot play fairly, pause first, talk second"). |
| 19:30 | Help desk | Cards sorted by team code at the desk; spare cards and a pen. |

### The night (the app runs these times; staff act at the bold items)
| Time | Phase | What happens | **Staff action** |
| --- | --- | --- | --- |
| 20:00 | Check-in | Teams collect cards, sign in on 4 phones each | **Help desk** hands out cards; teams sign in as they arrive (not all on one call). Watch Health for sign-in errors. |
| 20:30 | Briefing | Rules on the projector | **Event lead** presents; explain QR sign-in, autosave, auto-submit at deadlines. |
| 21:00 | Squad draw | Lottery forms 50 squads, deals problem cards | **Fairness officer** watches the draw and the published record. |
| 21:10 | Round 1 · Build | Product writes the PRD, Consulting the crisis memo | Problem pick closes **21:20**. |
| 22:00 | Reading | PRDs and memos due (unsubmitted drafts auto-submitted) | **AI operator**: Start judging PRD + memo; release before 22:30. |
| 22:30 | IPO | Funds bid; first consultant call due | IPO bids close **22:45**. |
| 22:45 | Crisis 1 | Card revealed, prices −5%, hiring until **23:05**, plans and memos due **23:50**, ratings until **00:05** | **AI operator**: at 23:50 start judging; release by **00:10**. |
| 00:15 | Crisis 2 | Hiring until **00:35**, due **01:20**, ratings **01:35** | Judge at 01:20, release by **01:40**. |
| 01:45 | Crisis 3 | Hiring until **02:05**, due **02:50**, ratings **03:05** | Judge at 02:50, release by **03:10**. |
| 03:15 | Crisis 4 | Hiring until **03:35**, due **04:20**, ratings **04:35** | Judge at 04:20, release by **04:40**. |
| 04:45 | Round 3 | Draft until **05:00** (lowest score picks first), negotiation until **05:15**, solutions due **06:00**, ratings **06:15** | Judge at 06:00, release by **06:15**; the last round waits for it. |
| 06:30 | Close · Settlement | Final prices and portfolio values | **Event lead** checks the leaderboard on the projector. |
| 07:00 | Appeals | 10 minutes for appeals | **Fairness officer + AI operator** decide each one (apply or dismiss) before awards. |
| 07:10 | Awards | Winners on the projector | **Event lead** hosts. |

Every judging window: the control panel's **To do now** shows "Start judging the …" when a deadline passes and
"Release the … scores" when they are sealed. Each release moves prices, so it must land before the sub-round's last
trading round, which waits for it.

### Every 30 minutes through the night (Tech)
- [ ] Health page: heartbeat ticking, no tick errors, connected screens about 600, Realtime green.
- [ ] Judge page: no failed runs left; Anthropic spend on track.
- [ ] Projector live (the clock moves).

### If something goes wrong
| Problem | First move |
| --- | --- |
| A team cannot sign in | Help desk: check the code on the card; try the QR; reprint with `pnpm cards … --only P07`. |
| Many cannot sign in | Tech: `pnpm preflight --slug live-2026`; look at Supabase → Logs → Auth (429: raise the sign-in limit). |
| Screens stop updating | Event lead: **pause** (two clicks); Tech checks Supabase / Vercel status; resume when screens update again. |
| Judge failures | AI operator: read the error; switch the event to the backup model if Opus is down; retry failed runs. Never release incomplete scores. |
| Wi-Fi or power | Event lead pauses; Tech moves the projector to a hotspot; resume when teams are back. |

Pausing freezes every deadline; resuming shifts the schedule by the pause. Announce the new times. Full failure
table: DEPLOY.md section 8.

---

## Part C · After (Sat 21 Nov)
- [ ] Exports page: download results, ledger and scores; store them off the shared drive.
- [ ] Turn off the judge (remove the Anthropic key from Vercel) and lower Supabase compute.
- [ ] Shred printed cards; delete `out/` passwords from laptops after the results are confirmed.
- [ ] Note what went wrong and what to keep, for next year.
