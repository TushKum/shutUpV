// What each takeover reads, as the display account (RLS: the public set only, never a team's private rows). An
// organiser may open the big screen too, and RLS shows staff more (sealed scores), so every read here also filters to
// what is public. Team codes and names come only from the leaderboard function, which gives the final results only at
// AWARDS.

import { headers } from "next/headers";
import type { AwardCode, SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { lotteryRecordUrl } from "@/lib/display/takeovers";
import { awardLines, type AwardLine, type AwardRow } from "@/lib/awards";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data;
}

export interface CompanyRow {
  id: string;
  ticker: string;
  name: string | null;
  founder_team_id: string;
  rescuer_team_id: string | null;
  crisis_card_id: string | null;
  start_price: number | null;
  market_price: number | null;
  closing_price: number | null;
}

/** Every company with a ticker (companies are public to the event), by ticker. */
export async function loadCompanies(eventId: string): Promise<CompanyRow[]> {
  const sb = await supabaseServer();
  const r = await sb
    .from("companies")
    .select("id, ticker, name, founder_team_id, rescuer_team_id, crisis_card_id, start_price, market_price, closing_price")
    .eq("event_id", eventId)
    .not("ticker", "is", null)
    .order("ticker");
  return (must(r, "the companies") ?? []) as CompanyRow[];
}

/** Where anyone can download the public lottery record (absolute, from this request's host, when known). */
export async function lotteryRecordAddress(slug: string): Promise<string> {
  const h = await headers();
  return lotteryRecordUrl(slug, h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
}

export interface PriceMove {
  market_before: number | null;
  market_after: number;
  factor_bp: number | null;
}

/** One recorded move per company (the crisis and the reveal each happen once). */
export async function loadPriceMoves(eventId: string, kind: "CRISIS" | "REVEAL"): Promise<Map<string, PriceMove>> {
  const sb = await supabaseServer();
  const r = await sb.from("round_prices").select("company_id, market_before, market_after, factor_bp").eq("event_id", eventId).eq("kind", kind);
  const rows = (must(r, "the price moves") ?? []) as (PriceMove & { company_id: string })[];
  return new Map(rows.map((x) => [x.company_id, x]));
}

export interface CrisisCard {
  id: string;
  category: string;
  title: string;
}

/** The crisis deck (readable from the crisis). */
export async function loadCrisisCards(eventId: string): Promise<Map<string, CrisisCard>> {
  const sb = await supabaseServer();
  const r = await sb.from("crisis_cards").select("id, category, title").eq("event_id", eventId);
  const rows = (must(r, "the crisis cards") ?? []) as CrisisCard[];
  return new Map(rows.map((c) => [c.id, c]));
}

/** Revealed scores of one type, by company (staff are filtered the same way as the display). */
export async function loadRevealedScores(eventId: string, type: SubmissionType): Promise<Map<string, number>> {
  const sb = await supabaseServer();
  const r = await sb.from("scores").select("company_id, final_score").eq("event_id", eventId).eq("type", type).eq("status", "REVEALED");
  const rows = (must(r, "the scores") ?? []) as { company_id: string; final_score: number | null }[];
  return new Map(rows.flatMap((s) => (s.final_score === null ? [] : [[s.company_id, s.final_score] as const])));
}

export interface FinalRow {
  team_id: string;
  code: string;
  name: string | null;
  total: number;
  rank: number | null;
}

/** The final results and the awards (null before AWARDS: the leaderboard function gives final rows only then). */
export async function loadCeremony(eventId: string): Promise<{ rows: FinalRow[]; awards: (AwardLine & { names: string[] })[] } | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("leaderboard", { p_event: eventId });
  if (error) return null; // frozen, or not yet
  const board = data as { final?: boolean; rows?: FinalRow[] };
  if (!board.final) return null;
  const rows = board.rows ?? [];
  const [awards, companies] = await Promise.all([
    sb.from("awards").select("code, team_id, company_id, metric").eq("event_id", eventId),
    sb.from("companies").select("id, ticker").eq("event_id", eventId),
  ]);
  const list = (must(awards, "the awards") ?? []) as AwardRow[];
  const codes = new Map(rows.map((r) => [r.team_id, r.code]));
  const names = new Map(rows.map((r) => [r.team_id, r.name ?? r.code]));
  const tickers = new Map(((must(companies, "the companies") ?? []) as { id: string; ticker: string | null }[]).map((c) => [c.id, c.ticker]));
  const lines = awardLines(list, codes, tickers).map((l) => ({
    ...l,
    names: list.filter((a) => a.code === l.code).map((a) => names.get(a.team_id) ?? "?"),
  }));
  return { rows, awards: lines as (AwardLine & { names: string[] })[] };
}

export type { AwardCode };
