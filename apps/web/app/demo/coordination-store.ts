"use client";
import { useCallback, useEffect, useState } from "react";
import {
  applyCoordinationAction,
  createInitialCoordinationState,
  type CoordinationAction,
  type CoordinationState,
} from "./coordination-types";

const STORAGE_KEY = "primus-coordination-v4";
const CHANNEL_NAME = "primus-coordination-v4";
const IN_TAB_EVENT = "primus-coordination-update";
const API_URL = "/demo/api/coordination";

let cachedState: CoordinationState = createInitialCoordinationState();
let hydratedFromLocal = false;
let channel: BroadcastChannel | null = null;
let pollTimer: number | null = null;
let subscriberCount = 0;
let inFlightPostCount = 0;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

function readFromLocalStorage(): CoordinationState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoordinationState;
    if (
      parsed &&
      typeof parsed.version === "number" &&
      parsed.products &&
      typeof parsed.products.XP01?.sharePrice === "number" &&
      parsed.consultants &&
      typeof parsed.consultants.XC01?.baseEquityPct === "number" &&
      Array.isArray(parsed.raiseRequests) &&
      Array.isArray(parsed.financeDeals)
    ) {
      return parsed;
    }
  } catch {
    /* ignore storage errors */
  }
  return null;
}

function writeToLocalStorage(state: CoordinationState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

function adoptState(next: CoordinationState, broadcast = false) {
  cachedState = next;
  writeToLocalStorage(next);
  notifyListeners();
  if (broadcast && typeof window !== "undefined") {
    try {
      channel?.postMessage(next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(IN_TAB_EVENT));
  }
}

async function fetchServerState() {
  if (typeof window === "undefined" || inFlightPostCount > 0) return;
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) return;
    const remote = (await res.json()) as CoordinationState;
    if (!remote || typeof remote.version !== "number") return;
    if (
      remote.version > cachedState.version ||
      (remote.version === cachedState.version && remote.updatedAt !== cachedState.updatedAt)
    ) {
      adoptState(remote, false);
    }
  } catch {
    /* offline or static fallback; localStorage + BroadcastChannel continue working */
  }
}

function ensureStarted() {
  if (typeof window === "undefined") return;
  if (!hydratedFromLocal) {
    hydratedFromLocal = true;
    const stored = readFromLocalStorage();
    if (stored && stored.version >= cachedState.version) {
      cachedState = stored;
    }
  }

  if (!channel && typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<CoordinationState>) => {
        const incoming = event.data;
        if (
          incoming &&
          typeof incoming.version === "number" &&
          (incoming.version > cachedState.version ||
            (incoming.version === cachedState.version && incoming.updatedAt !== cachedState.updatedAt))
        ) {
          cachedState = incoming;
          notifyListeners();
        }
      };
    } catch {
      channel = null;
    }
  }

  if (pollTimer === null) {
    void fetchServerState();
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchServerState();
      }
    }, 1200);
  }
}

function maybeStopPolling() {
  if (subscriberCount <= 0 && pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function dispatchCoordination(action: CoordinationAction): CoordinationState {
  // 1. Apply immediately (optimistic 0ms update + localStorage + BroadcastChannel)
  const optimistic = applyCoordinationAction(cachedState, action);
  adoptState(optimistic, true);

  // 2. Sync to server route so separate browsers / Incognito / LAN devices stay 100% live-synced
  if (typeof window !== "undefined") {
    inFlightPostCount += 1;
    const req =
      action.type === "RESET"
        ? fetch(API_URL, { method: "DELETE", cache: "no-store" })
        : fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
            cache: "no-store",
          });

    req
      .then(async res => {
        if (!res.ok) return;
        const authoritative = (await res.json()) as CoordinationState;
        if (
          authoritative &&
          typeof authoritative.version === "number" &&
          authoritative.version >= cachedState.version
        ) {
          adoptState(authoritative, true);
        }
      })
      .catch(() => {
        /* fallback stays on localStorage + BroadcastChannel */
      })
      .finally(() => {
        inFlightPostCount = Math.max(0, inFlightPostCount - 1);
      });
  }

  return optimistic;
}

export function useCoordination() {
  // Start with deterministic initial state to avoid SSR hydration mismatches
  const [state, setState] = useState<CoordinationState>(() => createInitialCoordinationState());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    subscriberCount += 1;
    ensureStarted();
    setState(cachedState);
    setReady(true);

    const onUpdate = () => setState(cachedState);
    listeners.add(onUpdate);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue) as CoordinationState;
        if (
          incoming &&
          typeof incoming.version === "number" &&
          (incoming.version > cachedState.version ||
            (incoming.version === cachedState.version && incoming.updatedAt !== cachedState.updatedAt))
        ) {
          cachedState = incoming;
          notifyListeners();
        }
      } catch {
        /* ignore */
      }
    };
    const onFocus = () => {
      void fetchServerState();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      listeners.delete(onUpdate);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      subscriberCount = Math.max(0, subscriberCount - 1);
      maybeStopPolling();
    };
  }, []);

  const dispatch = useCallback((action: CoordinationAction) => {
    return dispatchCoordination(action);
  }, []);

  const reset = useCallback(() => {
    return dispatchCoordination({ type: "RESET" });
  }, []);

  return { state, dispatch, reset, ready };
}
