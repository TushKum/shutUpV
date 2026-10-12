"use client";

// IPO bids: one row per company the fund may bid for (never its own squad's), each saved on its own with
// place_ipo_bid. A request is checked as it is typed with the engine's validateIpoBids against the fund's saved book
// (0 to 4,000 shares, the whole book at IPO prices within its cash), and Max gives the largest request the cash allows
// next to the other bids. One click saves: a bid can be changed or withdrawn (0) until the deadline. The rows close at
// the deadline by the server clock; the database refuses after it anyway.

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { mul } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import { ipoMax, previewIpoBid, type IpoView } from "@/lib/team/trade";
import { count, money } from "@/lib/format";
import { useServerNow } from "@/lib/live/clock";
import { ResultMessage } from "@/components/ui/action";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

const narrowInput = inputClass.replace("w-full", "w-32");

export interface IpoRowItem {
  id: string;
  ticker: string;
  name: string | null;
  ipoPrice: number;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}

export function IpoBids({ view, items, deadline }: { view: IpoView; items: IpoRowItem[]; deadline: string | null }) {
  const now = useServerNow(1000);
  const closed = deadline !== null && now > new Date(deadline).getTime();
  return (
    <ul className="divide-y divide-slate-100" aria-label="IPO bids">
      {items.map((c) => {
        const saved = view.bids[c.id] ?? 0;
        return <IpoRow key={`${c.id}:${saved}`} view={view} item={c} saved={saved} closed={closed} />;
      })}
    </ul>
  );
}

function IpoRow({ view, item, saved, closed }: { view: IpoView; item: IpoRowItem; saved: number; closed: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState(saved > 0 ? String(saved) : "");
  const [result, dispatch, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await safely(() => item.action(prev, form));
    router.refresh();
    return r;
  }, null);
  const preview = previewIpoBid(view, item.id, qty);
  const unchanged = preview.state === "OK" && preview.qty === saved;
  const inputId = `ipo-qty-${item.id}`;
  return (
    <li className="py-3" data-testid={`ipo-${item.ticker}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span>
          <span className="font-mono font-semibold">{item.ticker}</span>
          {item.name ? <span className="ml-1 text-sm text-slate-600">{item.name}</span> : null}
        </span>
        <span className="text-sm">
          IPO price <span className="font-mono font-semibold tabular-nums">{money(item.ipoPrice)}</span>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500" data-testid="ipo-saved">
        {saved > 0 ? `Your bid: ${count(saved)} shares (${money(mul(saved, item.ipoPrice))})` : "No bid"}
      </p>
      <form
        aria-label={`Bid for ${item.ticker}`}
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (closed) return;
          const form = new FormData(e.currentTarget);
          startTransition(() => dispatch(form));
        }}
      >
        <div className="flex flex-wrap gap-2">
          <label htmlFor={inputId} className="sr-only">
            Shares of {item.ticker}
          </label>
          <input
            id={inputId}
            name="qty"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0 to 4,000"
            disabled={closed}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={`${narrowInput} font-mono`}
          />
          <button type="button" className={buttonClass.secondary} disabled={closed} onClick={() => setQty(String(ipoMax(view, item.id)))}>
            Max
          </button>
          <button type="submit" disabled={closed || pending || preview.state !== "OK" || unchanged} className={buttonClass.primary}>
            {pending ? "Saving…" : preview.state === "OK" && preview.withdraw && saved > 0 ? "Withdraw bid" : "Save bid"}
          </button>
        </div>
        <div aria-live="polite" className="mt-1 text-sm">
          {preview.state === "REFUSED" ? (
            <p className="text-red-700">The exchange would refuse this bid: {preview.message}</p>
          ) : preview.state === "OK" && !unchanged ? (
            <p className="text-slate-700">
              {preview.withdraw ? (
                "Withdraws your bid."
              ) : (
                <>
                  {count(preview.qty)} × {money(item.ipoPrice)} = <span className="font-mono font-semibold">{money(preview.cost)}</span>.
                </>
              )}{" "}
              All your bids: <span className="font-mono font-semibold">{money(preview.total)}</span>; cash left at IPO prices{" "}
              <span className="font-mono font-semibold">{money(preview.remaining)}</span>.
            </p>
          ) : null}
        </div>
        <ResultMessage result={result} />
      </form>
    </li>
  );
}
