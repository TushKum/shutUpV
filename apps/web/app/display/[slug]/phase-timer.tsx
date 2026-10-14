"use client";

import type { PhaseCode } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { useDeadlineNow } from "@/lib/live/clock";
import { phaseOverText } from "@/lib/team/phase-end";

// Between rounds: the countdown to the phase's planned end (standing still while paused), then what the phase is
// waiting for (never "ends in now").
export function PhaseTimer({
  endsAt,
  phase,
  gate,
  next,
  paused = false,
}: {
  endsAt: string | null;
  phase: PhaseCode;
  gate: string | null;
  next: PhaseCode | null;
  paused?: boolean;
}) {
  const now = useDeadlineNow();
  if (!endsAt) return null;
  const over = now >= new Date(endsAt).getTime();
  const text = phaseOverText(phase, gate, next);
  return over ? (
    <p className="text-[44px] font-bold text-slate-200 first-letter:uppercase" suppressHydrationWarning>
      {text}
    </p>
  ) : (
    <>
      <p className="text-[32px] font-semibold text-slate-300" suppressHydrationWarning>
        {paused ? "Phase is paused with" : "Phase ends in"}
      </p>
      <p className={`text-[76px] leading-none font-black ${paused ? "text-amber-300" : ""}`}>
        <Countdown to={endsAt} passed="now" />
      </p>
    </>
  );
}
