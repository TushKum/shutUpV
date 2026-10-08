"use client";

// The event's private realtime channel. A message is only a signal: the screen re-fetches its data from the server
// (through RLS), so a message never needs to be trusted for its content. Status is shared with the heartbeat.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type ChannelStatus = "CONNECTING" | "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT";

export interface ChannelMessage {
  event: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

interface ChannelValue {
  status: ChannelStatus;
  last: ChannelMessage | null;
}

const ChannelContext = createContext<ChannelValue>({ status: "CONNECTING", last: null });

export function EventChannel({ eventId, children, refreshDelayMs = 250 }: { eventId: string; children: ReactNode; refreshDelayMs?: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<ChannelStatus>("CONNECTING");
  const [last, setLast] = useState<ChannelMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;
    const channel = sb.channel(`event:${eventId}`, { config: { private: true } });
    channel.on("broadcast", { event: "*" }, (msg: { event: string; payload?: unknown }) => {
      setLast({ event: msg.event, payload: (msg.payload ?? {}) as Record<string, unknown>, receivedAt: Date.now() });
      // Several messages arrive together on a clearing; refresh once.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), refreshDelayMs);
    });
    (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((s: string) => setStatus(s as ChannelStatus));
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      void sb.removeChannel(channel);
    };
  }, [eventId, router, refreshDelayMs]);

  return <ChannelContext.Provider value={{ status, last }}>{children}</ChannelContext.Provider>;
}

export function useEventChannel(): ChannelValue {
  return useContext(ChannelContext);
}
