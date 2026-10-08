"use client";

// A countdown (or the time since) against the server clock.

import { countdown } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";

export function Countdown({ to, passed = "passed", className = "" }: { to: string | null | undefined; passed?: string; className?: string }) {
  const now = useServerNow(1000);
  if (!to) return <span className={className}>—</span>;
  const ms = new Date(to).getTime() - now;
  // The server rendered a second or so earlier; the clock text is expected to differ.
  return (
    <span className={`font-mono tabular-nums ${className}`} suppressHydrationWarning>
      {ms > 0 ? countdown(ms) : passed}
    </span>
  );
}

export function ServerClock({ className = "" }: { className?: string }) {
  const now = useServerNow(1000);
  return (
    <span className={`font-mono tabular-nums ${className}`} suppressHydrationWarning>
      {new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now)}
    </span>
  );
}
