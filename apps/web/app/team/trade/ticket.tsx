"use client";

// The order ticket: company (never the fund's own squad company), type and whole-share quantity, checked as the
// person types with the engine's validateOrder against the fund's own view (the page's data, re-read after every
// action and every broadcast), the reserve or collateral the order will lock, and a Max button (the engine's
// maxQuantity). The check is guidance: the database checks again and its refusal is shown as it comes.
//
// One click places the order: it can be edited or cancelled until the round closes, so a second click would only
// slow the last minute of a round. Each attempt carries a client reference, so the same order sent twice (a double
// click, a retry after a dropped connection) is placed once. The ticket closes at the round's closing time by the
// server clock.

import { startTransition, useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ORDER_TYPES, type OrderContext, type OrderType } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import { ORDER_TYPE_INFO, clientRef, companyPosition, maxOrder, newNonce, orderLabel, parseShares, previewOrder, type OrderPreview } from "@/lib/team/trade";
import { clock, count, money } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import { ResultMessage } from "@/components/ui/action";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

export interface TicketCompany {
  id: string;
  ticker: string;
  name: string | null;
  price: number;
}

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function OrderTicket({
  ctx,
  companies,
  round,
  action,
}: {
  ctx: OrderContext;
  companies: TicketCompany[];
  round: { number: number; closesAt: string };
  action: Action;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState("");
  const [type, setType] = useState<OrderType>("BUY");
  const [qty, setQty] = useState("");
  const [maxNote, setMaxNote] = useState<string | null>(null);
  // The current attempt's nonce: kept until an order is accepted, so a resent order repeats its reference.
  const nonce = useRef<string | null>(null);
  const now = useServerNow(1000);
  const closed = now >= new Date(round.closesAt).getTime();

  const [result, dispatch, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await safely(() => action(prev, form));
    if (r.ok) {
      nonce.current = null;
      setQty("");
    }
    router.refresh();
    return r;
  }, null);

  const company = companies.find((c) => c.id === picked) ?? null;
  const companyId = company?.id ?? "";
  const preview = previewOrder(ctx, companyId, type, qty);
  const pos = company ? companyPosition(ctx, company.id) : null;
  const parsed = parseShares(qty);
  // A refusal the screen predicts is not sent; an order the screen cannot check is (the exchange decides).
  const placeLabel =
    company !== null && parsed !== null && (preview.state === "OK" || preview.state === "UNKNOWN") ? `Place ${orderLabel(type, parsed, company.ticker)}` : null;

  return (
    <form
      aria-label="Order ticket"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (closed || pending || !company || parsed === null || placeLabel === null) return;
        const form = new FormData(e.currentTarget);
        nonce.current ??= newNonce();
        form.set("client_ref", clientRef(nonce.current, company.id, type, parsed));
        startTransition(() => dispatch(form));
      }}
    >
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Company</span>
        <select
          name="company"
          required
          value={companyId}
          onChange={(e) => {
            setPicked(e.target.value);
            setMaxNote(null);
          }}
          className={inputClass}
        >
          <option value="" disabled>
            Choose a company…
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.ticker}
              {c.name ? ` · ${c.name}` : ""} · {money(c.price)}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="ticker" value={company?.ticker ?? ""} />

      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Order type</legend>
        <div className="mt-1 grid grid-cols-4 gap-1">
          {ORDER_TYPES.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center justify-center rounded-md px-2 py-2 text-sm font-semibold ring-1 ring-inset has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-slate-900 ${
                type === t ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => {
                  setType(t);
                  setMaxNote(null);
                }}
                className="sr-only"
              />
              {t}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{ORDER_TYPE_INFO[type].hint}</p>
      </fieldset>

      <div>
        <label htmlFor="order-qty" className="text-xs font-medium text-slate-600">
          Quantity (shares)
        </label>
        <div className="mt-0.5 flex gap-2">
          <input
            id="order-qty"
            name="qty"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 500"
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              setMaxNote(null);
            }}
            className={`${inputClass} font-mono`}
          />
          <button
            type="button"
            className={`${buttonClass.secondary} shrink-0`}
            disabled={!company}
            onClick={() => {
              if (!company) return;
              const m = maxOrder(ctx, company.id, type);
              if (m.max > 0) setQty(String(m.max));
              else setMaxNote(`No ${type} of ${company.ticker} would pass right now: ${m.reason ?? "check the limits below."}`);
            }}
          >
            Max
          </button>
        </div>
        {maxNote ? (
          <p className="mt-1 text-sm text-red-700" role="alert">
            {maxNote}
          </p>
        ) : null}
      </div>

      {company && pos ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs sm:grid-cols-4" aria-label={`Your position in ${company.ticker}`}>
          <Fact label="Price now" value={money(pos.price)} />
          <Fact label="You hold (exchange lot)" value={`${count(pos.exchangeQty)}${pos.pending.SELL ? ` · selling ${count(pos.pending.SELL)}` : ""}`} />
          <Fact label="You are short" value={`${count(pos.shortQty)}${pos.pending.COVER ? ` · covering ${count(pos.pending.COVER)}` : ""}`} />
          <Fact label={roomLabel(type)} value={count(roomOf(type, pos))} />
        </dl>
      ) : null}

      <Preview preview={preview} type={type} roundNumber={round.number} />

      {closed ? (
        <p className="text-sm font-medium text-amber-800" role="status">
          Round {round.number} closed at {clock(round.closesAt, true)}: orders are refused until the next round opens.
        </p>
      ) : null}

      <div>
        <button type="submit" disabled={pending || closed || placeLabel === null} className={buttonClass.primary}>
          {pending ? "Placing…" : (placeLabel ?? "Place order")}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

function roomLabel(type: OrderType): string {
  return { BUY: "Can still buy (4,000 limit)", SELL: "Can still sell", SHORT: "Can still short (2,000 limit)", COVER: "Can still cover" }[type];
}

function roomOf(type: OrderType, pos: ReturnType<typeof companyPosition>): number {
  return { BUY: pos.longRoom, SELL: pos.sellable, SHORT: pos.shortRoom, COVER: pos.coverable }[type];
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

/** What the exchange will say, as the person types. */
export function Preview({ preview, type, roundNumber }: { preview: OrderPreview; type: OrderType; roundNumber: number }) {
  return (
    <div aria-live="polite" data-testid="order-preview" className="text-sm">
      {preview.state === "EMPTY" ? (
        <p className="text-slate-500">Choose a company and type a quantity: the ticket checks the order as you type.</p>
      ) : preview.state === "REFUSED" ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-red-800 ring-1 ring-inset ring-red-200">
          The exchange would refuse this order: <span className="font-semibold">{preview.message}</span>
        </p>
      ) : preview.state === "UNKNOWN" ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-inset ring-amber-200">{preview.message}</p>
      ) : (
        <ul className="space-y-1 rounded-md bg-emerald-50 px-3 py-2 text-emerald-950 ring-1 ring-inset ring-emerald-200">
          <li>
            Value at the current price: <Num>{money(preview.value)}</Num> ({count(preview.qty)} × {money(preview.price)}). It fills at round {roundNumber}&apos;s
            clearing price, which moves 1% for every 1,000 shares of net demand (at most 10%).
          </li>
          <li data-testid="order-reserve">
            {type === "BUY" ? (
              <>
                Cash reserved until the clearing: <Num>{money(preview.reserve)}</Num> (quantity × price × 1.10).
              </>
            ) : type === "SHORT" ? (
              <>
                Collateral reserved until the clearing: <Num>{money(preview.reserve)}</Num> (quantity × price × 150% × 1.10). After it, 150% of the short&apos;s value
                stays locked as collateral.
              </>
            ) : (
              ORDER_TYPE_INFO[type].reserve
            )}
          </li>
          <li>
            Available cash after this order: <Num>{money(preview.availableAfter)}</Num>.
          </li>
        </ul>
      )}
    </div>
  );
}

function Num({ children }: { children: string }) {
  return <span className="font-mono font-semibold tabular-nums">{children}</span>;
}
