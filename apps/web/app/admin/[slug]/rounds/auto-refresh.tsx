"use client";

// Orders and IPO bids are private, so placing one sends no realtime message: while a round is open (or the IPO
// book is filling) the page re-reads itself every few seconds, as long as the tab is visible.

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
