"use client";

// A projector must never freeze: while the realtime channel is down, the screen re-reads itself every 10 seconds.
// When it is connected every broadcast refreshes it, and it still re-reads once a minute, so a broadcast lost on
// the way (a Realtime restart on the server, a message dropped under load) is caught within a minute.

import { useEventChannel } from "@/lib/live/channel";
import { AutoRefresh } from "@/lib/live/auto-refresh";

export function FallbackRefresh({ everyMs = 10_000, safetyMs = 60_000 }: { everyMs?: number; safetyMs?: number }) {
  const { status } = useEventChannel();
  return <AutoRefresh everyMs={status === "SUBSCRIBED" ? safetyMs : everyMs} />;
}
