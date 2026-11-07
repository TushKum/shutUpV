"use client";

import type { PhaseCode } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { useDeadlineNow } from "@/lib/live/clock";
import { phaseOpenText, phaseOverText } from "@/lib/team/phase-end";

// "ends in 12:30" until the phase's end; then what the phase waits for (a phase can wait at a gate, or the
// organisers advance it by hand), never "ends in now" for an hour. A phase without an end time (before the start, an
// untimed phase, the awards) says who ends it.
export function PhaseEnd({
  endsAt,
  phase,
  gate,
  next,
  ended = false,
}: {
  endsAt: string | null;
  phase: PhaseCode;
  gate: string | null;
  next: PhaseCode | null;
  ended?: boolean;
}) {
  const now = useDeadlineNow();
  if (!endsAt || ended) {
    return <span className="ml-1 font-normal text-slate-600">· {phaseOpenText(phase, ended)}</span>;
  }
  const over = now >= new Date(endsAt).getTime();
  return (
    <span className="ml-1 font-normal text-slate-600" suppressHydrationWarning>
      · {over ? phaseOverText(phase, gate, next) : <>ends in <Countdown to={endsAt} passed="now" /></>}
    </span>
  );
}
