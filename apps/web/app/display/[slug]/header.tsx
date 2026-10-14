// The top of the big screen: the event clock, the phase, the round with its countdown to the close, and a badge
// reading OPEN, HALTED or PAUSED. Everything is from event_status (the server's view), counted down against the
// server clock; during a pause the countdowns stand still (the schedule moves later by the pause on resume).

import { PHASE_LABELS } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { clock } from "@/lib/format";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { PhaseTimer } from "./phase-timer";

const BADGE: Record<EventStatus["trading"], string> = {
  OPEN: "bg-emerald-500 text-black",
  HALTED: "bg-slate-200 text-black",
  PAUSED: "bg-amber-400 text-black",
};

export function DisplayHeader({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  return (
    <header className="flex h-[150px] shrink-0 items-center justify-between gap-10 border-b-4 border-white/20 px-12" data-testid="display-header">
      <div className="min-w-0">
        <p className="truncate text-[28px] font-medium text-slate-300">
          {event.name}
          {event.is_rehearsal ? <span className="ml-4 rounded bg-violet-500 px-3 py-0.5 text-[22px] font-bold text-white">Rehearsal ×{event.clock_speed}</span> : null}
        </p>
        <p className="text-[60px] leading-tight font-black tracking-tight" data-testid="display-phase">
          {PHASE_LABELS[status.phase]}
        </p>
      </div>

      <div className="text-center" data-testid="display-round">
        {status.open_round ? (
          <>
            <p className="text-[32px] font-semibold text-slate-300">
              {status.paused ? `Round ${status.open_round.number} is paused with` : `Round ${status.open_round.number} closes in`}
            </p>
            {/* While paused the countdown stands still at the time the round had left when the pause began. */}
            <p className={`text-[76px] leading-none font-black ${status.paused ? "text-amber-300" : ""}`}>
              <Countdown to={status.open_round.closes_at} passed={status.paused ? "0:00" : "clearing…"} />
            </p>
          </>
        ) : status.next_round ? (
          <>
            <p className="text-[32px] font-semibold text-slate-300">Round {status.next_round.number} opens</p>
            {status.paused ? (
              <p className="text-[56px] leading-none font-black text-amber-300">after the pause</p>
            ) : (
              <p className="font-mono text-[76px] leading-none font-black tabular-nums">at {clock(status.next_round.opens_at)}</p>
            )}
          </>
        ) : (
          <PhaseTimer endsAt={status.phase_ends_at} phase={status.phase} gate={status.gate} next={status.next_phase} paused={status.paused} />
        )}
      </div>

      <div className="flex items-center gap-8">
        <span className={`rounded-xl px-6 py-2 text-[44px] font-black tracking-wider ${BADGE[status.trading]}`} data-testid="display-trading">
          {status.trading}
        </span>
        <div className="text-right">
          <ServerClock className="text-[60px] leading-none font-bold" />
          <div className="mt-2 flex justify-end [&_span]:text-[18px]">
            <RealtimeDot />
          </div>
        </div>
      </div>
    </header>
  );
}
