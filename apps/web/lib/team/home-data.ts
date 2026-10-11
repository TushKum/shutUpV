// Reads what Home needs, as the signed-in team (RLS decides what it can see: its own team, holdings, calls and IPO
// bids; its squad's fee, deal and submissions; the event's schedule and published bulletins; companies from Reading,
// or its own squad's company before). Every query runs at once.

import type { SupabaseClient } from "@supabase/supabase-js";
import { phaseReached, type DeadlineCode, type LotType, type PhaseCode, type SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { cents } from "@/lib/format";
import type { HomeFacts, HomeProgress, HoldingRow, PricedCompany } from "./home";
import { unanswered } from "./qa";

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

export async function loadHomeData(ctx: TeamContext): Promise<HomeData> {
  const { team, event, status, squad, company } = ctx;
  const sb: SupabaseClient = await supabaseServer();
  const reading = phaseReached(status.phase, "READING");

  const [deadlines, phases, extra, scores, flash, bulletins, holdings, submissions, fee, deal, calls, bids] = await Promise.all([
    sb.from("deadlines").select("code, at").eq("event_id", event.id).then((r) => must(r, "the deadlines") as { code: DeadlineCode; at: string }[]),
    sb.from("phases").select("code, starts_at").eq("event_id", event.id).then((r) => must(r, "the schedule") as { code: PhaseCode; starts_at: string }[]),
    sb
      .from("events")
      .select("ipo_allocated_at, market_closed_at")
      .eq("id", event.id)
      .single<{ ipo_allocated_at: string | null; market_closed_at: string | null }>()
      .then((r) => must(r, "the event")),
    // Only released scores are readable; one row per company and type, at most 150.
    sb.from("scores").select("type").eq("event_id", event.id).then((r) => must(r, "the scores") as { type: SubmissionType }[]),
    sb.from("bulletins").select("id").eq("event_id", event.id).eq("kind", "FLASH").not("published_at", "is", null).limit(1).then((r) => must(r, "the bulletins") as { id: string }[]),
    sb
      .from("bulletins")
      .select("id, kind, title, body, published_at")
      .eq("event_id", event.id)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(3)
      .then((r) => must(r, "the bulletins") as HomeBulletin[]),
    sb.from("holdings").select("company_id, lot, qty").eq("team_id", team.id).then((r) => must(r, "your holdings") as HoldingRow[]),
    squad
      ? sb.from("submissions").select("type").eq("squad_id", squad.id).is("superseded_at", null).then((r) => must(r, "your submissions") as { type: SubmissionType }[])
      : Promise.resolve([]),
    squad
      ? sb
          .from("fees")
          .select("value_cents, updated_by_team, product_confirmed_at, consulting_confirmed_at, executed_at, is_default")
          .eq("squad_id", squad.id)
          .maybeSingle<{
            value_cents: number | string;
            updated_by_team: string | null;
            product_confirmed_at: string | null;
            consulting_confirmed_at: string | null;
            executed_at: string | null;
            is_default: boolean;
          }>()
          .then((r) => must(r, "your fee"))
      : Promise.resolve(null),
    squad
      ? sb
          .from("deals")
          .select("amount_cents, price_cents, signed_product_at, signed_consulting_at, signed_finance_at, executed_at")
          .eq("squad_id", squad.id)
          .maybeSingle<{
            amount_cents: number | string | null;
            price_cents: number | null;
            signed_product_at: string | null;
            signed_consulting_at: string | null;
            signed_finance_at: string | null;
            executed_at: string | null;
          }>()
          .then((r) => must(r, "your deal"))
      : Promise.resolve(null),
    team.track === "CONSULTING"
      ? sb.from("calls").select("call_no, direction").eq("consultant_team_id", team.id).then((r) => must(r, "your calls") as { call_no: 1 | 2 | 3; direction: string | null }[])
      : Promise.resolve([]),
    team.track === "FINANCE"
      ? sb.from("ipo_bids").select("id").eq("team_id", team.id).gt("qty_requested", 0).then((r) => must(r, "your IPO bids") as { id: string }[])
      : Promise.resolve([]),
  ]);

  // Product: the questions to its company that have no answer yet (the board is public from Reading).
  let waiting = 0;
  if (team.track === "PRODUCT" && company && reading) {
    const [qs, as] = await Promise.all([
      fetchAll<{ id: string; company_id: string; body: string; created_at: string }>((from, to) =>
        sb.from("qa_questions").select("id, company_id, body, created_at").eq("company_id", company.id).order("created_at").order("id").range(from, to),
      ),
      fetchAll<{ question_id: string }>((from, to) => sb.from("qa_answers").select("question_id").eq("company_id", company.id).order("id").range(from, to)),
    ]);
    waiting = unanswered(qs, as).length;
  }

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

  const callSlots = (n: 1 | 2 | 3) => {
    const slots = calls.filter((c) => c.call_no === n);
    return { made: slots.filter((c) => c.direction !== null).length, total: slots.length };
  };
  const released = { ...NONE };
  for (const s of scores) released[s.type] = true;
  const submitted = { ...NONE };
  for (const s of submissions) submitted[s.type] = true;

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
    ipoBids: bids.length,
    unanswered: waiting,
  };

  const facts: HomeFacts = {
    track: team.track,
    phase: status.phase,
    paused: status.paused,
    pausedAt: status.paused_at,
    nowMs: new Date(status.server_time).getTime(),
    drawn: status.drawn,
    crisisApplied: event.crisis_applied_at !== null,
    ipoAllocated: extra.ipo_allocated_at !== null,
    marketClosed: extra.market_closed_at !== null,
    flashBulletinPublished: flash.length > 0,
    released,
    deadlines,
    phaseStarts: Object.fromEntries(phases.map((p) => [p.code, p.starts_at])),
    openRound: status.open_round,
    nextRound: status.next_round,
    progress,
  };
  return { facts, holdings: holdings.map((h) => ({ ...h, lot: h.lot as LotType })), companies: priced, bulletins };
}
