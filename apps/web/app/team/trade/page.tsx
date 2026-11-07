import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadTradeData, traderContext } from "@/lib/team/trade-data";
import { cashSummary, notTradable, openOrders, openOrdersState, tradingNotice, type TradingNotice } from "@/lib/team/trade";
import { clock, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice, Panel } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { OrderTicket, type TicketCompany } from "./ticket";
import { OpenOrders } from "./open-orders";
import { cancelOrder, editOrder, placeOrder } from "./actions";
import { TradingNotYet } from "./not-yet";

export const metadata: Metadata = { title: "Round 3: Trade" };

// Orders: the team's cash, the order ticket while a round is open (or why trading is closed and when the next round
// opens), and the open round's orders with their countdown. Clearings, phase changes and pauses broadcast, so the page
// re-reads itself then and after each of its own actions; also when the round's closing time or the next round's
// opening time passes, and every 10 s while a round accepts orders (an order placed on another screen of the team sends
// no broadcast).
export default async function TradePage() {
  const ctx = await loadTeamContext();
  const { status, event, built, rescued } = ctx;

  if (!phaseReached(status.phase, "MARKET_BLIND")) return <TradingNotYet phase={status.phase} title="Round 3: Trade" />;

  const data = await loadTradeData(ctx, { orders: "pending" });
  const tctx = traderContext(ctx, data);
  const nowMs = new Date(status.server_time).getTime();
  const notice = tradingNotice({ phase: status.phase, trading: status.trading, paused: status.paused, marketClosed: event.market_closed_at !== null, nowMs, gate: status.gate }, data.rounds);
  const cash = cashSummary(tctx);
  const open = openOrders(data.orders, data.rounds, data.companies);
  const accepting = status.trading === "OPEN" && status.open_round !== null && !status.paused;
  const ordersRound = open.length > 0 ? (data.rounds.find((r) => r.number === open[0]!.roundNumber) ?? null) : null;
  const shownRound = status.open_round ?? (ordersRound ? { number: ordersRound.number, closes_at: ordersRound.closes_at } : null);
  const ordersState = shownRound ? openOrdersState({ accepting, paused: status.paused, closesAt: shownRound.closes_at, nowMs }) : null;
  const companies: TicketCompany[] = data.companies
    .filter((c) => c.market_price !== null)
    .map((c) => ({ id: c.id, ticker: c.ticker!, name: c.name, price: c.market_price!, blocked: notTradable(tctx, c.id) }));

  return (
    <div className="space-y-4">
      <RefreshAt at={accepting ? status.open_round!.closes_at : (notice?.next?.opensAt ?? null)} />
      <AutoRefresh everyMs={10_000} active={accepting} />

      {notice ? <ClosedNotice notice={notice} nowMs={nowMs} /> : null}

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
            <OrderTicket ctx={tctx} companies={companies} round={{ number: status.open_round!.number, closesAt: status.open_round!.closes_at }} action={placeOrder} />
            <p className="mt-3 text-xs text-slate-500">
              {built?.ticker ? `${built.ticker} (you built it)` : "The company you built"} and {rescued?.ticker ? `${rescued.ticker} (you rescued it)` : "the company you rescued"}{" "}
              cannot be traded by your team.
            </p>
          </Panel>
        ) : null}

        <div className="min-w-0 space-y-4 lg:col-span-2">
          {shownRound && (accepting || open.length > 0) ? (
            <Panel
              title={`Open orders · round ${shownRound.number}`}
              actions={
                ordersState === "EDITABLE" ? (
                  <span className="text-sm text-slate-600">
                    editable for <Countdown to={shownRound.closes_at} passed="—" className="font-semibold text-slate-900" />
                  </span>
                ) : ordersState === "PAUSED" ? (
                  <span className="text-sm text-amber-800" data-testid="open-orders-state">
                    paused: no changes until the event resumes
                  </span>
                ) : (
                  <span className="text-sm text-amber-800" data-testid="open-orders-state">
                    closed at {clock(shownRound.closes_at, true)}: clearing
                  </span>
                )
              }
            >
              {open.length === 0 ? (
                <p className="text-sm text-slate-500">No open orders in round {shownRound.number}.</p>
              ) : (
                <OpenOrders
                  ctx={tctx}
                  closesAt={shownRound.closes_at}
                  accepting={accepting}
                  items={open.map((line) => ({ line, edit: editOrder.bind(null, line.id), cancel: cancelOrder.bind(null, line.id) }))}
                />
              )}
              <p className="mt-3 text-xs text-slate-500">
                Every valid order fills at its company&apos;s new price when the round clears: price × (1 + net shares ÷ 1,000 %), at most ±10%. Past rounds are
                under{" "}
                <Link href="/team/trade/history" className="underline">
                  History
                </Link>
                .
              </p>
            </Panel>
          ) : null}

          <Panel title="Cash">
            <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
              <Fact label="Cash" value={money(cash.cash)} />
              <Fact label="Reserved by open buys" value={money(cash.reserved)} testId="reserved" />
              <Fact label="Available" value={money(cash.available)} hint="cash − reserves" testId="available" />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              A buy reserves quantity × price × 1.10 until the round clears. Holdings and profit and loss are under{" "}
              <Link href="/team/trade/positions" className="underline">
                Portfolio
              </Link>
              .
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ClosedNotice({ notice, nowMs }: { notice: TradingNotice; nowMs: number }) {
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
