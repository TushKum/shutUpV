"use client";

// This console's own connection: its realtime channel, the last message it received and how far this browser's
// clock is from the server's (the heartbeat refines the offset every 20 seconds).

import { useSyncExternalStore } from "react";
import { ago, describeOffset } from "@/lib/admin/health";
import { useEventChannel } from "@/lib/live/channel";
import { useClock, useServerNow } from "@/lib/live/clock";
import { Badge, Notice } from "@/components/ui/ui";

const noSubscription = () => () => {};

export function ConsoleStatus() {
  const { status, last } = useEventChannel();
  const { offset } = useClock();
  const browserNow = useServerNow(1000) - offset;
  // The offset is measured in the browser: the server's render shows a placeholder, so hydration never disagrees.
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const clockState = describeOffset(offset);
  return (
    <div className="space-y-3 text-sm">
      <dl className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-slate-600">Realtime</dt>
        <dd data-console-realtime={status}>
          <Badge tone={status === "SUBSCRIBED" ? "green" : status === "CONNECTING" ? "amber" : "red"}>{status}</Badge>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-2">
        <dt className="text-slate-600">Last message</dt>
        <dd className="font-mono tabular-nums">
          {last ? `${last.event} · ${ago(browserNow - last.receivedAt)} ago` : "none since this page opened"}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-2">
        <dt className="text-slate-600">Clock offset</dt>
        <dd className="font-mono tabular-nums" data-testid="clock-offset">
          {inBrowser ? `${offset >= 0 ? "+" : "−"}${Math.abs(Math.round(offset))} ms` : "…"}
        </dd>
      </div>
      </dl>
      {inBrowser ? <Notice tone={clockState.tone}>{clockState.label}</Notice> : null}
      {status !== "SUBSCRIBED" && status !== "CONNECTING" ? (
        <Notice tone="red">This console is not receiving live updates: reload the page. Pages still refresh after every action.</Notice>
      ) : null}
    </div>
  );
}
