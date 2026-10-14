// The 05:00 closing bell: the market is closed. The closing price of every company is final; the five biggest gainers
// and losers from the IPO price to the closing price (basis points, half-up). Final results wait for the awards, so
// no team or fund appears here.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { closingMovers, type ClosingRow } from "@/lib/display/takeovers";
import { bp } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCompanies } from "./data";
import { MoverColumn, PriceMove, type MoverRowData } from "./parts";

export async function ClosingBellTakeover({ event, takeover }: TakeoverProps) {
  const companies = await loadCompanies(event.id);
  const rows: (ClosingRow & { id: string })[] = companies.map((c) => ({
    id: c.id,
    ticker: c.ticker,
    name: c.name,
    ipoPrice: c.ipo_price,
    closingPrice: c.closing_price,
  }));
  const m = closingMovers(rows);
  const toRow = (r: (typeof m.gainers)[number], tone: "up" | "down"): MoverRowData => ({
    key: r.id,
    ticker: r.ticker,
    name: r.name,
    middle: <PriceMove before={r.ipoPrice} after={r.closingPrice} tone={tone} className="text-[34px]" />,
    right: <span className={`text-[44px] font-black tabular-nums ${tone === "up" ? "text-emerald-400" : "text-red-400"}`}>{bp(r.changeBp)}</span>,
  });
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.CLOSING_BELL} at={takeover.at} until={takeover.until} tone="bg-white text-black">
      <div className="flex h-full flex-col gap-6">
        <div className="flex shrink-0 items-end justify-between gap-10">
          <p className="text-[80px] leading-none font-black" data-testid="closing-headline">
            The market is closed
          </p>
          <p className="text-right text-[32px] leading-snug text-slate-300">
            Closing prices are final.
            <br />
            Change from the IPO price to the closing price.
          </p>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-12">
          <MoverColumn
            title="Top gainers"
            tone="up"
            headers={["Company", "IPO → close", "Change"]}
            rows={m.gainers.map((r) => toRow(r, "up"))}
            empty="No company closed above its IPO price."
            testId="closing-gainers"
          />
          <MoverColumn
            title="Top losers"
            tone="down"
            headers={["Company", "IPO → close", "Change"]}
            rows={m.losers.map((r) => toRow(r, "down"))}
            empty="No company closed below its IPO price."
            testId="closing-losers"
          />
        </div>
        <p className="shrink-0 text-[40px] leading-tight font-black text-amber-300" data-testid="closing-awards">
          Final results are announced at the awards.
        </p>
      </div>
    </TakeoverFrame>
  );
}
