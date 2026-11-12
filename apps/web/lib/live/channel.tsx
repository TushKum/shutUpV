"use client";

// The event's private realtime channel. A message is only a signal: the screen re-fetches its data from the server
// (through RLS), so a message never needs to be trusted for its content. Status is shared with the heartbeat. Staff
// consoles also listen on the event's staff channel (drafts, requests and settings that teams must not hear of), and a
// team's screen on its own team channel (its hiring offers: Realtime counts a message once per screen that receives
// it, so a message only two teams need is not sent to every screen of the night).
// Messages sent before the channel was joined (between the page render and the subscription) or while the connection
// was down are not replayed, so the screen re-reads itself each time the channel becomes live, and reports itself
// live (SUBSCRIBED) only once that read is done: "Live" means joined and up to date.

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
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

/**
 * Does this message concern this team's screen? A hiring offer names the Product team and the firm it is between:
 * the other teams' screens show nothing of it, so they do not re-read (with 150 teams, every offer would otherwise
 * make every screen load its page again). Everything else concerns everyone. Offers now come on the two teams' own
 * channels only; this still guards against a database that sends them on the event channel.
 */
export function concerns(msg: { event: string; payload?: unknown }, teamId: string | null | undefined): boolean {
  if (!teamId || msg.event !== "offers") return true;
  const p = (msg.payload ?? {}) as Record<string, unknown>;
  if (typeof p.firm !== "string" && typeof p.product !== "string") return true; // an older database: no names
  return p.firm === teamId || p.product === teamId;
}

/** A screen is live only when every channel it listens on is joined: the first one that is not decides. */
export function joinedStatus(...statuses: (ChannelStatus | null)[]): ChannelStatus {
  return statuses.find((s): s is ChannelStatus => s !== null && s !== "SUBSCRIBED") ?? "SUBSCRIBED";
}

export function EventChannel({
  eventId,
  staff = false,
  children,
  refreshDelayMs = 250,
  teamId = null,
  spreadMs = 0,
}: {
  eventId: string;
  staff?: boolean;
  children: ReactNode;
  refreshDelayMs?: number;
  /** A team's screen: it also hears its own team channel (its offers), and ignores other teams' offers. */
  teamId?: string | null;
  /** Each screen waits a random extra time up to this before re-reading, so hundreds of screens do not all load at once. */
  spreadMs?: number;
}) {
  const router = useRouter();
  const [eventStatus, setEventStatus] = useState<ChannelStatus>("CONNECTING");
  const [staffStatus, setStaffStatus] = useState<ChannelStatus>("CONNECTING");
  const [teamStatus, setTeamStatus] = useState<ChannelStatus>("CONNECTING");
  const joined = joinedStatus(eventStatus, staff ? staffStatus : null, teamId ? teamStatus : null);
  const [caughtUp, setCaughtUp] = useState(false);
  const [last, setLast] = useState<ChannelMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;
    const onMessage = (msg: { event: string; payload?: unknown }) => {
      if (!concerns(msg, teamId)) return;
      setLast({ event: msg.event, payload: (msg.payload ?? {}) as Record<string, unknown>, receivedAt: Date.now() });
      // Several messages arrive together on a clearing; refresh once.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), refreshDelayMs + Math.random() * spreadMs);
    };
    const channel = sb.channel(`event:${eventId}`, { config: { private: true } }).on("broadcast", { event: "*" }, onMessage);
    const staffChannel = staff ? sb.channel(`staff:${eventId}`, { config: { private: true } }).on("broadcast", { event: "*" }, onMessage) : null;
    const teamChannel = teamId ? sb.channel(`team:${teamId}`, { config: { private: true } }).on("broadcast", { event: "*" }, onMessage) : null;
    (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      const track = (set: (s: ChannelStatus) => void) => (s: string) => {
        set(s as ChannelStatus);
        if (s !== "SUBSCRIBED") setCaughtUp(false);
      };
      channel.subscribe(track(setEventStatus));
      staffChannel?.subscribe(track(setStaffStatus));
      teamChannel?.subscribe(track(setTeamStatus));
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      void sb.removeChannel(channel);
      if (staffChannel) void sb.removeChannel(staffChannel);
      if (teamChannel) void sb.removeChannel(teamChannel);
    };
  }, [eventId, staff, router, refreshDelayMs, teamId, spreadMs]);

  // Joined (first, or back after a drop): whatever was broadcast before was missed, so read the page again once. The
  // "caught up" mark is set in the same transition as that read, so it lands with the refreshed page (or after 5 s at
  // most, should the read never finish); a drop clears it (in the subscription callbacks above).
  const [, startCatchUp] = useTransition();
  const previous = useRef<ChannelStatus>(joined);
  useEffect(() => {
    const before = previous.current;
    previous.current = joined;
    if (joined !== "SUBSCRIBED" || before === "SUBSCRIBED") return;
    startCatchUp(() => {
      router.refresh();
      setCaughtUp(true);
    });
    const fallback = setTimeout(() => setCaughtUp(true), 5000);
    return () => clearTimeout(fallback);
  }, [joined, router]);
  const status: ChannelStatus = joined === "SUBSCRIBED" && !caughtUp ? "CONNECTING" : joined;

  return <ChannelContext.Provider value={{ status, last }}>{children}</ChannelContext.Provider>;
}

export function useEventChannel(): ChannelValue {
  return useContext(ChannelContext);
}
