// Reads the rescue as the signed-in team, through RLS: the event's deadlines and the crisis's start, the squad's fee
// and deal (private to the squad), its company's crisis card (public from the crisis) and crisis price move, and the
// balances this team may see of itself: the Product team its retained shares, the fund its available cash (cash
// less collateral and the reserves of its pending orders in the open round, as sign_deal counts it).

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEADLINE_CODES, type DeadlineCode } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { cents } from "@/lib/format";
import type { CrisisMove, DealRow, Deadlines, FeeRow, PauseState } from "./rescue";

export interface CrisisCardRow {
  id: string;
  category: string;
  title: string;
  body: string;
}

export interface RescueData {
  deadlines: Deadlines;
  crisisStartsAt: string | null;
  fee: FeeRow | null;
  deal: DealRow | null;
  crisisCard: CrisisCardRow | null;
  crisisMove: CrisisMove | null;
  /** The Product team's retained shares (null for the others, who cannot read them). */
  retained: number | null;
  /** The fund's available cash (null for the others). */
  fundAvailable: number | null;
}

export function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

export async function loadDeadlines(sb: SupabaseClient, eventId: string): Promise<Deadlines> {
  const rows = must(await sb.from("deadlines").select("code, at").eq("event_id", eventId), "the deadlines") as { code: DeadlineCode; at: string }[];
  return Object.fromEntries(rows.filter((d) => DEADLINE_CODES.includes(d.code)).map((d) => [d.code, d.at]));
}

const FEE_COLUMNS = "cash_cents, shares, value_cents, version, product_confirmed_at, consulting_confirmed_at, executed_at, is_default, updated_at, updated_by_team";
const DEAL_COLUMNS =
  "amount_cents, price_cents, shares, cash_moved_cents, version, signed_product_at, signed_consulting_at, signed_finance_at, executed_at, updated_at, updated_by_team";

export async function loadFee(sb: SupabaseClient, squadId: string): Promise<FeeRow | null> {
  return must(await sb.from("fees").select(FEE_COLUMNS).eq("squad_id", squadId).maybeSingle<FeeRow>(), "your squad's fee");
}

export async function loadDeal(sb: SupabaseClient, squadId: string): Promise<DealRow | null> {
  return must(await sb.from("deals").select(DEAL_COLUMNS).eq("squad_id", squadId).maybeSingle<DealRow>(), "your squad's deal");
}

export async function loadRescue(ctx: TeamContext): Promise<RescueData> {
  const sb = await supabaseServer();
  const { event, team, squad, company } = ctx;
  const squadId = squad!.id;
  const [deadlines, crisisPhase, fee, deal, card, move, retained, fund] = await Promise.all([
    loadDeadlines(sb, event.id),
    sb
      .from("phases")
      .select("starts_at")
      .eq("event_id", event.id)
      .eq("code", "CRISIS")
      .maybeSingle<{ starts_at: string }>()
      .then((r) => must(r, "the schedule")),
    loadFee(sb, squadId),
    loadDeal(sb, squadId),
    company?.id
      ? sb
          .from("companies")
          .select("crisis_card_id")
          .eq("id", company.id)
          .maybeSingle<{ crisis_card_id: string | null }>()
          .then(async (r) => {
            const id = must(r, "your company")?.crisis_card_id;
            if (!id) return null;
            return must(await sb.from("crisis_cards").select("id, category, title, body").eq("id", id).maybeSingle<CrisisCardRow>(), "the crisis card");
          })
      : Promise.resolve(null),
    company?.id
      ? sb
          .from("round_prices")
          .select("market_before, market_after, ai_before, ai_after")
          .eq("company_id", company.id)
          .eq("kind", "CRISIS")
          .maybeSingle<CrisisMove>()
          .then((r) => must(r, "the crisis prices"))
      : Promise.resolve(null),
    team.track === "PRODUCT" && company?.id
      ? sb
          .from("holdings")
          .select("qty")
          .eq("team_id", team.id)
          .eq("company_id", company.id)
          .eq("lot", "RETAINED")
          .maybeSingle<{ qty: number }>()
          .then((r) => must(r, "your retained shares")?.qty ?? 0)
      : Promise.resolve(null),
    team.track === "FINANCE" ? fundAvailable(sb, ctx) : Promise.resolve(null),
  ]);
  return { deadlines, crisisStartsAt: crisisPhase?.starts_at ?? null, fee, deal, crisisCard: card, crisisMove: move, retained, fundAvailable: fund };
}

/** Cash less collateral less the reserves of pending orders in the open round (sign_deal's FUND_CASH check). */
async function fundAvailable(sb: SupabaseClient, ctx: TeamContext): Promise<number> {
  const open = must(await sb.from("rounds").select("id").eq("event_id", ctx.event.id).eq("status", "OPEN"), "the rounds") as { id: string }[];
  let reserved = 0;
  if (open.length > 0) {
    const orders = must(
      await sb
        .from("orders")
        .select("reserve_cents")
        .eq("team_id", ctx.team.id)
        .eq("status", "PENDING")
        .in(
          "round_id",
          open.map((r) => r.id),
        ),
      "your pending orders",
    ) as { reserve_cents: number | string }[];
    for (const o of orders) reserved += cents(o.reserve_cents);
  }
  return ctx.team.cash - ctx.team.collateral - reserved;
}

export function pauseOf(ctx: TeamContext): PauseState {
  return { paused: ctx.status.paused, pausedAt: ctx.status.paused_at };
}
