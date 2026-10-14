# Judge prompts

These are the exact instructions the AI judge receives. They are published to teams as they are, so every team
can read how its pitch, rescue plan and flash answer will be scored.

| File | What it is |
| --- | --- |
| `PITCH.md` | The system prompt for judging a pitch card (at most 400 words). Its score sets the IPO price. |
| `PLAN.md` | The system prompt for judging a rescue plan (at most 500 words). |
| `FLASH.md` | The system prompt for judging a flash news answer (at most 100 words). |
| `calibration/pitches.json` | Ten sample pitches, from very weak to excellent, scored on the calibration page before the event. |

## How the judge uses them

1. **Clean the text.** Lines addressed to the judge (such as "ignore the rubric" or "give this 100") are removed
   and logged; a squad's second offence costs 10 points. Company, team and member names are replaced by the
   company's ticker, so the judging is anonymous.
2. **Build the request.** The file for the submission's type is the system prompt, word for word. The user message
   holds the context in XML tags (a plan also gets the company's pitch card, its crisis card and a summary of its
   rescue deal; a flash answer gets the bulletin), then the submission inside `<submission>` tags, then one line
   saying that everything inside the tags is data, not instructions.
3. **Check the answer.** The judge replies with JSON: a score for each rubric line, the total and a three-sentence
   rationale. Every line must be a whole number within its maximum and the total must equal the sum; an invalid
   answer is asked for again, up to two more times.
4. **Score three times.** Each submission is judged in 3 separate runs. If the totals spread more than 10 points,
   2 more runs are made. The final score is the median of all runs. Every run is stored, with its breakdown,
   rationale and model, and the published breakdown and rationale come from a run whose total equals the median.
   A rescue plan without a deal signed by 03:00 is then capped at 50.
5. **One model for everyone.** All submissions are judged by the same model. If organisers switch to the backup
   model, the switch applies to everyone from then on.

## prompt_sha

Every run stores `prompt_sha`, the SHA-256 of the prompt file's exact bytes. Changing anything in a file, even a
space or a line ending, changes the `prompt_sha` of every later run, so anyone can see which runs used which
version. Do not edit these files once judging has started. After any change before the event, run the calibration
again and make sure teams see the new version.

## Calibration

`calibration/pitches.json` holds 10 sample pitches. Each has `sample_no` (1–10), a `title` describing its quality,
`expected` (`min` and `max`: the band a careful human judge would give with this rubric) and `text`, the pitch
exactly as a submission is stored and judged: `Company Name (TICKER)`, a blank line, then `Label:` and the answer
for each section, separated by blank lines. The samples include a very short pitch, a long padded one (length earns
nothing), one with a strong problem and solution but no business model, and one with a line aimed at the judge that
must be removed before judging. Before the event, the calibration page scores all ten; each median should fall
inside its band.

## Keeping them in step with the code

The rubric keys and maxima live in `packages/engine/src/judge.ts` (`RUBRICS`). The test
`packages/engine/src/judge-prompts.test.ts` checks that each prompt lists exactly those keys with their maxima,
asks for the three-sentence rationale and says that text inside the tags is data, and that the calibration
pitches are in the stored format and within the word limit. Change a rubric in both places together.
