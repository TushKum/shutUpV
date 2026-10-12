"use client";

// The open round's orders: each can have its quantity changed (edit_order, checked as it is typed with the engine,
// the order itself left out of the pending totals) or be cancelled (cancel_order) until the round closes by the server
// clock. Both are one click: until the round closes, an edit can be changed back and a cancelled order placed again.

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrderContext } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import { editContext, maxOrder, orderLabel, previewOrder, type OrderLine } from "@/lib/team/trade";
import { clock, count, money } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import { ActionButton, ResultMessage } from "@/components/ui/action";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

const narrowInput = inputClass.replace("w-full", "w-28");

export interface OpenOrderItem {
  line: OrderLine;
  edit: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  cancel: () => Promise<ActionResult>;
}

export function OpenOrders({ ctx, items, closesAt, accepting }: { ctx: OrderContext; items: OpenOrderItem[]; closesAt: string; accepting: boolean }) {
  const now = useServerNow(1000);
  const open = accepting && now < new Date(closesAt).getTime();
  return (
    <ul className="divide-y divide-slate-100" aria-label="Open orders">
      {items.map(({ line, edit, cancel }) => {
        const label = orderLabel(line.type, line.qty, line.ticker);
        return (
          <li key={line.id} className="py-3" data-testid="open-order">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-mono font-semibold">{label}</span>
              <span className="text-xs text-slate-500">
                placed {clock(line.createdAt, true)} at {money(line.entryPrice)}
                {line.reserve > 0 ? ` · ${line.type === "SHORT" ? "collateral" : "cash"} reserved ${money(line.reserve)}` : ""}
              </span>
            </div>
            {open ? (
              <div className="mt-2 space-y-2">
                <EditOrder key={`${line.id}:${line.qty}`} ctx={ctx} line={line} label={label} action={edit} />
                <ActionButton action={cancel}>Cancel order</ActionButton>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EditOrder({ ctx, line, label, action }: { ctx: OrderContext; line: OrderLine; label: string; action: OpenOrderItem["edit"] }) {
  const router = useRouter();
  const [qty, setQty] = useState(String(line.qty));
  const ectx = editContext(ctx, line.id);
  const preview = previewOrder(ectx, line.companyId, line.type, qty);
  const unchanged = preview.state === "OK" && preview.qty === line.qty;
  const [result, dispatch, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await safely(() => action(prev, form));
    router.refresh();
    return r;
  }, null);
  return (
    <form
      aria-label={`Change ${label}`}
      className="min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`qty-${line.id}`}>
          New quantity for {label}
        </label>
        <input
          id={`qty-${line.id}`}
          name="qty"
          inputMode="numeric"
          autoComplete="off"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className={`${narrowInput} font-mono`}
        />
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => {
            const m = maxOrder(ectx, line.companyId, line.type);
            if (m.max > 0) setQty(String(m.max));
          }}
        >
          Max
        </button>
        <button type="submit" disabled={pending || preview.state !== "OK" || unchanged} className={buttonClass.primary}>
          {pending ? "Saving…" : "Change quantity"}
        </button>
      </div>
      {preview.state === "REFUSED" || preview.state === "UNKNOWN" ? (
        <p className="mt-1 text-sm text-red-700">The exchange would refuse this change: {preview.message}</p>
      ) : preview.state === "OK" && !unchanged && preview.reserve > 0 ? (
        <p className="mt-1 text-xs text-slate-600">
          {count(preview.qty)} shares reserve {money(preview.reserve)}; available cash after the change {money(preview.availableAfter)}.
        </p>
      ) : null}
      <ResultMessage result={result} />
    </form>
  );
}
