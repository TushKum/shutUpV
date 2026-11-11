// Reads what the fund's trading screens need, as the signed-in team (RLS decides what it can see: its own team,
// holdings, orders and IPO bids; the event's rounds, deadlines and schedule; the companies from Reading, with their
// IPO, market and closing prices; the public ledger's IPO books). Every query runs at once.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhaseCode } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { buildOrderContext, type HoldingRow, type IpoBidRow, type OrderRow, type RoundRow, type TradeCompanyRow } from "./trade";

export interface IpoBookRow {
  company_id: string;
  details: { requested?: number; available?: number; bidders?: number } | null;
}

export interface TradeData {
  /** Listed companies (with a ticker), by ticker. */
  companies: TradeCompanyRow[];
  holdings: HoldingRow[];
  /** The fund's orders: only the pending ones, or all of them (history). */
  orders: OrderRow[];
  rounds: RoundRow[];
  bids: IpoBidRow[];
  ipoAllocatedAt: string | null;
  marketClosedAt: string | null;
  ipoDeadline: string | null;
  phaseStarts: Partial<Record<PhaseCode, string>>;
  /** Public IPO books (total requested per company), after the allocation. */
  ipoBooks: IpoBookRow[];
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

const ORDER_COLUMNS = "id, round_id, company_id, type, qty, status, entry_price, reserve_cents, fill_price, created_at, filled_at, cancelled_at";

export async function loadTradeData(ctx: TeamContext, opts: { orders: "pending" | "all"; ipo?: boolean }): Promise<TradeData> {
  const { team, event } = ctx;
  const sb: SupabaseClient = await supabaseServer();

  const [companies, holdings, orders, rounds, bids, ev, deadline, phases, books] = await Promise.all([
    sb
      .from("companies")
      .select("id, ticker, name, ipo_price, market_price, closing_price")
      .eq("event_id", event.id)
      .not("ticker", "is", null)
      .order("ticker")
      .then((r) => must(r, "the companies") as TradeCompanyRow[]),
    sb.from("holdings").select("company_id, lot, qty, cost_cents").eq("team_id", team.id).then((r) => must(r, "your holdings") as HoldingRow[]),
    opts.orders === "all"
      ? fetchAll<OrderRow>((from, to) => sb.from("orders").select(ORDER_COLUMNS).eq("team_id", team.id).order("created_at").order("id").range(from, to))
      : sb
          .from("orders")
          .select(ORDER_COLUMNS)
          .eq("team_id", team.id)
          .eq("status", "PENDING")
          .order("created_at")
          .then((r) => must(r, "your orders") as OrderRow[]),
    sb
      .from("rounds")
      .select("id, number, phase, status, opens_at, closes_at")
      .eq("event_id", event.id)
      .order("number")
      .then((r) => must(r, "the rounds") as RoundRow[]),
    sb
      .from("ipo_bids")
      .select("company_id, qty_requested, qty_allocated, price")
      .eq("team_id", team.id)
      .then((r) => must(r, "your IPO bids") as IpoBidRow[]),
    sb
      .from("events")
      .select("ipo_allocated_at, market_closed_at")
      .eq("id", event.id)
      .single<{ ipo_allocated_at: string | null; market_closed_at: string | null }>()
      .then((r) => must(r, "the event")),
    sb
      .from("deadlines")
      .select("at")
      .eq("event_id", event.id)
      .eq("code", "IPO_BIDS")
      .maybeSingle<{ at: string }>()
      .then((r) => must(r, "the IPO deadline")),
    sb
      .from("phases")
      .select("code, starts_at")
      .eq("event_id", event.id)
      .in("code", ["READING", "IPO", "ROUNDS_1_4", "CLOSE"])
      .then((r) => must(r, "the schedule") as { code: PhaseCode; starts_at: string }[]),
    opts.ipo
      ? sb
          .from("public_ledger")
          .select("company_id, details")
          .eq("event_id", event.id)
          .eq("kind", "IPO")
          .then((r) => must(r, "the IPO books") as IpoBookRow[])
      : Promise.resolve([] as IpoBookRow[]),
  ]);

  return {
    companies,
    holdings,
    orders,
    rounds,
    bids,
    ipoAllocatedAt: ev.ipo_allocated_at,
    marketClosedAt: ev.market_closed_at,
    ipoDeadline: deadline?.at ?? null,
    phaseStarts: Object.fromEntries(phases.map((p) => [p.code, p.starts_at])),
    ipoBooks: books,
  };
}

/** The engine's view of this fund (trading state from event_status, as the database decides it). */
export function fundContext(ctx: TeamContext, data: TradeData) {
  return buildOrderContext({
    trading: ctx.status.trading,
    team: { track: ctx.team.track, cash: ctx.team.cash, collateral: ctx.team.collateral },
    squadCompanyId: ctx.company?.id ?? null,
    companies: data.companies,
    holdings: data.holdings,
    orders: data.orders,
    rounds: data.rounds,
  });
}
