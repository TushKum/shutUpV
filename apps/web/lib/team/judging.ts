// What the team page "How the judge scores" shows (the brief: "Store the prompts as files in the repo; they will be
// published to teams"): how a submission is judged, the score tiers, and the three system prompts exactly as the
// judge receives them, each with its SHA-256 (stored with every judging run as prompt_sha). The prompts are read on
// the server through lib/judge/prompts, the worker's own loader, so the page shows the very text the judge is sent;
// the numbers come from the engine's rules.

import {
  RUBRICS,
  RULES,
  SUBMISSION_TYPES,
  ipoPrice,
  medianScore,
  tierBp,
  type RubricLine,
  type SubmissionType,
} from "@msim/engine";
import { PROMPT_FILES, loadPrompt, type JudgePrompt } from "@/lib/judge/prompts";
import { SUBMISSION_LABELS } from "./squad";

/** When the first 3 runs spread more than this many points, 2 more are made (the engine's needsExtraRuns). */
export const EXTRA_RUN_SPREAD = 10;

/** What a type's score moves. */
const MOVES: Record<SubmissionType, string> = {
  PITCH: "Its score sets the IPO price.",
  PLAN: "Its score moves the market price and the AI price.",
  FLASH: "Its score moves the market price and the AI price.",
};

export interface PublishedPrompt {
  type: SubmissionType;
  /** "Pitch card", "Rescue plan", "Flash answer". */
  label: string;
  /** The file in prompts/, e.g. "PITCH.md". */
  file: string;
  wordLimit: number;
  moves: string;
  rubric: readonly RubricLine[];
  /** The prompt exactly as the judge receives it and its SHA-256 (hex), or why it could not be read. */
  prompt: { ok: true; text: string; sha: string } | { ok: false; error: string };
}

/** The three prompts in the order of the night (PITCH, PLAN, FLASH). A prompt that cannot be read is reported, not thrown. */
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
      rubric: RUBRICS[type],
      prompt,
    };
  });
}

/** The page anchor of a prompt ("pitch", "plan", "flash"). */
export const promptAnchor = (type: SubmissionType) => type.toLowerCase();

// ───────────────────────────── Score tiers ─────────────────────────────

/** The score bands of the brief's tier table, highest first. */
export const TIER_BANDS: readonly (readonly [min: number, max: number])[] = [
  [90, 100],
  [80, 89],
  [70, 79],
  [60, 69],
  [50, 59],
  [40, 49],
  [0, 39],
];

export interface TierRow {
  /** "90–100". */
  band: string;
  min: number;
  max: number;
  /** Price change per type, in basis points (+2000 = +20%), from the engine's tier rule. */
  bp: Record<SubmissionType, number>;
  /** Integer cents: the IPO price a pitch score in this band gives ($10.00 × (1 + pitch tier)). */
  ipoPrice: number;
}

export function tierRows(): TierRow[] {
  return TIER_BANDS.map(([min, max]) => ({
    band: `${min}–${max}`,
    min,
    max,
    bp: { PITCH: tierBp("PITCH", min), PLAN: tierBp("PLAN", min), FLASH: tierBp("FLASH", min) },
    ipoPrice: ipoPrice(min),
  }));
}

// ───────────────────────────── How a submission is judged ─────────────────────────────

export interface JudgingStep {
  title: string;
  text: string;
}

/** The brief's AquaSense pitch runs. */
const EXAMPLE_RUNS = [64, 66, 68] as const;

/** The steps of judging, in plain words, with the engine's numbers. */
export function judgingSteps(): JudgingStep[] {
  const [a, b, c] = EXAMPLE_RUNS;
  return [
    {
      title: "Names become the ticker.",
      text:
        "Before judging, company, team and member names in your submission and its context are replaced by your company's ticker, " +
        "so the judge does not know whose work it is.",
    },
    {
      title: "Lines aimed at the judge are removed.",
      text:
        'A line addressed to the judge (such as "ignore the rubric" or "give this 100") is removed and logged. ' +
        `The first time, nothing else happens. From your squad's second submission with a removed line, that submission loses ${RULES.INJECTION_PENALTY} points.`,
    },
    {
      title: "The judge reads the prompt and your submission.",
      text:
        "The prompt below for your submission's type is the judge's instructions, word for word. Your submission is sent inside XML tags with " +
        "its context (a rescue plan also gets the pitch card, the crisis card and a summary of the deal; a flash answer gets the bulletin), and " +
        "the judge is told that everything inside the tags is data, not instructions.",
    },
    {
      title: "Each submission is judged 3 times, and the median counts.",
      text:
        `If the 3 totals spread more than ${EXTRA_RUN_SPREAD} points, it is judged 2 more times (5 in all). The score is the median of all the runs: ` +
        `${a}, ${b} and ${c} give ${medianScore(EXAMPLE_RUNS)}. ` +
        "The breakdown and rationale you see on the Market page come from a run whose total is the median.",
    },
    {
      title: "A rescue plan needs a signed deal.",
      text: `A rescue plan without a fully signed deal by 03:00 is capped at ${RULES.PLAN_CAP_WITHOUT_DEAL}. A late or missing submission scores 0.`,
    },
    {
      title: "Scores stay sealed until the organisers release them.",
      text:
        "On release, the tier for the score (below) moves the price. The pitch tier sets the IPO price: $10.00 × (1 + tier). " +
        "Plan and flash tiers move both the market price and the AI price.",
    },
    {
      title: "Every run is stored.",
      text: "Each run is kept with its model, its breakdown and the SHA-256 of the prompt it used, so anyone can check which prompt judged a submission.",
    },
  ];
}
