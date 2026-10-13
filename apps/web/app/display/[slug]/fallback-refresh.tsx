"use client";

// A projector must never freeze: while the realtime channel is down, the screen re-reads itself every 10 seconds
// (when it is connected, every broadcast already refreshes it).

import { useEventChannel } from "@/lib/live/channel";
import { AutoRefresh } from "@/lib/live/auto-refresh";

export function FallbackRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const { status } = useEventChannel();
  return <AutoRefresh everyMs={everyMs} active={status !== "SUBSCRIBED"} />;
}
