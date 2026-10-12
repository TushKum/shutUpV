"use client";

// Small client pieces shared by the rescue, calls and earnings pages: a deadline with its countdown against the server
// clock, a hook that closes a form the moment its deadline passes (the server refuses anyway), and a two-click action
// button that closes with it.

import type { ComponentProps } from "react";
import { clock } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import { deadlineState, type PauseState } from "@/lib/team/rescue";
import { ActionButton } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";

/** Is the window still open by the server clock? A pause freezes a deadline after it began. */
export function useDeadlineOpen(at: string | null | undefined, pause: PauseState): boolean {
  const now = useServerNow(1000);
  return deadlineState(at, now, pause) !== "PASSED";
}

/** "01:05 · 12:34 left", "01:05 · paused", "01:05 · passed". */
export function Due({ at, pause, testId, passed = "passed" }: { at: string | null | undefined; pause: PauseState; testId?: string; passed?: string }) {
  const now = useServerNow(1000);
  if (!at) return <span className="text-slate-500">—</span>;
  const state = deadlineState(at, now, pause);
  return (
    <span data-testid={testId} data-state={state} className="whitespace-nowrap" suppressHydrationWarning>
      <span className="font-mono tabular-nums">{clock(at)}</span>{" "}
      {state === "PAUSED" ? (
        <span className="text-amber-700">· paused</span>
      ) : state === "PASSED" ? (
        <span className="text-slate-500">· {passed}</span>
      ) : (
        <span className="text-slate-600">
          · <Countdown to={at} passed={passed} /> left
        </span>
      )}
    </span>
  );
}

/** An action button that is disabled once `closesAt` passes by the server clock. */
export function ClosingActionButton({ closesAt, pause, disabled, ...props }: ComponentProps<typeof ActionButton> & { closesAt: string | null | undefined; pause: PauseState }) {
  const open = useDeadlineOpen(closesAt, pause);
  return <ActionButton {...props} disabled={disabled || !open} title={open ? props.title : "The deadline has passed."} />;
}
