"use client";

// The screen's realtime status in the header: Live, Connecting or Offline (a screen that is offline still works, but
// only refreshes when it is reloaded or an action is taken).

import { useEventChannel } from "@/lib/live/channel";

export function RealtimeDot() {
  const { status } = useEventChannel();
  const ok = status === "SUBSCRIBED";
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500" title={`Realtime: ${status}`} data-realtime={status}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : status === "CONNECTING" ? "bg-amber-400" : "bg-red-500"}`} />
      {ok ? "Live" : status === "CONNECTING" ? "Connecting" : "Offline"}
    </span>
  );
}
