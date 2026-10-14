"use client";

// Shows one of several server-rendered pages at a time, each for 20 s in turn by the server clock, so every
// projector shows the same page. Until the browser takes over it shows the first page (what the server rendered), so
// the page never mismatches while hydrating.

import { useSyncExternalStore, type ReactNode } from "react";
import { useServerNow } from "@/lib/live/clock";
import { pageAt } from "@/lib/display/takeovers";

const noSubscription = () => () => {};

export function Pager({ pages, everyMs = 20_000 }: { pages: ReactNode[]; everyMs?: number }) {
  const now = useServerNow(1000);
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const i = inBrowser ? pageAt(now, pages.length, everyMs) : 0;
  return <>{pages[i]}</>;
}
