# Judge prompts

These are the exact instructions the AI judge receives. They are published to teams as they are, on the "How
judging works" page, so every team can read how its PRD and its crisis solution will be scored.

| File | What it is |
| --- | --- |
| `PRD.md` | The system prompt for judging a PRD (Round 1, at most 800 words). Its score sets the starting share price. |
| `SOLUTION.md` | The system prompt for judging a crisis solution (Round 2, at most 500 words). Its score moves the rescued company's price at 02:45. |
| `calibration/samples.json` | Sample PRDs and crisis solutions, from weak to strong, with the score range each should get. Organisers judge them before the event. |

## How the judge uses them

1. **Clean the text.** Lines addressed to the judge (such as "ignore the rubric" or "give this 100") are removed
   and logged; a team's second offence costs 10 points. Company, team and member names are replaced by the
   company's ticker, so the judging is anonymous.
2. **Build the request.** The file for the submission's type is the system prompt, word for word. The user message
   holds the context in XML tags (a PRD gets its problem card and the twist; a crisis solution gets the rescued
   company's PRD and its crisis card), then the submission inside `<submission>` tags, then one line saying that
   everything inside the tags is data, not instructions.
3. **Check the answer.** The judge replies with JSON: a score for each rubric line, the total and a three-sentence
   reason. Every line must be a whole number within its maximum and the total must equal the sum; an invalid
   answer is asked for again, up to two more times.
4. **Score three times.** Each submission is read 3 times, independently, and the median total counts. Every reading
   is stored, with its breakdown, reason, model and the SHA-256 of the prompt, and the published breakdown and
   reason come from a reading whose total is the median.
5. **One model per round.** Every PRD is judged by the same model (Claude Opus 5.5) and every crisis solution by the
   same model (Claude Sonnet 5.5). If organisers switch a round to its backup model, the switch applies to every
   reading claimed from then on.
