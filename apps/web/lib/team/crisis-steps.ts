// "You are here" for a PRIMUS crisis (Round 2, crises 1–4) and for Round 3 (5): the steps of the sub-round in each
// track's own words, which one is on now, and one plain sentence about what is happening. Pure: the layout passes
// the deadlines it already has (team_plan_facts); the banner and the crisis room draw the result.

import type { DeadlineCode, PhaseCode, Track } from "@msim/engine";

export type StepKey = "CARD" | "DRAFT" | "HIRE" | "WORK" | "RATE" | "SCORES";

export interface CrisisStep {
  key: StepKey;
  label: string;
  /** When the step ends (ISO); null for the first (already done) and the last (ends with the next crisis). */
  endsAt: string | null;
  /** Done whatever the clock says (the card is dealt; the draft ended early). */
  done?: boolean;
}

export type StepState = "done" | "now" | "later";

const LABELS: Record<Track, Record<StepKey, string>> = {
  PRODUCT: { CARD: "Crisis card", DRAFT: "Pick a statement", HIRE: "Hire a firm", WORK: "Write your plan", RATE: "Rate your firm", SCORES: "Scores" },
  CONSULTING: { CARD: "Crisis card", DRAFT: "The draft", HIRE: "Win clients", WORK: "Write your memo", RATE: "Get rated", SCORES: "Scores and bonus" },
  FINANCE: { CARD: "Crisis cards", DRAFT: "The draft", HIRE: "Firms are hired", WORK: "Plans are written", RATE: "Firms are rated", SCORES: "Scores move prices" },
};

const ROUND_3_WORK: Record<Track, string> = { PRODUCT: "Write your solution", CONSULTING: "Write your memo", FINANCE: "Solutions are written" };

export type DeadlineTimes = Partial<Record<DeadlineCode, string>>;

/** The steps of crisis k (1–4) or of Round 3 (5), in order, for this track. */
export function crisisSteps(track: Track, k: number, deadlines: DeadlineTimes, draftOver = false): CrisisStep[] {
  const at = (code: string) => deadlines[code as DeadlineCode] ?? null;
  const l = LABELS[track];
  const first: CrisisStep = k === 5 ? { key: "DRAFT", label: l.DRAFT, endsAt: at("DRAFT"), done: draftOver } : { key: "CARD", label: l.CARD, endsAt: null, done: true };
  return [
    first,
    { key: "HIRE", label: l.HIRE, endsAt: at(`HIRE_${k}`) },
    { key: "WORK", label: k === 5 ? ROUND_3_WORK[track] : l.WORK, endsAt: at(`DUE_${k}`) },
    { key: "RATE", label: l.RATE, endsAt: at(`RATE_${k}`) },
    { key: "SCORES", label: l.SCORES, endsAt: null },
  ];
}

/**
 * Each step's state at `nowMs` (the time deadlines are counted against: frozen while the event is paused). A step is
 * done once its end has passed; the first one not done is on now.
 */
export function stepStates(steps: readonly CrisisStep[], nowMs: number): StepState[] {
  let found = false;
  return steps.map((s, i) => {
    const last = i === steps.length - 1;
    const done = !last && (s.done === true || (s.endsAt !== null && nowMs > Date.parse(s.endsAt)));
    if (done && !found) return "done";
    if (!found) {
      found = true;
      return "now";
    }
    return "later";
  });
}

/** The step on now. */
export function currentStep(steps: readonly CrisisStep[], nowMs: number): CrisisStep {
  const states = stepStates(steps, nowMs);
  return steps[states.indexOf("now")] ?? steps[steps.length - 1]!;
}

const WHAT_R2: Record<StepKey, string> = {
  CARD: "Every company has a new crisis card and every price fell 5%.",
  DRAFT: "",
  HIRE: "Every company has a new crisis card and every price fell 5%. Companies are hiring consulting firms.",
  WORK: "Companies write their response plans. Firms write advice memos for their clients.",
  RATE: "Writing is closed. Companies rate their firms while the judge scores the plans.",
  SCORES: "The scores are coming: each plan's score moves its company's share price.",
};

const WHAT_R3: Record<StepKey, string> = {
  CARD: "",
  DRAFT: "The draft: companies pick a problem statement one by one, the lowest score first.",
  HIRE: "Every company has its problem statement. Companies hire a firm for the last time.",
  WORK: "Companies write their solutions; their firms write a memo and help.",
  RATE: "Writing is closed. Companies rate their firms while the judge scores the solutions.",
  SCORES: "The last scores are coming. Companies that share a statement split the price move.",
};

/** The banner's headline and one sentence for a PRIMUS event's Round 2 or 3. */
export function crisisHeadline(phase: PhaseCode, k: number | null, step: StepKey | null): { name: string; what: string } {
  if (phase === "SATURATION") return { name: "The final problem", what: WHAT_R3[step ?? "DRAFT"] };
  if (k === null) return { name: "Four crises are coming", what: "Round 2 is four crises, one after another. The first crisis card arrives soon." };
  return { name: `Crisis ${k} of 4`, what: WHAT_R2[step ?? "HIRE"] };
}
