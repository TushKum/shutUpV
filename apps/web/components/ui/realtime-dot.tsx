"use client";

// The screen's realtime status in the header: Live, Connecting or Offline (a screen that is offline still works, but
// only refreshes when it is reloaded or an action is taken).

import { useEventChannel } from "@/lib/live/channel";

export function RealtimeDot() {
  const { status } = useEventChannel();
  const ok = status === "SUBSCRIBED";
  return (
    <span className="flex items-center gap-1 text-xs text-muted" title={`Realtime: ${status}`} data-realtime={status}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-phosphor" : status === "CONNECTING" ? "bg-warn" : "bg-danger"}`} />
      <span className={ok ? "sr-only sm:not-sr-only" : ""}>{ok ? "Live" : status === "CONNECTING" ? "Connecting" : "Offline"}</span>
    </span>
  );
}
