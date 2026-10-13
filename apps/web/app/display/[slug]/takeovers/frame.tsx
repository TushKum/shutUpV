"use client";

// The frame of every full-screen takeover: a strip with the takeover's name, the event clock and a bar showing how
// long it stays up, over the whole 1920×1080 stage. The content fills the rest.

import type { ReactNode } from "react";
import { ServerClock } from "@/components/ui/countdown";
import { useServerNow } from "@/lib/live/clock";

export function TakeoverFrame({
  title,
  at,
  until,
  tone = "bg-white text-black",
  children,
}: {
  title: string;
  at: string;
  until: string | null;
  /** Colours of the strip. */
  tone?: string;
  children: ReactNode;
}) {
  const now = useServerNow(500);
  const start = Date.parse(at);
  const end = until ? Date.parse(until) : null;
  const left = end === null ? null : Math.max(0, Math.min(1, (end - now) / (end - start)));
  return (
    <section className="flex h-full flex-col" data-testid="takeover" aria-label={title}>
      <div className={`relative flex h-[110px] shrink-0 items-center justify-between px-12 ${tone}`}>
        <h1 className="text-[56px] font-black tracking-wide uppercase">{title}</h1>
        <ServerClock className="text-[52px] font-bold" />
        {left !== null ? (
          <div className="absolute bottom-0 left-0 h-2 bg-black/40" style={{ width: `${left * 100}%` }} suppressHydrationWarning />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 px-12 py-10">{children}</div>
    </section>
  );
}
