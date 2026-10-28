// Reads the market as the signed-in team: companies (readable by every team from Reading), round prices, released
// scores, crisis cards (from the crisis) and public submissions. RLS also lets a squad read its own submissions
// before they are public; the market keeps only what is public to everyone (publicTypes), so every team sees the same
// market.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhaseCode, SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { publicTypes, type BookKind, type ClearingRow, type ListedCompany, type PriceKind, type PriceRow, type Released, type ScoreRow } from "./market";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

export interface MarketCompany extends ListedCompany {
  ai_price: number | null;
  post_crisis_price: number | null;
  closing_price: number | null;
  crisis_card_id: string | null;
}

const COMPANY_COLUMNS = "id, name, ticker, ipo_price, market_price, ai_price, post_crisis_price, closing_price, crisis_card_id";

/** Which score types are released (any company's released score means the type's release has happened). */
export async function loadReleased(sb: SupabaseClient, eventId: string): Promise<Released> {
  const rows = must(await sb.from("scores").select("type").eq("event_id", eventId), "the scores") as { type: SubmissionType }[];
  const out: Released = { PITCH: false, PLAN: false, FLASH: false };
  for (const r of rows) out[r.type] = true;
  return out;
}

export async function loadCompanies(sb: SupabaseClient, eventId: string): Promise<MarketCompany[]> {
  const rows = must(await sb.from("companies").select(COMPANY_COLUMNS).eq("event_id", eventId).not("ticker", "is", null).order("ticker"), "the companies");
  return rows as MarketCompany[];
}

export interface MarketList {
  companies: MarketCompany[];
  lastRound: { number: number; rows: ClearingRow[] } | null;
  /** Each company's market price after every step so far (IPO, rounds, crisis, tiers, close), for the trend lines. */
  trends: Record<string, number[]>;
}

/** Every listed company and the last cleared round's prices (every company gets a row each round, traded or not). */
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
  const rows = must(
    await sb.from("round_prices").select("company_id, market_before, market_after").eq("round_id", round.id).eq("kind", "CLEARING"),
    "the round's prices",
  ) as ClearingRow[];
  return { companies, lastRound: { number: round.number, rows }, trends };
}

export interface PublicSubmission {
  company_id: string;
  type: SubmissionType;
  content: Record<string, unknown>;
  word_count: number;
  submitted_at: string;
}

export interface CrisisCardRow {
  id: string;
  category: string;
  title: string;
  body: string;
}

export interface CompanyView {
  company: MarketCompany;
  history: PriceRow[];
  submissions: Partial<Record<SubmissionType, PublicSubmission>>;
  scores: ScoreRow[];
  crisis: CrisisCardRow | null;
  released: Released;
  types: SubmissionType[];
}

const SCORE_COLUMNS = "company_id, type, final_score, median, tier_bp, capped, late, missing, penalty, breakdown, rationale";

/** One company by ticker, with everything public about it; null when no listed company has that ticker. */
export async function loadCompanyView(eventId: string, ticker: string, phase: PhaseCode): Promise<CompanyView | null> {
  const sb = await supabaseServer();
  const [company, released] = await Promise.all([
    sb.from("companies").select(COMPANY_COLUMNS).eq("event_id", eventId).eq("ticker", ticker).maybeSingle<MarketCompany>().then((r) => must(r, "the company")),
    loadReleased(sb, eventId),
  ]);
  if (!company) return null;
  const types = publicTypes(phase, released);
  const [history, rounds, subs, scores, crisis] = await Promise.all([
    fetchAll<Omit<PriceRow, "round_number"> & { round_id: string | null }>((from, to) =>
      sb
        .from("round_prices")
        .select("id, kind, round_id, market_before, market_after, ai_before, ai_after, buy_qty, sell_qty, short_qty, cover_qty, net_qty, tier_bp, created_at")
        .eq("company_id", company.id)
        .order("id")
        .range(from, to),
    ),
    sb.from("rounds").select("id, number").eq("event_id", eventId).then((r) => must(r, "the rounds") as { id: string; number: number }[]),
    types.length
      ? sb
          .from("submissions")
          .select("company_id, type, content, word_count, submitted_at")
          .eq("company_id", company.id)
          .is("superseded_at", null)
          .in("type", types)
          .then((r) => must(r, "the submissions") as PublicSubmission[])
      : Promise.resolve([]),
    sb.from("scores").select(SCORE_COLUMNS).eq("company_id", company.id).then((r) => must(r, "the scores") as ScoreRow[]),
    company.crisis_card_id
      ? sb.from("crisis_cards").select("id, category, title, body").eq("id", company.crisis_card_id).maybeSingle<CrisisCardRow>().then((r) => must(r, "the crisis card"))
      : Promise.resolve(null),
  ]);
  const order: SubmissionType[] = ["PITCH", "PLAN", "FLASH"];
  const numbers = new Map(rounds.map((r) => [r.id, r.number]));
  return {
    company,
    history: history.map(({ round_id, ...r }) => ({ ...r, kind: r.kind as PriceKind, round_number: round_id ? (numbers.get(round_id) ?? null) : null })),
    submissions: Object.fromEntries(subs.map((s) => [s.type, s])),
    scores: scores.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)),
    crisis,
    released,
    types,
  };
}

export interface BookView {
  companies: MarketCompany[];
  submissions: Map<string, PublicSubmission>;
  scores: Map<string, ScoreRow>;
  crises: Map<string, CrisisCardRow>;
}

/**
 * Every company's public submission of one type (the pitch book, the plans, the flash answers) with its released
 * score, or every company's crisis card. The page checks that the book is public (openBooks) before reading it.
 */
export async function loadBook(eventId: string, kind: BookKind): Promise<BookView> {
  const sb = await supabaseServer();
  const type = kind === "CRISIS" ? null : kind;
  const [companies, subs, scores, crises] = await Promise.all([
    loadCompanies(sb, eventId),
    type
      ? fetchAll<PublicSubmission>((from, to) =>
          sb
            .from("submissions")
            .select("company_id, type, content, word_count, submitted_at")
            .eq("event_id", eventId)
            .eq("type", type)
            .is("superseded_at", null)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]),
    type ? sb.from("scores").select(SCORE_COLUMNS).eq("event_id", eventId).eq("type", type).then((r) => must(r, "the scores") as ScoreRow[]) : Promise.resolve([]),
    kind === "PLAN" || kind === "CRISIS"
      ? sb.from("crisis_cards").select("id, category, title, body").eq("event_id", eventId).then((r) => must(r, "the crisis cards") as CrisisCardRow[])
      : Promise.resolve([]),
  ]);
  return {
    companies,
    submissions: new Map(subs.map((s) => [s.company_id, s])),
    scores: new Map(scores.map((s) => [s.company_id, s])),
    crises: new Map(crises.map((c) => [c.id, c])),
  };
}
