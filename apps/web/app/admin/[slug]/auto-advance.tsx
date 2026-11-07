"use client";

// "Turn auto-advance on" asks twice once the phase's planned end has passed, because the next tick then advances
// the event at once. Overdue is worked out against the server clock while the page is open, not only when it was
// rendered; the database refuses (OVERDUE) a one-click request that arrives after the planned end anyway.

import { ActionButton } from "@/components/ui/action";
import { useServerNow } from "@/lib/live/clock";
import type { ActionResult } from "@/lib/rpc";

export function AutoAdvanceButton({
  on,
  endsAt,
  nextLabel,
  turnOn,
  confirmOn,
  turnOff,
}: {
  on: boolean;
  endsAt: string | null;
  nextLabel: string | null;
  turnOn: () => Promise<ActionResult>;
  confirmOn: () => Promise<ActionResult>;
  turnOff: () => Promise<ActionResult>;
}) {
  const now = useServerNow();
  const overdue = !on && !!nextLabel && !!endsAt && now >= new Date(endsAt).getTime();
  if (on) return <ActionButton action={turnOff}>Switch to manual advance</ActionButton>;
  return (
    <ActionButton
      action={overdue ? confirmOn : turnOn}
      confirm={overdue ? `Click again: this advances to ${nextLabel} now` : undefined}
      title={overdue ? `This phase's time is up: the event advances to ${nextLabel} within seconds.` : undefined}
    >
      Advance when timer expires
    </ActionButton>
  );
}
