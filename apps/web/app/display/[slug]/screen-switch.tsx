"use client";

// Shows the takeover the server chose until it runs out (by the server clock), then the header, banner and board. The
// server re-reads the page at that moment as well (RefreshAt), so the next frame comes from fresh data.

import type { ReactNode } from "react";
import { useServerNow } from "@/lib/live/clock";

export function ScreenSwitch({ until, takeover, children }: { until: string | null; takeover: ReactNode | null; children: ReactNode }) {
  const now = useServerNow(250);
  const showing = takeover !== null && (until === null || now < Date.parse(until));
  return showing ? <>{takeover}</> : <>{children}</>;
}
