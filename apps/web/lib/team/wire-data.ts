// Reads what the Wire Feed shows, as the signed-in team: released scores (RLS: public once released), when the
// rescue plans went public (the PLANS_PUBLISHED phase's start) and published bulletins. Any read problem gives an
// empty wire rather than a broken page.

import type { SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { wireFeed, type WireItem } from "./wire";

export async function loadWire(eventId: string): Promise<WireItem[]> {
  const sb = await supabaseServer();
  const [scores, companies, bulletins, plans] = await Promise.all([
    sb.from("scores").select("company_id, type, final_score, tier_bp, released_at").eq("event_id", eventId).eq("status", "RELEASED").not("released_at", "is", null),
    sb.from("companies").select("id, ticker").eq("event_id", eventId),
    sb.from("bulletins").select("kind, title, published_at").eq("event_id", eventId).not("published_at", "is", null).order("published_at", { ascending: false }).limit(20),
    sb.from("phases").select("started_at").eq("event_id", eventId).eq("code", "PLANS_PUBLISHED").maybeSingle<{ started_at: string | null }>(),
  ]);
  for (const r of [scores, companies, bulletins, plans]) {
    if (r.error) {
      console.error("wire: could not read the feed:", r.error.message);
      return [];
    }
  }
  const tickers = new Map((companies.data ?? []).map((c) => [c.id as string, (c.ticker as string | null) ?? null]));
  return wireFeed({
    scores: (scores.data ?? []).map((s) => ({
      ticker: tickers.get(s.company_id as string) ?? null,
      type: s.type as SubmissionType,
      score: s.final_score === null ? null : Number(s.final_score),
      tierBp: s.tier_bp === null ? null : Number(s.tier_bp),
      releasedAt: s.released_at as string,
    })),
    bulletins: (bulletins.data ?? []).map((b) => ({ kind: b.kind as string, title: b.title as string, publishedAt: b.published_at as string })),
    plansPublishedAt: plans.data?.started_at ?? null,
  });
}
