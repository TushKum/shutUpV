"use client";

// The event's private realtime channel. A message is only a signal: the screen re-fetches its data from the server
// (through RLS), so a message never needs to be trusted for its content. Status is shared with the heartbeat. Staff
// consoles also listen on the event's staff channel (drafts, requests and settings that teams must not hear of).

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

export function EventChannel({
  eventId,
  staff = false,
  children,
  refreshDelayMs = 250,
}: {
  eventId: string;
  staff?: boolean;
  children: ReactNode;
  refreshDelayMs?: number;
}) {
  const router = useRouter();
  const [eventStatus, setEventStatus] = useState<ChannelStatus>("CONNECTING");
  const [staffStatus, setStaffStatus] = useState<ChannelStatus>("CONNECTING");
  // A console is live only when every channel it listens on is.
  const status: ChannelStatus = eventStatus !== "SUBSCRIBED" || !staff ? eventStatus : staffStatus;
  const [last, setLast] = useState<ChannelMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;
    const onMessage = (msg: { event: string; payload?: unknown }) => {
      setLast({ event: msg.event, payload: (msg.payload ?? {}) as Record<string, unknown>, receivedAt: Date.now() });
      // Several messages arrive together on a clearing; refresh once.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), refreshDelayMs);
    };
    const channel = sb.channel(`event:${eventId}`, { config: { private: true } }).on("broadcast", { event: "*" }, onMessage);
    const staffChannel = staff ? sb.channel(`staff:${eventId}`, { config: { private: true } }).on("broadcast", { event: "*" }, onMessage) : null;
    (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((s: string) => setEventStatus(s as ChannelStatus));
      staffChannel?.subscribe((s: string) => setStaffStatus(s as ChannelStatus));
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      void sb.removeChannel(channel);
      if (staffChannel) void sb.removeChannel(staffChannel);
    };
  }, [eventId, staff, router, refreshDelayMs]);

  return <ChannelContext.Provider value={{ status, last }}>{children}</ChannelContext.Provider>;
}

export function useEventChannel(): ChannelValue {
  return useContext(ChannelContext);
}
