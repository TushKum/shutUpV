"use client";

// "Run the judge here": while it is on, this console works the judge queue by calling POST /api/judge/work again and
// again (each call claims runs for about 50 s, JUDGE_CONCURRENCY at a time, and answers with what it did). With
// nothing to claim it asks again every 5 s, so runs that are queued later (extra runs, a retry, a re-run, calibration)
// are picked up. Several consoles can run it at once: they share the queue. It switches itself off on any refusal
// (signed out, not an organiser, the fake judge on a live event, a missing API key, a configuration error) and after
// three network failures in a row. It stays on across a reload of the page (this tab only).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, buttonClass } from "@/components/ui/ui";

/** What one call of /api/judge/work did (the route's JSON). */
export interface WorkTurn {
  done: number;
  failed: number;
  retried: number;
  calibration: number;
  sealed: number;
  claimed: number;
  errors: number;
  ms: number;
  stopped: string;
  reason?: string;
  fake?: boolean;
  remaining?: { queued: number; running: number; done: number; failed: number } | null;
}

interface Totals {
  turns: number;
  done: number;
  calibration: number;
  failed: number;
  retried: number;
  sealed: number;
  since: number;
}

const IDLE_MS = 5000;
const NETWORK_RETRIES = 3;
const storageKey = (eventId: string) => `msim-judge-runner:${eventId}`;

function remembered(eventId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(eventId)) === "on";
  } catch {
    return false;
  }
}

function remember(eventId: string, on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(storageKey(eventId), "on");
    else window.sessionStorage.removeItem(storageKey(eventId));
  } catch {
    // Private mode or blocked storage: the loop just does not survive a reload.
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

export function JudgeRunner({ eventId, fake, canRun }: { eventId: string; fake: boolean; canRun: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<WorkTurn | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const loop = useRef<AbortController | null>(null);

  const stop = useCallback(
    (why: string | null = null) => {
      loop.current?.abort();
      loop.current = null;
      setOn(false);
      setBusy(false);
      remember(eventId, false);
      if (why) setProblem(why);
    },
    [eventId],
  );

  const start = useCallback(() => {
    if (loop.current) return;
    const ctrl = new AbortController();
    loop.current = ctrl;
    setOn(true);
    setProblem(null);
    setTotals({ turns: 0, done: 0, calibration: 0, failed: 0, retried: 0, sealed: 0, since: Date.now() });
    remember(eventId, true);
    void (async () => {
      let networkFailures = 0;
      while (!ctrl.signal.aborted) {
        setBusy(true);
        let res: Response;
        try {
          res = await fetch("/api/judge/work", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: eventId }),
            cache: "no-store",
            signal: ctrl.signal,
          });
        } catch {
          if (ctrl.signal.aborted) return;
          networkFailures++;
          setBusy(false);
          if (networkFailures >= NETWORK_RETRIES) {
            stop("The judge stopped: the server could not be reached three times in a row.");
            return;
          }
          await sleep(IDLE_MS, ctrl.signal);
          continue;
        }
        networkFailures = 0;
        const body = (await res.json().catch(() => null)) as (WorkTurn & { error?: string }) | null;
        if (ctrl.signal.aborted) return;
        if (!res.ok || !body) {
          stop(`The judge stopped: ${body?.error ?? body?.reason ?? `the server answered ${res.status}`}`);
          router.refresh();
          return;
        }
        setLast(body);
        setTotals((t) =>
          t
            ? {
                ...t,
                turns: t.turns + 1,
                done: t.done + body.done,
                calibration: t.calibration + body.calibration,
                failed: t.failed + body.failed,
                retried: t.retried + body.retried,
                sealed: t.sealed + body.sealed,
              }
            : t,
        );
        if (body.claimed > 0 || body.failed > 0) router.refresh();
        if (body.stopped === "fatal" || body.stopped === "error") {
          stop(`The judge stopped: ${body.reason ?? "an error it cannot get past"}.`);
          router.refresh();
          return;
        }
        setBusy(false);
        // Nothing claimable right now (or everything waits out a backoff): ask again shortly.
        if (body.claimed === 0) await sleep(IDLE_MS, ctrl.signal);
      }
    })();
  }, [eventId, router, stop]);

  // Back on after a reload of this tab, if it was on.
  useEffect(() => {
    if (canRun && remembered(eventId)) start();
    return () => {
      loop.current?.abort();
      loop.current = null;
    };
  }, [canRun, eventId, start]);

  if (!canRun) return null;
  return (
    <div className="space-y-2" data-testid="judge-runner" data-state={on ? (busy ? "working" : "idle") : "off"}>
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <button type="button" className={buttonClass.danger} onClick={() => stop()}>
            Stop the judge here
          </button>
        ) : (
          <button type="button" className={buttonClass.primary} onClick={start}>
            Run the judge here
          </button>
        )}
        {fake ? <Badge tone="amber">FAKE JUDGE</Badge> : null}
        {on ? (
          <span className="text-sm text-slate-600" role="status">
            {busy ? "Judging…" : "Waiting for runs…"}
          </span>
        ) : null}
      </div>
      {totals && totals.turns > 0 ? (
        <p className="text-sm text-slate-600" data-testid="judge-runner-totals">
          This console: {totals.done} run{totals.done === 1 ? "" : "s"} done
          {totals.calibration ? `, ${totals.calibration} calibration` : ""}, {totals.sealed} sealed, {totals.retried} sent back to the queue,{" "}
          <span className={totals.failed ? "font-semibold text-red-700" : ""}>{totals.failed} failed</span>
          {last ? ` · last turn ${Math.round(last.ms / 1000)} s` : ""}
        </p>
      ) : null}
      {problem ? (
        <p className="text-sm font-semibold text-red-700" role="alert" data-testid="judge-runner-problem">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
