"use client";

// BUY or SELL for one covered company in one window. One click: a call can be changed until its window closes, and
// the current call is always shown. The buttons close the moment the due time passes by the server clock (the
// database refuses anyway); a release that closes the window early refreshes the page through realtime.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CallDirection } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import type { PauseState } from "@/lib/team/rescue";
import { ResultMessage } from "@/components/ui/action";
import { useCarryOver } from "@/lib/live/feedback";
import { safely } from "@/components/ui/action-helpers";
import { useDeadlineOpen } from "../rescue/parts";
import { makeCall } from "./actions";

const DIRECTIONS: CallDirection[] = ["BUY", "SELL"];

export function CallChoice({
  companyId,
  label,
  no,
  direction,
  due,
  pause,
}: {
  companyId: string;
  label: string;
  no: number;
  direction: CallDirection | null;
  due: string | null;
  pause: PauseState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const deliver = useCarryOver(result);
  const open = useDeadlineOpen(due, pause);
  const send = (d: CallDirection) =>
    start(async () => {
      const r = await safely(() => makeCall(companyId, no, d, label, due));
      deliver(r);
      setResult(r);
      router.refresh();
    });
  return (
    <div>
      <div className="flex gap-2" role="group" aria-label={`Call ${no} on ${label}`}>
        {DIRECTIONS.map((d) => {
          const chosen = direction === d;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={chosen}
              disabled={!open || pending}
              onClick={() => (chosen ? undefined : send(d))}
              className={`min-w-20 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50 ${
                chosen
                  ? d === "BUY"
                    ? "bg-[#46f097] text-[#031109] ring-[#46f097]"
                    : "bg-rose-500 text-white ring-rose-400"
                  : "bg-white/[0.06] text-slate-200 ring-white/15 hover:bg-white/[0.12] hover:text-white"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
      {!open ? <p className="mt-1 text-xs text-muted">The due time has passed.</p> : null}
      <ResultMessage result={result} />
    </div>
  );
}
