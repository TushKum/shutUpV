// Placeholder until the board workstream fills it in: the 50-ticker grid, 25 at a time.

import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";

export async function Board({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  return (
    <div className="flex flex-1 items-center justify-center" data-testid="board">
      <p className="text-[48px] font-bold text-slate-300">
        {event.name} · {status.phase}
      </p>
    </div>
  );
}
