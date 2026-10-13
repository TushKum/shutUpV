import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { fundContext, loadTradeData } from "@/lib/team/trade-data";
import { companyPosition, fundSummary } from "@/lib/team/trade";
import { FUND_LOT_HINTS, FUND_LOT_LABELS, collateralView, meterPct, portfolioTotals, positionLines } from "@/lib/team/portfolio";
import { bp, clock, count, money, signedMoney } from "@/lib/format";
import { Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { tradeGate } from "../gate";

export const metadata: Metadata = { title: "Positions" };

// Positions: every company and lot the fund holds (exchange, squad lot, short) with its average cost, the current
// price, the market value and the unrealised profit and loss; the portfolio's value and its return on the $500,000
// start; and the collateral and limits (locked vs required, short exposure vs the $250,000 cap, whether new buys and
// shorts are blocked). Every price change broadcasts, so the page re-reads itself after each clearing and tier.
export default async function PositionsPage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const data = await loadTradeData(ctx, { orders: "pending" });
  const closed = data.marketClosedAt !== null;
  const lines = positionLines(data.holdings, data.companies, closed);
  const totals = portfolioTotals(ctx.team.cash, lines);
  const fctx = fundContext(ctx, data);
  const summary = fundSummary(fctx);
  const coll = collateralView(fctx);
  const limitCompanies = data.companies.filter((c) => {
    const p = companyPosition(fctx, c.id);
    return p.exchangeQty + p.shortQty + p.pending.BUY + p.pending.SHORT > 0;
  });
  const priceWord = closed ? "closing" : "market";

  return (
    <div className="space-y-4">
      {closed ? (
        <Notice>
          The market closed at {clock(data.marketClosedAt)}: every short was covered at the closing price, and positions are valued at closing prices.
        </Notice>
      ) : null}

      <Panel title="Portfolio">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Portfolio value" value={<span data-testid="portfolio-value">{money(totals.value)}</span>} hint={`Cash + long − short, at ${priceWord} prices`} />
          <Stat
            label={`Return on ${money(totals.start)}`}
            value={<span data-testid="portfolio-return">{bp(totals.returnBp)}</span>}
            hint={<span data-testid="portfolio-gain">{signedMoney(totals.gain)}</span>}
          />
          <Stat label="Cash" value={money(totals.cash)} />
          <Stat label="Long shares" value={money(totals.longValue)} hint="Exchange and squad lots" />
          <Stat label="Short shares" value={money(totals.shortValue)} hint={closed ? "Covered at the close" : "What covering would cost"} />
          <Stat label={closed ? "Profit and loss at closing prices" : "Unrealised profit and loss"} value={<span data-testid="portfolio-pnl">{signedMoney(totals.unrealised)}</span>} />
        </div>
        {totals.unpriced > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {count(totals.unpriced)} {totals.unpriced === 1 ? "line has" : "lines have"} no price until the IPO prices are released and {totals.unpriced === 1 ? "is" : "are"} not counted.
          </p>
        ) : null}
      </Panel>

      <Panel title="Positions">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">No shares yet.</p>
        ) : (
          <Table head={["Company", "Shares", "Value", "Profit and loss", `Price (${priceWord})`, "Avg cost"]} label="Positions">
            {lines.map((l) => (
              <tr key={l.key} data-testid={`position-${l.ticker}-${l.lot}`}>
                <Td>
                  <Link href={`/team/market/${l.ticker}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                    {l.ticker}
                  </Link>{" "}
                  <span className="text-xs text-slate-500" title={FUND_LOT_HINTS[l.lot]}>
                    {FUND_LOT_LABELS[l.lot]}
                  </span>
                </Td>
                <Td mono className="text-right">
                  {count(l.qty)}
                </Td>
                <Td mono className={`text-right ${l.value !== null && l.value < 0 ? "text-red-700" : ""}`}>
                  {l.value === null ? "—" : money(l.value)}
                </Td>
                <Td mono className={`text-right ${l.pnl === null ? "" : l.pnl < 0 ? "text-red-700" : l.pnl > 0 ? "text-emerald-700" : ""}`}>
                  {l.pnl === null ? "—" : signedMoney(l.pnl)}
                </Td>
                <Td mono className="text-right">
                  {money(l.price)}
                </Td>
                <Td mono className="text-right">
                  {money(l.avgCost)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <dl className="mt-3 space-y-1 text-xs text-slate-500">
          {(["EXCHANGE", "SQUAD", "SHORT"] as const).map((lot) => (
            <div key={lot}>
              <dt className="inline font-semibold text-slate-700">{FUND_LOT_LABELS[lot]}:</dt> <dd className="inline">{FUND_LOT_HINTS[lot]}</dd>
            </div>
          ))}
          <div>
            <dt className="inline font-semibold text-slate-700">Profit and loss:</dt>{" "}
            <dd className="inline">long lots: value − what they cost; shorts: what the sale brought in − what covering costs now.</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Collateral and limits">
        <div className="space-y-4 text-sm">
          {closed ? (
            <Notice>
              <span data-testid="collateral-status">The market has closed: every short was covered at the closing price and no more orders are taken.</span>
            </Notice>
          ) : coll.blocked ? (
            <Notice tone="red">
              <span data-testid="collateral-status">
                Blocked: your cash ({money(coll.cash)}) is below your locked collateral ({money(coll.locked)}), short by {money(coll.deficit)}. New buys and shorts are
                refused until cash covers it; sells and covers are always allowed. Nothing is sold for you before the close.
              </span>
            </Notice>
          ) : (
            <Notice tone="green">
              <span data-testid="collateral-status">Your cash covers your collateral: new buys and shorts are allowed.</span>
            </Notice>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Fact label="Collateral locked" value={money(coll.locked)} testId="collateral-locked" />
            <Fact label="Required at current prices" value={money(coll.required)} testId="collateral-required" />
            <Fact label="Reserved by open orders" value={money(summary.reserved)} />
            <Fact label="Available cash" value={money(summary.available)} />
          </dl>
          <p className="text-xs text-slate-500">
            Collateral is 150% of each short&apos;s value (shares short × current price), locked out of your cash and recalculated at every price change.
          </p>
          <div>
            <div className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span className="font-medium text-slate-700">Short exposure</span>
              <span className="font-mono tabular-nums" data-testid="exposure-of-cap">
                {money(summary.shortExposureWithPending)} of {money(RULES.SHORT_EXPOSURE_LIMIT)}
              </span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"
              role="meter"
              aria-label="Short exposure of the $250,000 limit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}
            >
              <div className="h-full bg-slate-700" style={{ width: `${meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Open shorts {money(summary.shortExposure)}
              {summary.shortExposureWithPending > summary.shortExposure ? ` + pending shorts ${money(summary.shortExposureWithPending - summary.shortExposure)}` : ""}, at
              current prices.
            </p>
          </div>
          {limitCompanies.length > 0 ? (
            <Table head={["Company", "Long, with pending buys", "Short, with pending shorts"]} label="Limits per company">
              {limitCompanies.map((c) => {
                const p = companyPosition(fctx, c.id);
                return (
                  <tr key={c.id}>
                    <Td mono className="font-semibold">
                      {c.ticker}
                    </Td>
                    <Td mono className="text-right">
                      {count(p.exchangeQty + p.pending.BUY)} of {count(RULES.LONG_LIMIT)}
                    </Td>
                    <Td mono className="text-right">
                      {count(p.shortQty + p.pending.SHORT)} of {count(RULES.SHORT_LIMIT)}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
