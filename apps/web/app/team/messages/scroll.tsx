"use client";

// Keeps the newest hire-chat message in view (the log is the element with id "chat-log").

import { useEffect } from "react";

export function KeepNewestInView({ newest }: { newest: number | null }) {
  useEffect(() => {
    const log = document.getElementById("chat-log");
    if (log) log.scrollTop = log.scrollHeight;
  }, [newest]);
  return null;
}
