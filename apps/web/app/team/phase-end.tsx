"use client";

import type { PhaseCode } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { useServerNow } from "@/lib/live/clock";
import { phaseOverText } from "@/lib/team/phase-end";

// "ends in 12:30" until the planned end; then what the phase waits for (a phase can wait at a gate, or the
// organisers advance it by hand), never "ends in now" for an hour.
export function PhaseEnd({ endsAt, phase, gate, next }: { endsAt: string | null; phase: PhaseCode; gate: string | null; next: PhaseCode | null }) {
  const now = useServerNow();
  if (!endsAt) return null;
  const over = now >= new Date(endsAt).getTime();
  return (
    <span className="ml-1 font-normal text-slate-600" suppressHydrationWarning>
      · {over ? phaseOverText(phase, gate, next) : <>ends in <Countdown to={endsAt} passed="now" /></>}
    </span>
  );
}
