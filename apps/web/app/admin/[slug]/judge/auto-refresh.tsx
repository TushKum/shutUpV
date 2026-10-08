"use client";

// Judge runs are written by the judge worker without a realtime message, so while a run is queued or running the
// page re-reads itself every few seconds (as long as the tab is visible) to show the progress.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function JudgeAutoRefresh({ everyMs, active }: { everyMs: number; active: boolean }) {
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
