"use client";

// The rescue's two term forms, checked live with the engine's rules (lib/team/rescue): the fee proposal (cash and
// retained shares, with the total value at the IPO price) and the deal term this team sets (Consulting the price, the
// fund the amount, with the shares and cash moved). Both send with one click: a proposal or an edit moves nothing and
// can be changed again until the deadline; it only resets the confirmations or signatures, which the page says.
// What was typed stays when the database refuses; the form closes the moment its deadline passes.

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { money } from "@/lib/format";
import { dealPreview, dollarsText, feePreview, type PauseState, type Preview } from "@/lib/team/rescue";
import { ResultMessage } from "@/components/ui/action";
import { useCarried, useCarrier } from "@/lib/live/feedback";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";
import { useDeadlineOpen } from "./parts";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

function useSend(action: Action) {
  const router = useRouter();
  const carrier = useCarrier();
  const state = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await safely(() => action(prev, form));
    carrier.deliver(r);
    router.refresh();
    return r;
  }, null);
  useCarried(carrier, state[0]);
  return state;
}

/** The live check under a form: the refusal the database would give, or the terms it would record. */
function Check({ preview, children }: { preview: Preview<object>; children: ReactNode }) {
  return (
    <div aria-live="polite" className="mt-2 text-sm" data-testid="terms-check">
      {preview.state === "INVALID" ? (
        <p className="text-red-700">
          {preview.message}
          {preview.value !== null ? <span className="block text-slate-600">Total value: {money(preview.value)}</span> : null}
        </p>
      ) : preview.state === "OK" ? (
        <>
          {children}
          {preview.warning ? <p className="mt-1 text-amber-800">{preview.warning}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function FeeForm({
  action,
  ipoPrice,
  companyCash,
  retained,
  initial,
  current,
  deadline,
  pause,
}: {
  action: Action;
  ipoPrice: number;
  companyCash: number | null;
  retained: number | null;
  initial: { cash: string; shares: string };
  /** The terms on the table, if any: proposing them again would only reset the confirmations. */
  current: { cash: number; shares: number } | null;
  deadline: string | null;
  pause: PauseState;
}) {
  const [result, dispatch, pending] = useSend(action);
  const [cash, setCash] = useState(initial.cash);
  const [shares, setShares] = useState(initial.shares);
  const open = useDeadlineOpen(deadline, pause);
  const preview = feePreview({ cash, shares }, { ipoPrice, companyCash, retained });
  const unchanged = preview.state === "OK" && current !== null && preview.cash === current.cash && preview.shares === current.shares;
  return (
    <form
      aria-label="Propose a fee"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <fieldset disabled={!open} className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Cash (US$)</span>
          <input name="cash" inputMode="decimal" autoComplete="off" placeholder="e.g. 20000" value={cash} onChange={(e) => setCash(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Retained shares (at most 3,000)</span>
          <input name="shares" inputMode="numeric" autoComplete="off" placeholder="e.g. 1000" value={shares} onChange={(e) => setShares(e.target.value)} className={inputClass} />
        </label>
      </fieldset>
      <Check preview={preview}>
        {preview.state === "OK" ? (
          <p className="text-slate-800">
            Total value: <span className="font-semibold">{money(preview.value)}</span>
            <span className="text-slate-600">
              {" "}
              = {money(preview.cash)} cash{preview.shares > 0 ? ` + ${preview.shares.toLocaleString("en-US")} shares × IPO price ${money(ipoPrice)}` : ""}
            </span>
          </p>
        ) : null}
      </Check>
      <div className="mt-3">
        <button type="submit" disabled={!open || pending || preview.state !== "OK" || unchanged} className={buttonClass.primary}>
          {pending ? "Working…" : open ? "Propose these terms" : "The fee deadline has passed"}
        </button>
        {unchanged ? <span className="ml-2 text-xs text-slate-500">These are the terms on the table.</span> : null}
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

export function DealTermForm({
  action,
  track,
  amount,
  price,
  postCrisis,
  fundAvailable,
  deadline,
  pause,
}: {
  action: Action;
  track: "CONSULTING" | "FINANCE";
  amount: number | null;
  price: number | null;
  postCrisis: number;
  fundAvailable: number | null;
  deadline: string | null;
  pause: PauseState;
}) {
  const [result, dispatch, pending] = useSend(action);
  const current = track === "CONSULTING" ? price : amount;
  const [text, setText] = useState(current === null ? "" : dollarsText(current));
  const open = useDeadlineOpen(deadline, pause);
  const preview = dealPreview({ track, text, amount, price, postCrisis, fundAvailable });
  const consulting = track === "CONSULTING";
  const unchanged = preview.state === "OK" && (consulting ? preview.price === price : preview.amount === amount);
  return (
    <form
      aria-label={consulting ? "Propose the price" : "Set the amount"}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <fieldset disabled={!open}>
        <label className="block sm:max-w-xs">
          <span className="text-xs font-medium text-slate-600">{consulting ? "Price per share (US$)" : "Amount the fund invests (US$)"}</span>
          <input
            name={consulting ? "price" : "amount"}
            inputMode="decimal"
            autoComplete="off"
            placeholder={consulting ? "e.g. 7.50" : "e.g. 60000"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={inputClass}
          />
        </label>
      </fieldset>
      <Check preview={preview}>
        {preview.state !== "OK" ? null : preview.shares !== null && preview.cashMoved !== null && preview.price !== null ? (
          <p className="text-slate-800">
            <span className="font-semibold">{preview.shares.toLocaleString("en-US")} shares</span> at {money(preview.price)}: cash moved{" "}
            <span className="font-semibold">{money(preview.cashMoved)}</span>
            <span className="text-slate-600"> (shares = amount ÷ price, rounded down; cash = shares × price)</span>
          </p>
        ) : (
          <p className="text-slate-600">{consulting ? "The shares are known once the fund sets the amount." : "The shares are known once the Consulting team proposes the price."}</p>
        )}
      </Check>
      <div className="mt-3">
        <button type="submit" disabled={!open || pending || preview.state !== "OK" || unchanged} className={buttonClass.primary}>
          {pending ? "Working…" : !open ? "The deal deadline has passed" : consulting ? "Propose this price" : "Set this amount"}
        </button>
        {unchanged ? <span className="ml-2 text-xs text-slate-500">These are the terms on the table.</span> : null}
      </div>
      <ResultMessage result={result} />
    </form>
  );
}
