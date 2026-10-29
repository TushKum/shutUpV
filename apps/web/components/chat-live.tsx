"use client";

// Keeps a squad chat log current: re-reads the page when the squad's channel announces a message (or rejoins after a
// drop) and keeps the newest message in view (the log is the element with id "chat-log"). Used by the team's chat and
// the staff's chat viewer, inside a SquadChannel.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSquadChannel } from "@/lib/live/squad-channel";

export function ChatLive({ newest }: { newest: number | null }) {
  const router = useRouter();
  const { last, joins } = useSquadChannel();
  useEffect(() => {
    if (last || joins > 0) router.refresh();
  }, [last, joins, router]);
  useEffect(() => {
    const log = document.getElementById("chat-log");
    if (log) log.scrollTop = log.scrollHeight;
  }, [newest]);
  return null;
}
