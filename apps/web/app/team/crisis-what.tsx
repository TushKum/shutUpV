"use client";

// One plain sentence about the step of the crisis that is on now; it follows the server clock like the step row.

import type { PhaseCode } from "@msim/engine";
import { useDeadlineNow } from "@/lib/live/clock";
import { crisisHeadline, currentStep, type CrisisStep } from "@/lib/team/crisis-steps";

export function CrisisWhat({ phase, k, steps }: { phase: PhaseCode; k: number | null; steps: readonly CrisisStep[] }) {
  const now = useDeadlineNow();
  const step = steps.length ? currentStep(steps, now).key : null;
  return <span suppressHydrationWarning>{crisisHeadline(phase, k, step).what}</span>;
}
