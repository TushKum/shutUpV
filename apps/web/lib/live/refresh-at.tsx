"use client";

// Re-reads the page once the server clock passes `at` (a planned end, a round's opening or closing time), so what
// the page worked out at render ("not yet due") does not go stale on a console that stays open all night. Each screen
// waits a random extra time up to `spreadMs`, so the hundreds of screens open at a deadline do not all load at once.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useServerNow } from "./clock";

export function RefreshAt({ at, afterMs = 1000, spreadMs = 1500 }: { at: string | null | undefined; afterMs?: number; spreadMs?: number }) {
  const router = useRouter();
  const now = useServerNow();
  const due = !!at && now >= new Date(at).getTime() + afterMs;
  // A time already past when the page was rendered is already in what the page shows: no re-read for it.
  const [pastAtMount] = useState(() => (due ? at : null));
  const done = useRef<string | null | undefined>(pastAtMount);
  useEffect(() => {
    if (!at || !due || done.current === at) return;
    done.current = at;
    // Not cancelled if the effect runs again: the guard above would not schedule it a second time.
    setTimeout(() => router.refresh(), Math.random() * spreadMs);
  }, [at, due, router, spreadMs]);
  return null;
}
