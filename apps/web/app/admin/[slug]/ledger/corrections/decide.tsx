"use client";

// Approve or reject a pending correction, with an optional note. Both need two clicks: approving applies the entries
// to the ledger for good. The game function refuses the requester (a correction needs a second person).

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { ResultMessage } from "@/components/ui/action";
import { CONFIRM_DELAY_MS, safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

type Choice = "approve" | "reject";

export function DecideCorrection({ decide, label }: { decide: (approve: boolean, note: string) => Promise<ActionResult>; label: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState<Choice | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  // Disabled for a moment after the first click, so a double-click is not two decisions.
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (coolTimer.current) clearTimeout(coolTimer.current);
    },
    [],
  );

  const click = (choice: Choice) => {
    if (timer.current) clearTimeout(timer.current);
    if (armed !== choice) {
      setArmed(choice);
      setCooling(true);
      if (coolTimer.current) clearTimeout(coolTimer.current);
      coolTimer.current = setTimeout(() => setCooling(false), CONFIRM_DELAY_MS);
      timer.current = setTimeout(() => setArmed(null), 5000);
      return;
    }
    setArmed(null);
    start(async () => {
      const r = await safely(() => decide(choice === "approve", note));
      setResult(r);
      router.refresh();
    });
  };

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <label className="block max-w-xl">
        <span className="text-xs font-medium text-slate-600">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label={`Note on ${label}`} className={inputClass} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={pending || (armed === "approve" && cooling)} onClick={() => click("approve")} className={armed === "approve" ? buttonClass.danger : buttonClass.primary}>
          {pending ? "Working…" : armed === "approve" ? "Click again to apply the correction" : "Approve and apply"}
        </button>
        <button type="button" disabled={pending || (armed === "reject" && cooling)} onClick={() => click("reject")} className={armed === "reject" ? buttonClass.danger : buttonClass.secondary}>
          {armed === "reject" ? "Click again to reject" : "Reject"}
        </button>
      </div>
      <ResultMessage result={result} />
    </div>
  );
}
