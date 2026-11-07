// Reads the market as the signed-in team (RLS): companies and round prices (public to the event), revealed scores,
// crisis cards (from 23:45) and public submissions (PRDs from 23:30, crisis solutions from 02:15). A team can read its
// own submissions earlier, but the market keeps only what is public to everyone (publicTypes), so every team sees the
// same market.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhaseCode, SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { publicTypes, type ClearingRow, type ListedCompany, type PriceKind, type PriceRow } from "./market";
import type { ScoreRow } from "./round-data";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

export interface MarketCompany extends ListedCompany {
  founder_team_id: string;
  rescuer_team_id: string | null;
  post_crisis_price: number | null;
  crisis_card_id: string | null;
}

const COMPANY_COLUMNS = "id, name, ticker, start_price, market_price, score_price, post_crisis_price, closing_price, crisis_card_id, founder_team_id, rescuer_team_id";

export async function loadCompanies(sb: SupabaseClient, eventId: string): Promise<MarketCompany[]> {
  return must(await sb.from("companies").select(COMPANY_COLUMNS).eq("event_id", eventId).not("ticker", "is", null).order("ticker"), "the companies") as MarketCompany[];
}

export interface MarketList {
  companies: MarketCompany[];
  lastRound: { number: number; rows: ClearingRow[] } | null;
  /** Each company's market price after every step so far, for the trend lines. */
  trends: Record<string, number[]>;
}

/** Every company, the last cleared round's prices (every company gets a row each round) and the trend lines. */
export async function loadMarketList(eventId: string): Promise<MarketList> {
  const sb = await supabaseServer();
  const [companies, round, steps] = await Promise.all([
    loadCompanies(sb, eventId),
    sb
      .from("rounds")
      .select("id, number")
      .eq("event_id", eventId)
      .eq("status", "CLEARED")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; number: number }>()
      .then((r) => must(r, "the rounds")),
    fetchAll<{ company_id: string; market_after: number }>((from, to) =>
      sb.from("round_prices").select("company_id, market_after").eq("event_id", eventId).order("id").range(from, to),
    ),
  ]);
  const trends: Record<string, number[]> = {};
  for (const s of steps) (trends[s.company_id] ??= []).push(Number(s.market_after));
  if (!round) return { companies, lastRound: null, trends };
  const rows = must(await sb.from("round_prices").select("company_id, market_before, market_after").eq("round_id", round.id).eq("kind", "CLEARING"), "the round's prices") as ClearingRow[];
  return { companies, lastRound: { number: round.number, rows }, trends };
}

export interface PublicSubmission {
  company_id: string;
  type: SubmissionType;
  content: Record<string, unknown>;
  word_count: number;
}

export interface CrisisCardRow {
  id: string;
  number: number;
  category: string;
  title: string;
  body: string;
}

export interface CompanyView {
  company: MarketCompany;
  history: PriceRow[];
  submissions: Partial<Record<SubmissionType, PublicSubmission>>;
  scores: Partial<Record<SubmissionType, ScoreRow>>;
  crisis: CrisisCardRow | null;
  types: SubmissionType[];
}

const SCORE_COLUMNS = "company_id, type, final_score, median, penalty, missing, breakdown, rationale";

/** One company by ticker, with everything public about it; null when no company has that ticker. */
export async function loadCompanyView(eventId: string, ticker: string, phase: PhaseCode): Promise<CompanyView | null> {
  const sb = await supabaseServer();
  const company = must(await sb.from("companies").select(COMPANY_COLUMNS).eq("event_id", eventId).eq("ticker", ticker).maybeSingle<MarketCompany>(), "the company");
  if (!company) return null;
  const types = publicTypes(phase);
  const [history, rounds, subs, scores, crisis] = await Promise.all([
    fetchAll<Omit<PriceRow, "round_number"> & { round_id: string | null }>((from, to) =>
      sb
        .from("round_prices")
        .select("id, kind, round_id, market_before, market_after, score_before, score_after, buy_qty, sell_qty, net_qty, factor_bp, created_at")
        .eq("company_id", company.id)
        .order("id")
        .range(from, to),
    ),
    sb.from("rounds").select("id, number").eq("event_id", eventId).then((r) => must(r, "the rounds") as { id: string; number: number }[]),
    types.length
      ? sb
          .from("submissions")
          .select("company_id, type, content, word_count")
          .eq("company_id", company.id)
          .in("type", types)
          .then((r) => must(r, "the submissions") as PublicSubmission[])
      : Promise.resolve([]),
    sb.from("scores").select(SCORE_COLUMNS).eq("company_id", company.id).eq("status", "REVEALED").then((r) => must(r, "the scores") as (ScoreRow & { type: SubmissionType })[]),
    company.crisis_card_id
      ? sb.from("crisis_cards").select("id, number, category, title, body").eq("id", company.crisis_card_id).maybeSingle<CrisisCardRow>().then((r) => must(r, "the crisis card"))
      : Promise.resolve(null),
  ]);
  const numbers = new Map(rounds.map((r) => [r.id, r.number]));
  return {
    company,
    history: history.map(({ round_id, ...r }) => ({ ...r, kind: r.kind as PriceKind, round_number: round_id ? (numbers.get(round_id) ?? null) : null })),
    submissions: Object.fromEntries(subs.map((s) => [s.type, s])),
    scores: Object.fromEntries(scores.map((s) => [s.type, s])),
    crisis,
    types,
  };
}

/** Every company's public crisis solution (from 02:15), with its company and, once revealed (02:45), its score. */
export async function loadSolutions(eventId: string): Promise<{ companies: MarketCompany[]; submissions: Map<string, PublicSubmission>; scores: Map<string, number | null>; crises: Map<string, CrisisCardRow> }> {
  const sb = await supabaseServer();
  const [companies, subs, scores, crises] = await Promise.all([
    loadCompanies(sb, eventId),
    fetchAll<PublicSubmission>((from, to) => sb.from("submissions").select("company_id, type, content, word_count").eq("event_id", eventId).eq("type", "SOLUTION").order("id").range(from, to)),
    sb.from("scores").select("company_id, final_score").eq("event_id", eventId).eq("type", "SOLUTION").eq("status", "REVEALED").then((r) => must(r, "the scores") as { company_id: string; final_score: number | null }[]),
    sb.from("crisis_cards").select("id, number, category, title, body").eq("event_id", eventId).then((r) => must(r, "the crisis cards") as CrisisCardRow[]),
  ]);
  return {
    companies,
    submissions: new Map(subs.map((s) => [s.company_id, s])),
    scores: new Map(scores.map((s) => [s.company_id, s.final_score])),
    crises: new Map(crises.map((c) => [c.id, c])),
  };
}
