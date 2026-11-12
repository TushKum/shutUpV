// Reads "your crises so far" as the signed-in team, through RLS: a company's own crisis cards, its released plan
// scores and the price moves they gave, and its engagements; a firm's engagements. A failure gives no report rather
// than a broken Home.

import { subroundOf, type SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { companyReport, firmReport, type CompanyReportRow, type FirmReportRow, type ReportEngagement } from "./report";

export type CrisisReport = { kind: "company"; rows: CompanyReportRow[] } | { kind: "firm"; rows: FirmReportRow[] };

const PLAN_TYPES: SubmissionType[] = ["CRISIS_1", "CRISIS_2", "CRISIS_3", "CRISIS_4", "SOLUTION"];
const ENG = "k, cash_cents, shares, escrow, rating, bonus_cents";
const num = (e: ReportEngagement): ReportEngagement => ({ ...e, cash_cents: Number(e.cash_cents), bonus_cents: e.bonus_cents === null ? null : Number(e.bonus_cents) });

export async function loadCrisisReport(ctx: TeamContext, current: number | null, statementTitle: string | null): Promise<CrisisReport | null> {
  try {
    const sb = await supabaseServer();
    if (ctx.team.track === "CONSULTING") {
      const { data, error } = await sb.from("engagements").select(ENG).eq("firm_team_id", ctx.team.id);
      if (error) throw new Error(error.message);
      return { kind: "firm", rows: firmReport(current, ((data ?? []) as ReportEngagement[]).map(num)) };
    }
    if (ctx.team.track !== "PRODUCT" || !ctx.company) return null;
    const id = ctx.company.id;
    const [cards, scores, moves, engs] = await Promise.all([
      sb.from("subround_crises").select("k, crisis_cards(title)").eq("company_id", id),
      sb.from("scores").select("type, final_score, tier_bp").eq("company_id", id).in("type", PLAN_TYPES),
      sb.from("round_prices").select("subround, tier_bp").eq("company_id", id).eq("kind", "SUB_TIER"),
      sb.from("engagements").select(ENG).eq("company_id", id),
    ]);
    for (const r of [cards, scores, moves, engs]) if (r.error) throw new Error(r.error.message);
    const title = (c: unknown) => (Array.isArray(c) ? (c[0] as { title?: string } | undefined)?.title : (c as { title?: string } | null)?.title) ?? "";
    return {
      kind: "company",
      rows: companyReport(
        current,
        ((cards.data ?? []) as { k: number; crisis_cards: unknown }[]).map((c) => ({ k: c.k, title: title(c.crisis_cards) })),
        ((scores.data ?? []) as { type: SubmissionType; final_score: number | null; tier_bp: number | null }[])
          .filter((s) => s.final_score !== null)
          .map((s) => ({ k: subroundOf(s.type) ?? 0, score: Number(s.final_score), tierBp: s.tier_bp })),
        ((moves.data ?? []) as { subround: number; tier_bp: number }[]).map((m) => ({ k: m.subround, tierBp: m.tier_bp })),
        ((engs.data ?? []) as ReportEngagement[]).map(num),
        statementTitle,
      ),
    };
  } catch (err) {
    console.error("crisis report: could not read it:", err);
    return null;
  }
}
