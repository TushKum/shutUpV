"use client";

// A deadline: its time (IST) and a countdown against the server clock. While the event is paused a deadline after
// the pause does not pass (it moves later on resume), so the countdown says so instead of running out.

import { clock } from "@/lib/format";
import { deadlineFrozen, deadlinePassed } from "@/lib/team/squad";
import { useServerNow } from "@/lib/live/clock";
import { Countdown } from "@/components/ui/countdown";

export function Due({ at, paused, pausedAt, testId }: { at: string | null; paused: boolean; pausedAt: string | null; testId?: string }) {
  const now = useServerNow(1000);
  if (!at) return <span className="text-slate-500">—</span>;
  const p = { paused, pausedAt };
  const state = deadlineFrozen(at, p) ? "paused" : deadlinePassed(at, now, p) ? "passed" : "open";
  return (
    <span data-testid={testId} data-state={state} className="whitespace-nowrap">
      <span className="font-mono tabular-nums">{clock(at)}</span>{" "}
      {state === "paused" ? (
        <span className="text-amber-700">· paused</span>
      ) : state === "passed" ? (
        <span className="text-slate-500">· closed</span>
      ) : (
        <span className="text-slate-600">
          · <Countdown to={at} passed="closed" /> left
        </span>
      )}
    </span>
  );
}
