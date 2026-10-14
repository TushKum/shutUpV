"use client";

// The server clock decides every deadline, so screens count down against it: the offset between the server and
// this browser is taken from the page render and refined by every heartbeat. While the event is paused, deadlines
// are counted against the moment the pause began: every deadline moves later by the length of the pause when the
// event resumes (and the database treats a deadline after the pause began as not yet passed), so countdowns freeze.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ClockValue {
  /** server time − browser time, in ms */
  offset: number;
  setServerTime(serverIso: string, sentAt: number): void;
  /** When the event was paused (ms), while it is paused. */
  pausedAt: number | null;
}

const ClockContext = createContext<ClockValue>({ offset: 0, setServerTime: () => {}, pausedAt: null });

export function ClockProvider({ serverTime, pausedAt = null, children }: { serverTime: string; pausedAt?: string | null; children: ReactNode }) {
  const [offset, setOffset] = useState(() => new Date(serverTime).getTime() - Date.now());
  // Stable, so the heartbeat does not restart whenever the offset is refined. Half the round trip is the best
  // estimate of when the server read its clock.
  const setServerTime = useCallback((iso: string, sentAt: number) => setOffset(new Date(iso).getTime() - (sentAt + Date.now()) / 2), []);
  const paused = pausedAt ? Date.parse(pausedAt) : null;
  const value = useMemo<ClockValue>(() => ({ offset, setServerTime, pausedAt: paused }), [offset, setServerTime, paused]);
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useClock(): ClockValue {
  return useContext(ClockContext);
}

/** The server's current time in ms, re-rendering every `everyMs`. */
export function useServerNow(everyMs = 1000): number {
  const { offset } = useClock();
  const [browserNow, setBrowserNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setBrowserNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return browserNow + offset;
}

/** The time deadlines are counted against: the server's current time, or the moment the pause began while paused. */
export function useDeadlineNow(everyMs = 1000): number {
  const now = useServerNow(everyMs);
  const { pausedAt } = useClock();
  return pausedAt ?? now;
}
