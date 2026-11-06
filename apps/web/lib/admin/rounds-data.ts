// Reads what the rounds view needs, as the signed-in staff member (staff read every table of the event through
// RLS). Large tables are read in pages of 1,000 rows.

import { supabaseServer } from "@/lib/supabase/server";
import {
  fetchAll,
  focusRound,
  type ClearingPriceRow,
  type CompanyRow,
  type HoldingRow,
  type PendingOrderRow,
  type RoundFocus,
  type RoundRow,
  type TeamRow,
} from "./rounds";

export interface RoundsData {
  rounds: RoundRow[];
  companies: CompanyRow[];
  teams: TeamRow[];
  focus: RoundFocus;
  /** The open round's pending orders (empty when no round is open). */
  orders: PendingOrderRow[];
  /** Every team's holdings (only read when a round is open). */
  holdings: HoldingRow[];
  clearings: ClearingPriceRow[];
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export async function loadRoundsData(eventId: string, nowMs: number): Promise<RoundsData> {
  const sb = await supabaseServer();
  const [rounds, companies, teams, clearings] = await Promise.all([
    sb
      .from("rounds")
      .select("id, number, phase, status, opens_at, closes_at, cleared_at")
      .eq("event_id", eventId)
      .order("number")
      .then((r) => must(r, "rounds") as RoundRow[]),
    sb
      .from("companies")
      .select("id, ticker, name, market_price")
      .eq("event_id", eventId)
      .order("ticker")
      .then((r) => must(r, "companies") as CompanyRow[]),
    sb
      .from("teams")
      .select("id, code, cash_cents")
      .eq("event_id", eventId)
      .order("code")
      .then((r) => must(r, "teams") as TeamRow[]),
    fetchAll<ClearingPriceRow>((from, to) =>
      sb
        .from("round_prices")
        .select("round_id, company_id, market_before, market_after, buy_qty, sell_qty, net_qty, capped_net")
        .eq("event_id", eventId)
        .eq("kind", "CLEARING")
        .order("id")
        .range(from, to),
    ),
  ]);

  const focus = focusRound(rounds, nowMs);
  const open = focus?.kind === "OPEN" ? focus.round : null;
  const holdings = open
    ? await fetchAll<HoldingRow>((from, to) =>
        sb.from("holdings").select("team_id, company_id, qty, cost_cents").eq("event_id", eventId).gt("qty", 0).order("id").range(from, to),
      )
    : [];
  // The pending orders last: if the round clears while this page is read, they come back filled (none pending)
  // rather than being applied a second time to books that already include them.
  const orders = open
    ? await fetchAll<PendingOrderRow>((from, to) =>
        sb
          .from("orders")
          .select("id, team_id, company_id, type, qty, reserve_cents, created_at")
          .eq("round_id", open.id)
          .eq("status", "PENDING")
          .order("created_at")
          .order("id")
          .range(from, to),
      )
    : [];

  return { rounds, companies, teams, focus, orders, holdings, clearings };
}
