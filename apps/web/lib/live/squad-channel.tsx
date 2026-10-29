"use client";

// The squad's own private realtime channel ('squad:<id>'), heard only by the squad's three teams and the staff. A
// message says only that someone in the squad posted in the chat (and which team); the chat page re-reads itself
// through RLS, and the other pages show a toast. Like the event channel, a message missed while the connection was
// down is not replayed, so the chat re-reads itself each time the channel joins.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface SquadMessage {
  teamId: string | null;
  receivedAt: number;
}

interface SquadChannelValue {
  /** The latest chat message announced, or null. */
  last: SquadMessage | null;
  /** Bumped each time the channel (re)joins: whatever was posted meanwhile was missed. */
  joins: number;
}

const SquadContext = createContext<SquadChannelValue>({ last: null, joins: 0 });

export function SquadChannel({ squadId, children }: { squadId: string | null; children: ReactNode }) {
  const [last, setLast] = useState<SquadMessage | null>(null);
  const [joins, setJoins] = useState(0);
  useEffect(() => {
    if (!squadId) return;
    const sb = supabaseBrowser();
    let cancelled = false;
    const channel = sb.channel(`squad:${squadId}`, { config: { private: true } }).on("broadcast", { event: "squad_message" }, (msg: { payload?: unknown }) => {
      const p = (msg.payload ?? {}) as Record<string, unknown>;
      setLast({ teamId: typeof p.team_id === "string" ? p.team_id : null, receivedAt: Date.now() });
    });
    (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((s: string) => {
        if (s === "SUBSCRIBED") setJoins((n) => n + 1);
      });
    })();
    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [squadId]);
  return <SquadContext.Provider value={{ last, joins }}>{children}</SquadContext.Provider>;
}

export function useSquadChannel(): SquadChannelValue {
  return useContext(SquadContext);
}
