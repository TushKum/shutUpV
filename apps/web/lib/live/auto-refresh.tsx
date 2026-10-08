"use client";

// For data that changes without a realtime message (private orders and IPO bids, judge runs written by the worker,
// screen heartbeats): while `active`, the page re-reads itself every `everyMs`, as long as the tab is visible.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ everyMs, active = true }: { everyMs: number; active?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs, active]);
  return null;
}
