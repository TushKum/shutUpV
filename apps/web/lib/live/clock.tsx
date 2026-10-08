"use client";

// The server clock decides every deadline, so screens count down against it: the offset between the server and
// this browser is taken from the page render and refined by every heartbeat.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ClockValue {
  /** server time − browser time, in ms */
  offset: number;
  setServerTime(serverIso: string, sentAt: number): void;
}

const ClockContext = createContext<ClockValue>({ offset: 0, setServerTime: () => {} });

export function ClockProvider({ serverTime, children }: { serverTime: string; children: ReactNode }) {
  const [offset, setOffset] = useState(() => new Date(serverTime).getTime() - Date.now());
  // Stable, so the heartbeat does not restart whenever the offset is refined. Half the round trip is the best
  // estimate of when the server read its clock.
  const setServerTime = useCallback((iso: string, sentAt: number) => setOffset(new Date(iso).getTime() - (sentAt + Date.now()) / 2), []);
  const value = useMemo<ClockValue>(() => ({ offset, setServerTime }), [offset, setServerTime]);
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
