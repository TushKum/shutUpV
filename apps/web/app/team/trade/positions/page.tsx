import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadTradeData, traderContext } from "@/lib/team/trade-data";
import { cashSummary, companyPosition } from "@/lib/team/trade";
import { portfolioTotals, positionLines } from "@/lib/team/portfolio";
import { bp, clock, count, money, signedMoney } from "@/lib/format";
import { Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { LineChart } from "@/components/ui/line-chart";
import { loadPortfolioSeries } from "@/lib/team/portfolio-history-data";
import { TradingNotYet } from "../not-yet";

export const metadata: Metadata = { title: "Portfolio" };

// Portfolio: the team's value (cash + shares at market prices, or closing prices after the 04:30 close), its return on the
// $100,000 start and the Round 3 points that return would give; a chart of the value after every price step; and one
// line per company held with its average cost, price, value and profit or loss, and how many more shares it may buy.
// Every price change broadcasts, so the page re-reads itself after each clearing, the reveal and the close.
export default async function PortfolioPage() {
  const ctx = await loadTeamContext();
  const notYet = TradingNotYet({ phase: ctx.status.phase, title: "Portfolio" });
  if (notYet) return notYet;
  const [data, series] = await Promise.all([loadTradeData(ctx, { orders: "pending" }), loadPortfolioSeries(ctx.event.id, ctx.team.id)]);
  const closedAt = ctx.event.market_closed_at;
  const closed = closedAt !== null;
  const lines = positionLines(data.holdings, data.companies, closed);
  const totals = portfolioTotals(ctx.team.cash, lines);
  const tctx = traderContext(ctx, data);
  const cash = cashSummary(tctx);
  const priceWord = closed ? "closing" : "market";

  return (
    <div className="space-y-4">
      {closed ? (
        <Notice>
          The market closed at {clock(closedAt)}. Your Round 3 points come from this value at closing prices; appeals may still move a price before the results.
        </Notice>
      ) : null}

      <Panel title="Portfolio">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Portfolio value" value={<span data-testid="portfolio-value">{money(totals.value)}</span>} hint={`Cash + shares at ${priceWord} prices`} />
          <Stat
            label={`Return on ${money(totals.start)}`}
            value={<span data-testid="portfolio-return">{bp(totals.returnBp)}</span>}
            hint={<span data-testid="portfolio-gain">{signedMoney(totals.gain)}</span>}
          />
          <Stat
            label={closed ? "Round 3 points" : "Round 3 points if the market closed now"}
            value={<span data-testid="portfolio-points">{count(totals.points)}</span>}
            hint="50 + 2.5 × return %, between 0 and 100"
          />
          <Stat label="Cash" value={money(totals.cash)} hint={cash.reserved > 0 ? `${money(cash.available)} available after open buys` : undefined} />
          <Stat label="Shares" value={money(totals.sharesValue)} hint={`At ${priceWord} prices`} />
          <Stat label={closed ? "Profit and loss at closing prices" : "Unrealised profit and loss"} value={<span data-testid="portfolio-pnl">{signedMoney(totals.unrealised)}</span>} />
        </div>
        {totals.unpriced > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {count(totals.unpriced)} {totals.unpriced === 1 ? "line has" : "lines have"} no price yet and {totals.unpriced === 1 ? "is" : "are"} not counted.
          </p>
        ) : null}
        {series.length >= 2 ? (
          <div className="mt-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-700">Your portfolio&apos;s value after each step</h3>
            <LineChart points={series} label="Your portfolio's value by step" mainName="Portfolio value (cash + shares)" testId="portfolio-chart" />
          </div>
        ) : null}
      </Panel>

      <Panel title="Positions">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">
            No shares yet. Orders are placed under{" "}
            <Link href="/team/trade" className="underline">
              Orders
            </Link>{" "}
            while a round is open.
          </p>
        ) : (
          <Table head={["Company", "Shares", "Value", "Profit and loss", `Price (${priceWord})`, "Avg cost", "Room to buy"]} label="Positions">
            {lines.map((l) => {
              const p = companyPosition(tctx, l.companyId);
              return (
                <tr key={l.companyId} data-testid={`position-${l.ticker}`}>
                  <Td>
                    <Link href={`/team/market/${l.ticker}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                      {l.ticker}
                    </Link>
                    {l.name ? <span className="ml-1 text-xs text-slate-500">{l.name}</span> : null}
                  </Td>
                  <Td mono className="text-right">
                    {count(l.qty)}
                  </Td>
                  <Td mono className="text-right">
                    {l.value === null ? "—" : money(l.value)}
                  </Td>
                  <Td mono className={`text-right ${l.pnl === null ? "" : l.pnl < 0 ? "text-red-700" : l.pnl > 0 ? "text-emerald-700" : ""}`}>
                    {l.pnl === null ? "—" : signedMoney(l.pnl)}
                  </Td>
                  <Td mono className="text-right">
                    {l.price === null ? "—" : money(l.price)}
                  </Td>
                  <Td mono className="text-right">
                    {money(l.avgCost)}
                  </Td>
                  <Td mono className="text-right">
                    {closed ? "—" : count(p.room)}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Profit and loss is value − what the shares cost; a sale takes shares out at the average cost. A team may hold at most {count(RULES.HOLD_LIMIT)} shares of a
          company, counting its pending buys.
        </p>
      </Panel>
    </div>
  );
}
