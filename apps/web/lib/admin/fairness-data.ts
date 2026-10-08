// Reads what the fairness view needs, as the signed-in fairness officer. Flags (and their rows in the audit log) are
// readable by the fairness officer only; everything else staff read through RLS. Lists that can be long are read in
// pages of 1,000 rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerRow } from "./ledger";
import { LEDGER_COLUMNS, fetchAll, loadStaff } from "./ledger-data";
import type { StaffRef } from "./ledger-corrections";
import type { CallRow, FlagAuditRow, FlagRow, HoldingRow, OrderRow, ResultRow } from "./fairness";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export async function loadFlags(sb: SupabaseClient, eventId: string): Promise<{ flags: FlagRow[]; audit: FlagAuditRow[]; staff: StaffRef[] }> {
  const [flags, audit, staff] = await Promise.all([
    fetchAll<FlagRow>((from, to) =>
      sb
        .from("flags")
        .select("id, kind, company_id, team_ids, details, status, decided_by, decided_at, reason, created_at")
        .eq("event_id", eventId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll<FlagAuditRow>((from, to) =>
      sb
        .from("audit_log")
        .select("id, at, actor_user_id, action, entity_id, before, after")
        .eq("event_id", eventId)
        .eq("entity", "flags")
        .eq("action", "update")
        .order("id", { ascending: false })
        .range(from, to),
    ),
    loadStaff(sb),
  ]);
  return { flags, audit, staff };
}

export interface DrillDown {
  holdings: HoldingRow[];
  orders: OrderRow[];
  ledger: LedgerRow[];
  calls: CallRow[];
  result: ResultRow | null;
}

/** One team's holdings, orders across rounds, ledger rows, consultant calls and settled result. */
export async function loadDrillDown(sb: SupabaseClient, teamId: string): Promise<DrillDown> {
  const [holdings, orders, ledger, calls, result] = await Promise.all([
    sb
      .from("holdings")
      .select("company_id, lot, qty, cost_cents")
      .eq("team_id", teamId)
      .then((r) => must(r, "holdings") as HoldingRow[]),
    fetchAll<OrderRow>((from, to) =>
      sb
        .from("orders")
        .select("id, round_id, company_id, type, qty, status, entry_price, fill_price, created_at")
        .eq("team_id", teamId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll<LedgerRow>((from, to) =>
      sb.from("ledger_entries").select(LEDGER_COLUMNS).eq("team_id", teamId).order("id", { ascending: false }).range(from, to),
    ),
    sb
      .from("calls")
      .select("company_id, call_no, direction, made_at, baseline_price, judged_price, correct, earnings_cents")
      .eq("consultant_team_id", teamId)
      .then((r) => must(r, "calls") as CallRow[]),
    sb
      .from("results")
      .select("track, final_value_cents, start_value_cents, return_bp, rank, eligible")
      .eq("team_id", teamId)
      .maybeSingle<ResultRow>()
      .then((r) => must(r, "results")),
  ]);
  return { holdings, orders, ledger, calls, result };
}
