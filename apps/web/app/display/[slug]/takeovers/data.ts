// What each takeover reads, as the display account (RLS: the public set only, never a team's private rows). An
// organiser may open the big screen too, and RLS shows staff more (sealed scores, unpublished drafts), so every read
// here also filters to what is public. Team names come only from public.rankings, which returns null before AWARDS.

import { headers } from "next/headers";
import type { PhaseCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import type { VerdictType } from "@/lib/display/takeover";
import { lotteryRecordUrl, type AwardRow } from "@/lib/display/takeovers";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data;
}

export interface CompanyRow {
  id: string;
  ticker: string;
  name: string | null;
  ipo_price: number | null;
  market_price: number | null;
  closing_price: number | null;
  crisis_card_id: string | null;
}

/** Every listed company (public from READING), by ticker. */
export async function loadCompanies(eventId: string): Promise<CompanyRow[]> {
  const sb = await supabaseServer();
  const r = await sb
    .from("companies")
    .select("id, ticker, name, ipo_price, market_price, closing_price, crisis_card_id")
    .eq("event_id", eventId)
    .not("ticker", "is", null)
    .order("ticker");
  return (must(r, "the companies") ?? []) as CompanyRow[];
}

/** The 21:00 draw as public.draw_summary gives it (null before the draw). Never the seed. */
export interface DrawSummary {
  drawn_at: string;
  commitment: string | null;
  dice: string | null;
  squads: number;
}

export async function loadDrawSummary(eventId: string): Promise<DrawSummary | null> {
  const sb = await supabaseServer();
  return must(await sb.rpc("draw_summary", { p_event: eventId }), "the draw") as DrawSummary | null;
}

/** When a phase is scheduled to start (the crisis draw's time, for example). */
export async function loadPhaseStart(eventId: string, code: PhaseCode): Promise<string | null> {
  const sb = await supabaseServer();
  const r = await sb.from("phases").select("starts_at").eq("event_id", eventId).eq("code", code).maybeSingle<{ starts_at: string }>();
  return must(r, "the schedule")?.starts_at ?? null;
}

/** Where anyone can download the public lottery record (absolute, from this request's host, when known). */
export async function lotteryRecordAddress(slug: string): Promise<string> {
  const h = await headers();
  return lotteryRecordUrl(slug, h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
}

export interface PriceMove {
  market_before: number | null;
  market_after: number;
}

/** One recorded move per company (CRISIS, PLAN_TIER or FLASH_TIER: each happens once). */
export async function loadPriceMoves(eventId: string, kind: "CRISIS" | "PLAN_TIER" | "FLASH_TIER"): Promise<Map<string, PriceMove>> {
  const sb = await supabaseServer();
  const r = await sb.from("round_prices").select("company_id, market_before, market_after").eq("event_id", eventId).eq("kind", kind);
  const rows = (must(r, "the price moves") ?? []) as (PriceMove & { company_id: string })[];
  return new Map(rows.map((x) => [x.company_id, x]));
}

export interface CrisisCard {
  id: string;
  category: string;
  title: string;
}

/** The crisis deck (readable from CRISIS). */
export async function loadCrisisCards(eventId: string): Promise<Map<string, CrisisCard>> {
  const sb = await supabaseServer();
  const r = await sb.from("crisis_cards").select("id, category, title").eq("event_id", eventId);
  const rows = (must(r, "the crisis cards") ?? []) as CrisisCard[];
  return new Map(rows.map((c) => [c.id, c]));
}

export interface ReleasedScore {
  company_id: string;
  final_score: number | null;
  tier_bp: number | null;
}

/** Released scores of one type (RLS shows the display released ones only; staff are filtered the same way). */
export async function loadReleasedScores(eventId: string, type: VerdictType): Promise<ReleasedScore[]> {
  const sb = await supabaseServer();
  const r = await sb
    .from("scores")
    .select("company_id, final_score, tier_bp")
    .eq("event_id", eventId)
    .eq("type", type)
    .eq("status", "RELEASED");
  return (must(r, "the scores") ?? []) as ReleasedScore[];
}

export interface FlashBulletin {
  title: string;
  body: string;
  published_at: string;
}

/** The published FLASH bulletin (the latest, should there ever be two). */
export async function loadFlashBulletin(eventId: string): Promise<FlashBulletin | null> {
  const sb = await supabaseServer();
  const r = await sb
    .from("bulletins")
    .select("title, body, published_at")
    .eq("event_id", eventId)
    .eq("kind", "FLASH")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<FlashBulletin>();
  return must(r, "the flash bulletin");
}

/** The awards with team and company names, from public.rankings (null before AWARDS). */
export async function loadAwards(eventId: string): Promise<AwardRow[] | null> {
  const sb = await supabaseServer();
  const r = must(await sb.rpc("rankings", { p_event: eventId }), "the rankings") as { awards?: AwardRow[] } | null;
  return r ? (r.awards ?? []) : null;
}
