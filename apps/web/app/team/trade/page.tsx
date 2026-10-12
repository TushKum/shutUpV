import type { Metadata } from "next";
import Link from "next/link";
import { RULES, phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { fundContext, loadTradeData } from "@/lib/team/trade-data";
import { fundSummary, openOrders, tradingNotice, type TradingNotice } from "@/lib/team/trade";
import { clock, money } from "@/lib/format";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice, Panel } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { tradeGate } from "./gate";
import { OrderTicket, type TicketCompany } from "./ticket";
import { OpenOrders } from "./open-orders";
import { cancelOrder, editOrder, placeOrder } from "./actions";

export const metadata: Metadata = { title: "Trade" };

// Orders: the fund's cash and limits, the order ticket while a round is open (or why trading is closed and when the
// next round opens), and the open round's orders with their countdown. Clearings, phase changes and pauses broadcast,
// so the page re-reads itself then; the fund's own orders change only by its own actions, which re-read it too. The
// page also re-reads itself when the round's closing time or the next round's opening time passes.
export default async function TradePage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const { status, company: own } = ctx;
  const data = await loadTradeData(ctx, { orders: "pending" });
  const at = (code: "READING" | "IPO" | "ROUNDS_1_4") => (data.phaseStarts[code] ? clock(data.phaseStarts[code]) : null);

  if (!phaseReached(status.phase, "READING")) {
    return (
      <Panel title="Trading">
        <p className="text-sm text-slate-700" data-testid="trading-notice">
          Trading starts with round 1{at("ROUNDS_1_4") ? ` at ${at("ROUNDS_1_4")}` : ""}. The companies are listed at Reading
          {at("READING") ? ` (${at("READING")})` : ""}, and IPO bids open with the IPO{at("IPO") ? ` at ${at("IPO")}` : ""}.
        </p>
      </Panel>
    );
  }

  const fctx = fundContext(ctx, data);
  const nowMs = new Date(status.server_time).getTime();
  const notice = tradingNotice(
    { phase: status.phase, trading: status.trading, paused: status.paused, marketClosed: data.marketClosedAt !== null, nowMs },
    data.rounds,
  );
  const summary = fundSummary(fctx);
  const open = openOrders(data.orders, data.rounds, data.companies);
  const accepting = status.trading === "OPEN" && status.open_round !== null && !status.paused;
  const ordersRound = open.length > 0 ? (data.rounds.find((r) => r.number === open[0]!.roundNumber) ?? null) : null;
  const shownRound = status.open_round ?? (ordersRound ? { number: ordersRound.number, closes_at: ordersRound.closes_at } : null);
  const tradable: TicketCompany[] = data.companies
    .filter((c) => c.market_price !== null && c.id !== own?.id)
    .map((c) => ({ id: c.id, ticker: c.ticker!, name: c.name, price: c.market_price! }));
  const ownTicker = own?.ticker ?? null;

  return (
    <div className="space-y-4">
      <RefreshAt at={accepting ? status.open_round!.closes_at : (notice?.next?.opensAt ?? null)} />

      {notice ? <ClosedNotice notice={notice} nowMs={nowMs} ipo={status.phase === "IPO"} /> : null}

      {summary.blocked ? (
        <Notice tone="red">
          <span data-testid="collateral-blocked">
            Your cash ({money(summary.cash)}) is below your locked collateral ({money(summary.collateral)}), short by {money(summary.deficit)}: new buys and shorts are
            blocked until cash covers it. Sells and covers are always allowed, and nothing is sold for you before the close.
          </span>
        </Notice>
      ) : null}

      <div className={accepting ? "grid gap-4 lg:grid-cols-5" : "space-y-4"}>
        {accepting ? (
          <Panel
            className="lg:col-span-3 lg:self-start"
            title={`Order ticket · round ${status.open_round!.number}`}
            actions={
              <span className="text-sm text-slate-600">
                closes in <Countdown to={status.open_round!.closes_at} passed="now" className="font-semibold text-slate-900" />
              </span>
            }
          >
            {tradable.length === 0 ? (
              <p className="text-sm text-slate-500">No company is trading.</p>
            ) : (
              <OrderTicket ctx={fctx} companies={tradable} round={{ number: status.open_round!.number, closesAt: status.open_round!.closes_at }} action={placeOrder} />
            )}
            {ownTicker ? (
              <p className="mt-3 text-xs text-slate-500">
                Your squad&apos;s company, {ownTicker}, is not listed: a fund never trades its own squad&apos;s company. Your squad lot is under{" "}
                <Link href="/team/trade/positions" className="underline">
                  Positions
                </Link>
                .
              </p>
            ) : null}
          </Panel>
        ) : null}

        <div className="min-w-0 space-y-4 lg:col-span-2">
          {shownRound && (accepting || open.length > 0) ? (
            <Panel
              title={`Open orders · round ${shownRound.number}`}
              actions={
                accepting ? (
                  <span className="text-sm text-slate-600">
                    editable for <Countdown to={shownRound.closes_at} passed="—" className="font-semibold text-slate-900" />
                  </span>
                ) : (
                  <span className="text-sm text-amber-800">closed at {clock(shownRound.closes_at, true)}: clearing</span>
                )
              }
            >
              {open.length === 0 ? (
                <p className="text-sm text-slate-500">No open orders in round {shownRound.number}.</p>
              ) : (
                <OpenOrders
                  ctx={fctx}
                  closesAt={shownRound.closes_at}
                  accepting={accepting}
                  items={open.map((line) => ({ line, edit: editOrder.bind(null, line.id), cancel: cancelOrder.bind(null, line.id) }))}
                />
              )}
              <p className="mt-3 text-xs text-slate-500">
                Every valid order fills at its company&apos;s new price when the round clears. Past rounds and their fill prices are under{" "}
                <Link href="/team/trade/history" className="underline">
                  History
                </Link>
                .
              </p>
            </Panel>
          ) : null}

          <Panel title="Cash and limits">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Fact label="Cash" value={money(summary.cash)} />
              <Fact label="Collateral locked" value={money(summary.collateral)} hint="150% of your shorts' value" />
              <Fact label="Reserved by open orders" value={money(summary.reserved)} testId="reserved" />
              <Fact label="Available cash" value={money(summary.available)} hint="Cash − collateral − reserves" testId="available" />
              <Fact
                label="Short exposure"
                value={money(summary.shortExposureWithPending)}
                hint={`of ${money(RULES.SHORT_EXPOSURE_LIMIT)}, pending shorts included`}
                testId="exposure"
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Holdings, profit and loss and the limits per company are under{" "}
              <Link href="/team/trade/positions" className="underline">
                Positions
              </Link>
              .
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ClosedNotice({ notice, nowMs, ipo }: { notice: TradingNotice; nowMs: number; ipo: boolean }) {
  const upcoming = notice.next && new Date(notice.next.opensAt).getTime() > nowMs ? notice.next : null;
  return (
    <Notice tone={notice.tone}>
      <span data-testid="trading-notice">
        {notice.text}
        {upcoming ? (
          <>
            {" "}
            Round {upcoming.number} opens at {clock(upcoming.opensAt)} (in <Countdown to={upcoming.opensAt} passed="a moment" />
            ).
          </>
        ) : null}
      </span>
      {ipo ? (
        <>
          {" "}
          <Link href="/team/trade/ipo" className="font-semibold underline">
            IPO bids
          </Link>
        </>
      ) : null}
    </Notice>
  );
}

function Fact({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono font-semibold tabular-nums text-slate-900" data-testid={testId}>
        {value}
      </dd>
      {hint ? <dd className="text-xs text-slate-500">{hint}</dd> : null}
    </div>
  );
}
