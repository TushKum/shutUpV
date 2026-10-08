"use client";

// Every open screen pings the server every 20 s, and at once when its realtime channel connects or drops (the health
// view's "connected" list, with its realtime status), and refines the server-clock offset. An organiser's console also runs the game clock once a second as a backup to
// pg_cron: tick() is idempotent and a second tick at the same moment does nothing.

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useClock } from "./clock";
import { useEventChannel } from "./channel";

const PING_MS = 20_000;
const TICK_MS = 1_000;

function clientId(): string {
  try {
    const existing = sessionStorage.getItem("msim-client-id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("msim-client-id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function Heartbeat({ eventId, area, tick = false }: { eventId: string; area: "team" | "admin" | "display"; tick?: boolean }) {
  const { status } = useEventChannel();
  const { setServerTime } = useClock();
  const statusRef = useRef(status);
  const pingRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (statusRef.current === status) return;
    statusRef.current = status;
    void pingRef.current?.();
  }, [status]);

  useEffect(() => {
    const sb = supabaseBrowser();
    const id = clientId();
    let stopped = false;
    const ping = async () => {
      const sentAt = Date.now();
      const { data } = await sb.rpc("ping", { p_client: id, p_event: eventId, p_area: area, p_realtime: statusRef.current });
      if (!stopped && data?.server_time) setServerTime(data.server_time as string, sentAt);
    };
    pingRef.current = ping;
    void ping();
    const p = setInterval(ping, PING_MS);
    const t = tick ? setInterval(() => void sb.rpc("tick", { p_event: eventId }), TICK_MS) : null;
    return () => {
      stopped = true;
      pingRef.current = null;
      clearInterval(p);
      if (t) clearInterval(t);
    };
  }, [eventId, area, tick, setServerTime]);

  return null;
}
