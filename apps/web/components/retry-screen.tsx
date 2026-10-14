"use client";

// What a projector shows when a read fails (a database timeout, the connection dropping mid-render): a calm black
// "Reconnecting" screen that tries again by itself every few seconds, so the big screen recovers without anyone
// reloading it. `retry()` re-fetches and re-renders the failed part of the page.

import { useEffect } from "react";

export const RETRY_MS = 5_000;

export function RetryScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const id = setInterval(() => retry(), RETRY_MS);
    return () => clearInterval(id);
  }, [error, retry]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-black px-8 text-center text-white" data-testid="display-retry">
      <p className="text-5xl font-black tracking-tight">Reconnecting…</p>
      <p className="text-2xl text-slate-300">The screen could not be read just now. It tries again every {RETRY_MS / 1000} seconds.</p>
      {error.digest ? <p className="font-mono text-base text-slate-500">{error.digest}</p> : null}
    </main>
  );
}
