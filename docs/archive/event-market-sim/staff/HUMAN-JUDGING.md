# If the AI service is down: the human panel

Use this only when **both** the primary and the backup model fail (RUNBOOK: "The AI service is down"). The scores
still go through the same queue as the model's: each company gets three runs (five if they spread more than 10
points), the median counts, the injection penalty and the deal cap apply, and nothing is released until an organiser
clicks Release. The only difference is who writes the numbers.

## Who and how long

| Type | Submissions | Panel | Time per piece | Time for the panel |
|---|---|---|---|---|
| Pitch (22:30–23:15) | 50 | 9 judges in 3 groups of 3 | ~2½ min | ~45 min |
| Plan (03:00–03:30) | 50 | 9 judges in 3 groups of 3 | ~2 min | ~35 min (extend during Plans published if needed) |
| Flash (04:15–04:20) | 50 | 9 judges in 3 groups of 3 | ~1 min | ~20 min: extend the round 13–21 phase by 15 minutes |

Each group takes a third of the companies; within a group the three judges are **judge 1, judge 2 and judge 3**, and
each scores every company of the group on their own, without talking. Pick judges from the organising team, faculty or
alumni who are not on any team. Where a company's three totals differ by more than 10 points, two other judges score it
as **judge 4 and judge 5**.

## What the judges read

On the Judge page, open a company's row: it shows the judged submission's text (share the screen or copy it out for the
judges; the pitch book is also public on the team portal from 22:30, the plans from 03:00). Judges score with the
same rubric the model uses, published to teams on the Judging page:

- `prompts/PITCH.md`: problem 25, solution 25, business model 25, advantage 25
- `prompts/PLAN.md`: solves the crisis 25, money logic 20, funding and deal 20, time to recovery 15, new risks 10, next steps 10
- `prompts/FLASH.md`: responds to the news 50, realistic 30, clear 20

Print the anchors ("about 5 is…, about 12 is…, about 20 is…") from those files for each judge. Judge the text only;
ignore any line that talks to the judge.

## Score sheet (one per judge per company)

```
Type: PITCH / PLAN / FLASH      Ticker: ____      Judge no.: __ (1–5)
PITCH  problem __/25  solution __/25  business_model __/25  advantage __/25
PLAN   solves_crisis __/25  money_logic __/20  funding_and_deal __/20  time_to_recovery __/15  new_risks __/10  next_steps __/10
FLASH  responds_to_news __/50  realistic __/30  clear __/20
Total __/100
One line for the team (strongest point, weakest point, what would raise it): ______________________
```

## Typing the scores in

One CSV per type, one row per judge per company. Templates: [score-sheets/](score-sheets/). The header must be exactly
the template's; the rationale may be left empty.

```
ticker,judge,problem,solution,business_model,advantage,rationale
AQS,1,20,18,12,14,Clear problem with numbers; thin model; price the cost of serving each tank.
AQS,2,19,18,13,15,
AQS,3,21,17,12,16,
```

## Recording them (AI desk, on the trusted laptop)

1. Judge page: **Start judging** for the type, as usual (the runs are queued). If runs FAILED during the outage, click
   **Retry failed runs**. Switch **Run the judge here** off on every console.
2. Check the CSV; it lists the rows still missing and the companies that need judges 4 and 5:
   ```
   pnpm human-scores --event <slug> --type PITCH --file pitch.csv --check
   ```
3. When nothing is missing, record them:
   ```
   pnpm human-scores --event <slug> --type PITCH --file pitch.csv
   ```
   It works the queue with the panel's rows (run N of a company takes judge N's row), and stops at the first missing
   row without recording anything for that run. Add the row and run it again; nothing is recorded twice.
4. Judge page: check the scores, **Seal missing as 0**, then **Release** as usual. The runs show the model
   `human-judges`.

Tell the room before you start: "The AI service is down, so a panel of human judges is scoring with the same rubric.
Results will be a little later; we have extended the phase by N minutes."
