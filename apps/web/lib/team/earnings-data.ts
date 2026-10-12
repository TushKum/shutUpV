// Reads what a Consulting team's earnings are made of, as the signed-in team, through RLS: the squad's fee and deal,
// its own fee shares (FEE lot), its squad company's prices and released plan score, its calls, and the bonuses
// settlement paid into its cash (its own ledger rows).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamContext } from "@/lib/team/context";
import { cents } from "@/lib/format";
import type { PlanScore } from "./earnings";
import type { CallsData } from "./calls-data";
import { loadCalls } from "./calls-data";
import { loadDeal, loadFee, must } from "./rescue-data";
import type { DealRow, FeeRow } from "./rescue";

export interface EarningsData {
  calls: CallsData;
  fee: FeeRow | null;
  deal: DealRow | null;
  feeShares: number;
  prices: { market: number | null; closing: number | null; postCrisis: number | null };
  plan: PlanScore | null;
  /** Bonus and call-earning rows settlement paid into this team's cash. */
  paid: { kind: string; cash_delta_cents: number }[];
}

export async function loadEarnings(sb: SupabaseClient, ctx: TeamContext): Promise<EarningsData> {
  const { team, squad, company } = ctx;
  const [calls, fee, deal, holding, plan, paid] = await Promise.all([
    loadCalls(sb, ctx),
    squad ? loadFee(sb, squad.id) : Promise.resolve(null),
    squad ? loadDeal(sb, squad.id) : Promise.resolve(null),
    company
      ? sb
          .from("holdings")
          .select("qty")
          .eq("team_id", team.id)
          .eq("company_id", company.id)
          .eq("lot", "FEE")
          .maybeSingle<{ qty: number }>()
          .then((r) => must(r, "your fee shares"))
      : Promise.resolve(null),
    // Readable only once released.
    company
      ? sb
          .from("scores")
          .select("final_score, capped, late, missing, penalty")
          .eq("company_id", company.id)
          .eq("type", "PLAN")
          .eq("status", "RELEASED")
          .maybeSingle<PlanScore>()
          .then((r) => must(r, "your squad's plan score"))
      : Promise.resolve(null),
    sb
      .from("ledger_entries")
      .select("kind, cash_delta_cents")
      .eq("team_id", team.id)
      .in("kind", ["BONUS_PLAN", "BONUS_DEAL", "CALL_EARNINGS"])
      .then((r) => (must(r, "your ledger") as { kind: string; cash_delta_cents: number | string }[]).map((x) => ({ kind: x.kind, cash_delta_cents: cents(x.cash_delta_cents) }))),
  ]);
  return {
    calls,
    fee,
    deal,
    feeShares: holding?.qty ?? 0,
    prices: { market: company?.market_price ?? null, closing: company?.closing_price ?? null, postCrisis: company?.post_crisis_price ?? null },
    plan: plan && plan.final_score !== null ? plan : null,
    paid,
  };
}
