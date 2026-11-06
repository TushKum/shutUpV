// Reads what the fairness view needs, as the signed-in fairness officer. Flags (and their rows in the audit log) are
// readable by the fairness officer only; everything else staff read through RLS. Lists that can be long are read in
// pages of 1,000 rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerRow } from "./ledger";
import { LEDGER_COLUMNS, fetchAll, loadStaff } from "./ledger-data";
import type { StaffRef } from "./ledger-corrections";
import type { FlagAuditRow, FlagRow, HoldingRow, OrderRow, ResultRow } from "./fairness";

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
  /** The company the team built and the one it rescues, with their scores (once revealed or sealed, as RLS shows them). */
  companies: { id: string; ticker: string | null; name: string | null; founder_team_id: string; rescuer_team_id: string | null }[];
  scores: { company_id: string; type: "PRD" | "SOLUTION"; status: string; final_score: number | null; penalty: number }[];
  result: ResultRow | null;
}

/** One team's companies and scores, holdings, orders across rounds, ledger rows and settled result. */
export async function loadDrillDown(sb: SupabaseClient, teamId: string): Promise<DrillDown> {
  const [holdings, orders, ledger, companies, result] = await Promise.all([
    sb
      .from("holdings")
      .select("company_id, qty, cost_cents")
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
      .from("companies")
      .select("id, ticker, name, founder_team_id, rescuer_team_id")
      .or(`founder_team_id.eq.${teamId},rescuer_team_id.eq.${teamId}`)
      .then((r) => must(r, "companies") as DrillDown["companies"]),
    sb
      .from("results")
      .select("r1_points, r2_points, r3_points, portfolio_cents, return_bp, total, rank, eligible")
      .eq("team_id", teamId)
      .maybeSingle<ResultRow>()
      .then((r) => must(r, "results")),
  ]);
  const scores = companies.length
    ? (must(
        await sb.from("scores").select("company_id, type, status, final_score, penalty").in("company_id", companies.map((c) => c.id)),
        "scores",
      ) as DrillDown["scores"])
    : [];
  return { holdings, orders, ledger, companies, scores, result };
}
