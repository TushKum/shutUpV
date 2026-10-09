"use client";

// Re-reads the page once the server clock passes `at` (a planned end, a round's opening or closing time), so what
// the page worked out at render ("not yet due") does not go stale on a console that stays open all night.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useServerNow } from "./clock";

export function RefreshAt({ at, afterMs = 1000 }: { at: string | null | undefined; afterMs?: number }) {
  const router = useRouter();
  const now = useServerNow();
  const done = useRef<string | null>(null);
  const due = !!at && now >= new Date(at).getTime() + afterMs;
  useEffect(() => {
    if (!at || !due || done.current === at) return;
    done.current = at;
    router.refresh();
  }, [at, due, router]);
  return null;
}
