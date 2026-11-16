# PRIMUS tech budget

One night, 150 teams on 150 laptops, 5 staff logins. Amounts in USD and INR (about ₹88 to $1); GST may be added.

## What we need and what it costs

| # | Need | Why | Service and plan | Cost |
| --- | --- | --- | --- | --- |
| 1 | **Website** | The game every team plays, the organiser control panel and the projector | Vercel **Hobby** (free; fine for a non-commercial college event) | **$0** |
| 2 | **Database, logins, live updates** | Stores the game, signs teams in, pushes prices and crises to every laptop | Supabase **Free** (about 160 of 200 live connections used) | **$0** |
| 3 | **AI judge** | Scores every PRD, crisis plan, memo and solution (about 2,200 runs) | Anthropic API, **Claude Haiku 5.5** | **$10** credit (the night uses about $5) |
| 4 | **Backup judge** | Takes over if Haiku fails | Claude **Sonnet 5.5**, only if switched on | **$0** unless used |
| 5 | **Emergency judge** | If Anthropic is down entirely | Free model on the organiser laptop (Ollama) | **$0** |
| 6 | **Keep-alive** | Stops the free database pausing before the event | GitHub Actions (already set up) | **$0** |
| | **Total** | | | **$10 (≈ ₹880)** |

## Only if needed

| Need | When | Cost |
| --- | --- | --- |
| Supabase **Pro**, 1 month | The 150-laptop load test fails on Free (too slow when a round clears) | + $25 (≈ ₹2,200) |
| Vercel **Pro**, 1 month | The event is commercial (paid entry, a company running it) | + $20 (≈ ₹1,760) |
| Sonnet 5.5 judging the whole night | Calibration shows Haiku is not good enough | + about $55 credit (≈ ₹4,840) |
| Own domain | A nicer address than primus-delta.vercel.app | + about $12 a year (≈ ₹1,000) |

## Summary

| Case | Total |
| --- | --- |
| **Planned** | **$10 (≈ ₹880)** |
| Worst case (Supabase Pro + Vercel Pro + Sonnet all night) | ≈ $110 (≈ ₹9,700) |

## Rules that keep it there
- The Anthropic credit is prepaid: it is also the spending limit. Top up before switching to Sonnet for a whole night.
- Upgrade only for the event month; downgrade the day after.
- Remove the Anthropic key from Vercel after the event.
