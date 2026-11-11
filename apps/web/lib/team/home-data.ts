// Reads what Home needs, as the signed-in team. The plan's facts come from one database call (team_plan_facts, which
// returns only what the team could read itself: its own calls and IPO bids; its squad's fee, deal and submissions;
// the event's schedule; released score types; the flash bulletin). Holdings, bulletins and prices are read through
// RLS (companies from Reading, or its own squad's company before). Every query runs at once.

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type DeadlineCode, type LotType, type PhaseCode, type SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { cents } from "@/lib/format";
import type { HomeFacts, HomeProgress, HoldingRow, PricedCompany } from "./home";

export interface HomeBulletin {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

export interface HomeData {
  facts: HomeFacts;
  holdings: HoldingRow[];
  companies: PricedCompany[];
  bulletins: HomeBulletin[];
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

const NONE: Record<SubmissionType, boolean> = { PITCH: false, PLAN: false, FLASH: false };

interface PlanFactsRow {
  deadlines: { code: DeadlineCode; at: string }[];
  phases: { code: PhaseCode; starts_at: string }[];
  ipo_allocated_at: string | null;
  market_closed_at: string | null;
  released: SubmissionType[];
  flash_published: boolean;
  submitted: SubmissionType[];
  fee: {
    value_cents: number | string;
    updated_by_team: string | null;
    product_confirmed_at: string | null;
    consulting_confirmed_at: string | null;
    executed_at: string | null;
    is_default: boolean;
  } | null;
  deal: {
    amount_cents: number | string | null;
    price_cents: number | null;
    signed_product_at: string | null;
    signed_consulting_at: string | null;
    signed_finance_at: string | null;
    executed_at: string | null;
  } | null;
  calls: { call_no: 1 | 2 | 3; direction: string | null }[];
  ipo_bids: number;
  unanswered: number;
}

/** Turns what team_plan_facts returned into the plan's facts. Pure. */
export function planFacts(ctx: Pick<TeamContext, "team" | "event" | "status" | "squad">, row: PlanFactsRow): HomeFacts {
  const { team, event, status, squad } = ctx;
  const { fee, deal } = row;
  const callSlots = (n: 1 | 2 | 3) => {
    const slots = row.calls.filter((c) => c.call_no === n);
    return { made: slots.filter((c) => c.direction !== null).length, total: slots.length };
  };
  const released = { ...NONE };
  for (const t of row.released) released[t] = true;
  const submitted = { ...NONE };
  for (const t of row.submitted) submitted[t] = true;

  const progress: HomeProgress = {
    problemPicked: !!squad?.chosen_card_id,
    submitted,
    fee: fee
      ? {
          proposed: fee.updated_by_team !== null || cents(fee.value_cents) > 0,
          productConfirmed: fee.product_confirmed_at !== null,
          consultingConfirmed: fee.consulting_confirmed_at !== null,
          executed: fee.executed_at !== null,
          isDefault: fee.is_default,
        }
      : null,
    deal: deal
      ? {
          amountSet: deal.amount_cents !== null,
          priceSet: deal.price_cents !== null,
          signed: { PRODUCT: deal.signed_product_at !== null, CONSULTING: deal.signed_consulting_at !== null, FINANCE: deal.signed_finance_at !== null },
          executed: deal.executed_at !== null,
        }
      : null,
    calls: { 1: callSlots(1), 2: callSlots(2), 3: callSlots(3) },
    ipoBids: Number(row.ipo_bids),
    unanswered: Number(row.unanswered),
  };

  return {
    track: team.track,
    phase: status.phase,
    paused: status.paused,
    pausedAt: status.paused_at,
    nowMs: new Date(status.server_time).getTime(),
    drawn: status.drawn,
    crisisApplied: event.crisis_applied_at !== null,
    ipoAllocated: row.ipo_allocated_at !== null,
    marketClosed: row.market_closed_at !== null,
    flashBulletinPublished: row.flash_published,
    released,
    deadlines: row.deadlines,
    phaseStarts: Object.fromEntries(row.phases.map((p) => [p.code, p.starts_at])),
    openRound: status.open_round,
    nextRound: status.next_round,
    progress,
  };
}

/**
 * Once per request: the facts the team's plan is made from (the layout's "Do this now" bar and alerts, and Home), in
 * one call (team_plan_facts) as every page reads them.
 */
export const loadPlanFacts = cache(async (ctx: TeamContext): Promise<HomeFacts> => {
  const sb: SupabaseClient = await supabaseServer();
  const { data, error } = await sb.rpc("team_plan_facts");
  if (error) throw new Error(`Could not read your plan: ${error.message}`);
  return planFacts(ctx, data as PlanFactsRow);
});

async function readHomeData(ctx: TeamContext): Promise<HomeData> {
  const { team, event, company } = ctx;
  const sb: SupabaseClient = await supabaseServer();
  const [facts, bulletins, holdings] = await Promise.all([
    loadPlanFacts(ctx),
    sb
      .from("bulletins")
      .select("id, kind, title, body, published_at")
      .eq("event_id", event.id)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(3)
      .then((r) => must(r, "the bulletins") as HomeBulletin[]),
    sb.from("holdings").select("company_id, lot, qty").eq("team_id", team.id).then((r) => must(r, "your holdings") as HoldingRow[]),
  ]);

  // The companies the team holds shares of: its own squad's (readable from the draw) and, from Reading, any other.
  const ids = [...new Set(holdings.filter((h) => h.qty !== 0).map((h) => h.company_id))];
  const others = ids.filter((id) => id !== company?.id);
  const priced: PricedCompany[] = company ? [{ id: company.id, ticker: company.ticker, name: company.name, market_price: company.market_price, closing_price: company.closing_price }] : [];
  if (others.length) {
    const rows = must(
      await sb.from("companies").select("id, ticker, name, market_price, closing_price").in("id", others),
      "the companies you hold",
    ) as PricedCompany[];
    priced.push(...rows);
  }
  return { facts, holdings: holdings.map((h) => ({ ...h, lot: h.lot as LotType })), companies: priced, bulletins };
}

/** Home: the plan's facts, the latest bulletins and the team's holdings, priced. */
export const loadHomeData = cache(readHomeData);
