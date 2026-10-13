"use client";

// The result of an action is shown next to the control that ran it. When that control disappears right after the
// action (the window closed, the row moved or was removed, the item left a list), its result would vanish with it,
// so it is carried to a bar at the top of the page instead: an order refused at the close still says why.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/rpc";
import { ResultMessage } from "@/components/ui/result-message";

/** A result is carried only if its control goes away within this long of receiving it (the refresh after the action). */
const CARRY_MS = 8000;
/** How long the bar shows a carried result. */
const SHOW_MS = 20_000;

type Report = (result: ActionResult) => void;
interface Shown {
  result: ActionResult;
  id: number;
}

const ReportContext = createContext<Report | null>(null);
const ShownContext = createContext<{ shown: Shown | null; dismiss: () => void }>({ shown: null, dismiss: () => {} });

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const report = useCallback<Report>((result) => setShown({ result, id: Date.now() }), []);
  const dismiss = useCallback(() => setShown(null), []);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown((s) => (s?.id === shown.id ? null : s)), SHOW_MS);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <ReportContext.Provider value={report}>
      <ShownContext.Provider value={{ shown, dismiss }}>{children}</ShownContext.Provider>
    </ReportContext.Provider>
  );
}

/** Where carried results appear (once per page, above the content). */
export function FeedbackBar({ className = "" }: { className?: string }) {
  const { shown, dismiss } = useContext(ShownContext);
  if (!shown) return null;
  return (
    <div className={className} data-testid="feedback-bar">
      <div className="flex items-start justify-between gap-3 rounded-md bg-white px-3 py-1 ring-1 ring-slate-200">
        <ResultMessage result={shown.result} />
        <button type="button" onClick={dismiss} className="mt-2 text-xs text-slate-500 underline" aria-label="Dismiss this message">
          Dismiss
        </button>
      </div>
    </div>
  );
}

export interface Carrier {
  /** Called by the action with its result as soon as it comes back: if the control has gone, the bar shows it. */
  deliver(r: ActionResult): void;
  /** Called when the control shows a result: if the control goes away within a few seconds, the bar shows it. */
  note(r: ActionResult): void;
}

/**
 * Keeps an action's result from being lost when its control disappears: either before the result comes back (the
 * round closed while the order was on its way) or right after (the refresh removed the row). Declare it before the
 * action state, and pass the shown result to useCarried after it.
 */
export function useCarrier(): Carrier {
  const report = useContext(ReportContext);
  const latest = useRef<{ result: ActionResult; at: number } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const last = latest.current;
      if (last && report && Date.now() - last.at < CARRY_MS) report(last.result);
    };
  }, [report]);
  return useMemo<Carrier>(
    () => ({
      deliver: (r) => {
        // Noted at once: the refresh that follows an action can remove the control in the very render that would
        // have shown the result, before any effect of that render runs.
        latest.current = { result: r, at: Date.now() };
        if (!mounted.current) report?.(r);
      },
      note: (r) => {
        latest.current = { result: r, at: Date.now() };
      },
    }),
    [report],
  );
}

/** Notes the result a control shows, for useCarrier. */
export function useCarried(carrier: Carrier, result: ActionResult | null) {
  useEffect(() => {
    if (result) carrier.note(result);
  }, [carrier, result]);
}

/** useCarrier and useCarried for a control whose result is plain state (declared before it). */
export function useCarryOver(result: ActionResult | null): (r: ActionResult) => void {
  const carrier = useCarrier();
  useCarried(carrier, result);
  return carrier.deliver;
}
