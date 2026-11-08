// What the team page "How judging works" shows (the brief: "Each round's rubric and the exact judge instructions are
// published to teams on the website before the round starts"): how a PRD and a crisis solution are judged, each
// rubric, what a score does to the price, and the judge's prompts exactly as it receives them, each with its SHA-256
// (stored with every reading as prompt_sha). The prompts are read on the server through lib/judge/prompts, the
// worker's own loader, so the page shows the very text the judge is sent; the numbers come from the engine's rules.

import {
  RUBRICS,
  RULES,
  SUBMISSION_LABELS,
  SUBMISSION_TYPES,
  applyReveal,
  crisisShock,
  medianScore,
  revealFactorBp,
  startPrice,
  type RubricLine,
  type SubmissionType,
} from "@msim/engine";
import { PROMPT_FILES, loadPrompt, type JudgePrompt } from "@/lib/judge/prompts";

/** What a type's score does. */
const MOVES: Record<SubmissionType, string> = {
  PRD: "Its score is your Round 1 points and sets your company's starting share price at the PRD reveal.",
  SOLUTION: "Its score is your Round 2 points and moves the rescued company's price at the score reveal.",
};

/** What the judge reads besides the submission. */
const CONTEXT: Record<SubmissionType, string> = {
  PRD: "the problem card and the twist",
  SOLUTION: "the rescued company's PRD and its crisis card",
};

export interface PublishedPrompt {
  type: SubmissionType;
  /** "PRD", "Crisis solution". */
  label: string;
  /** The file in prompts/, e.g. "PRD.md". */
  file: string;
  wordLimit: number;
  moves: string;
  context: string;
  rubric: readonly RubricLine[];
  /** The prompt exactly as the judge receives it and its SHA-256 (hex), or why it could not be read. */
  prompt: { ok: true; text: string; sha: string } | { ok: false; error: string };
}

/** The two prompts in the order of the night (PRD, SOLUTION). A prompt that cannot be read is reported, not thrown. */
export function publishedPrompts(load: (type: SubmissionType) => JudgePrompt = (type) => loadPrompt(type)): PublishedPrompt[] {
  return SUBMISSION_TYPES.map((type) => {
    let prompt: PublishedPrompt["prompt"];
    try {
      const p = load(type);
      prompt = { ok: true, text: p.text, sha: p.sha };
    } catch (e) {
      prompt = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      type,
      label: SUBMISSION_LABELS[type],
      file: PROMPT_FILES[type],
      wordLimit: RULES.WORD_LIMIT[type],
      moves: MOVES[type],
      context: CONTEXT[type],
      rubric: RUBRICS[type],
      prompt,
    };
  });
}

/** The page anchor of a prompt ("prd", "solution"). */
export const promptAnchor = (type: SubmissionType) => type.toLowerCase();

// ───────────────────────────── What a score does to the price ─────────────────────────────

export interface PriceExample {
  score: number;
  /** Round 1: the starting price for this PRD score. */
  start: number;
  /** Round 2: the reveal factor for this crisis-solution score, in basis points (11,700 = × 1.17). */
  factorBp: number;
  /** A $10.00 company after the crisis (× 0.85) and then the reveal at this score. */
  afterReveal: number;
}

export const EXAMPLE_SCORES = [100, 84, 70, 50, 30, 0] as const;

export function priceExamples(scores: readonly number[] = EXAMPLE_SCORES): PriceExample[] {
  const afterCrisis = crisisShock(startPrice(50));
  return scores.map((score) => ({ score, start: startPrice(score), factorBp: revealFactorBp(score), afterReveal: applyReveal(afterCrisis, score) }));
}

// ───────────────────────────── How a submission is judged ─────────────────────────────

export interface JudgingStep {
  title: string;
  text: string;
}

/** Three readings of the brief's example. */
const EXAMPLE_RUNS = [64, 66, 68] as const;

/** The steps of judging, in plain words, with the engine's numbers. */
export function judgingSteps(): JudgingStep[] {
  const [a, b, c] = EXAMPLE_RUNS;
  return [
    {
      title: "The last saved version is judged.",
      text: "There is no submit button: whatever your form holds when it locks (at the end of Build for the PRD, at the end of the rescue for the crisis solution) is what the judge reads. An empty form scores 0.",
    },
    {
      title: "Names become the ticker.",
      text: "Team names, member names and company names are replaced by the company's ticker before the judge reads the work, so the judge never sees which team wrote it.",
    },
    {
      title: "Lines aimed at the judge are removed.",
      text:
        'A line addressed to the judge (such as "ignore the rubric" or "give this full marks") is removed and logged before judging. ' +
        `The first time, nothing else happens; a second attempt by the same team costs ${RULES.INJECTION_PENALTY} points.`,
    },
    {
      title: "The judge reads the prompt, the context and your work.",
      text:
        "The prompt below is the judge's instructions, word for word. A PRD is read with its problem card and the twist; a crisis solution with the " +
        "rescued company's PRD and crisis card. Your work is sent inside tags, and the judge is told that everything inside them is data, not instructions.",
    },
    {
      title: `Each submission is read ${RULES.JUDGE_RUNS} times, and the median counts.`,
      text:
        `The ${RULES.JUDGE_RUNS} readings are independent. Each gives points for every rubric line, a total and a three-sentence reason, in a fixed format the server checks. ` +
        `Totals of ${a}, ${b} and ${c} give ${medianScore(EXAMPLE_RUNS)}; the breakdown and reason you see come from the median reading.`,
    },
    {
      title: "Scores stay sealed until the reveal.",
      text: "PRD scores are revealed after Round 1 is judged, and crisis-solution scores at the score reveal during the market. Before then nobody outside the organisers can see a score.",
    },
    {
      title: "Every reading is stored.",
      text: "Each reading is kept with its model, its breakdown and the SHA-256 of the prompt it used, so anyone can check which prompt judged a submission.",
    },
    {
      title: "Appeals are for technical errors only.",
      text: "If something went wrong (for example a submission that was cut off), tell an organiser. They can re-run the judging with a written reason; a score changed after a reveal needs a second organiser's approval.",
    },
  ];
}
