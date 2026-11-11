"use client";

// Small client pieces shared by the rescue, calls and earnings pages: a deadline with its countdown against the server
// clock, a hook that closes a form the moment its deadline passes (the server refuses anyway), and a two-click action
// button that closes with it.

import type { ComponentProps } from "react";
import { clock } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import { deadlineState, dueState, type PauseState } from "@/lib/team/rescue";
import { ActionButton } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";

/** Is the window still open by the server clock? A pause freezes a deadline after it began. */
export function useDeadlineOpen(at: string | null | undefined, pause: PauseState): boolean {
  const now = useServerNow(1000);
  return deadlineState(at, now, pause) !== "PASSED";
}

/**
 * "01:05 · 12:34 left", "01:05 · paused", "01:05 · passed". `closed` (its text: "paid", "signed", "closed"): the
 * matter is settled (a fee agreed and paid, a deal signed, a call window closed), so no countdown is shown.
 */
export function Due({
  at,
  pause,
  testId,
  passed = "passed",
  closed,
}: {
  at: string | null | undefined;
  pause: PauseState;
  testId?: string;
  passed?: string;
  closed?: string | null;
}) {
  const now = useServerNow(1000);
  if (!at) return <span className="text-muted">—</span>;
  const state = dueState(at, now, pause, !!closed);
  return (
    <span data-testid={testId} data-state={state} className="whitespace-nowrap" suppressHydrationWarning>
      <span className="font-mono tabular-nums">{clock(at)}</span>{" "}
      {state === "CLOSED" ? (
        <span className="text-muted">· {closed}</span>
      ) : state === "PAUSED" ? (
        <span className="text-warn">· paused</span>
      ) : state === "PASSED" ? (
        <span className="text-muted">· {passed}</span>
      ) : (
        <span className="text-paper">
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
