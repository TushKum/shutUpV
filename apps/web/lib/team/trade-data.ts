// Reads what the trading screens need, as the signed-in team (RLS decides what it can see: its own team, holdings and
// orders; the event's rounds; every company with its market and closing prices). Every query runs at once.

import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { buildOrderContext, type HoldingRow, type OrderRow, type RoundRow, type TradeCompanyRow } from "./trade";

export interface TradeData {
  /** Companies with a ticker, by ticker. */
  companies: TradeCompanyRow[];
  holdings: HoldingRow[];
  /** The team's orders: only the pending ones, or all of them (history). */
  orders: OrderRow[];
  rounds: RoundRow[];
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

const ORDER_COLUMNS = "id, round_id, company_id, type, qty, status, entry_price, reserve_cents, fill_price, created_at, filled_at, cancelled_at";

export async function loadTradeData(ctx: TeamContext, opts: { orders: "pending" | "all" }): Promise<TradeData> {
  const { team, event } = ctx;
  const sb = await supabaseServer();
  const [companies, holdings, orders, rounds] = await Promise.all([
    sb
      .from("companies")
      .select("id, ticker, name, market_price, closing_price")
      .eq("event_id", event.id)
      .not("ticker", "is", null)
      .order("ticker")
      .then((r) => must(r, "the companies") as TradeCompanyRow[]),
    sb.from("holdings").select("company_id, qty, cost_cents").eq("team_id", team.id).then((r) => must(r, "your holdings") as HoldingRow[]),
    opts.orders === "all"
      ? fetchAll<OrderRow>((from, to) => sb.from("orders").select(ORDER_COLUMNS).eq("team_id", team.id).order("created_at").order("id").range(from, to))
      : sb.from("orders").select(ORDER_COLUMNS).eq("team_id", team.id).eq("status", "PENDING").order("created_at").then((r) => must(r, "your orders") as OrderRow[]),
    sb.from("rounds").select("id, number, phase, status, opens_at, closes_at").eq("event_id", event.id).order("number").then((r) => must(r, "the rounds") as RoundRow[]),
  ]);
  return { companies, holdings, orders, rounds };
}

/** The engine's view of this team (trading state from event_status, as the database decides it). */
export function traderContext(ctx: TeamContext, data: TradeData) {
  return buildOrderContext({
    trading: ctx.status.trading,
    cash: ctx.team.cash,
    builtCompanyId: ctx.built?.id ?? null,
    rescuedCompanyId: ctx.rescued?.id ?? null,
    companies: data.companies,
    holdings: data.holdings,
    orders: data.orders,
    rounds: data.rounds,
  });
}
