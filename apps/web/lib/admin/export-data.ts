// Reads one export's rows as the signed-in staff member (RLS: staff read every table of the event) and writes the
// CSV. Every table is read in pages of 1,000 rows in a stable order (append-only tables by id). bigint columns are
// read as text (PostgREST sends a bigint as a JSON number, which a double cannot hold exactly beyond 2^53), so cents
// are written exactly as stored.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Track } from "@msim/engine";
import {
  EXPORTS,
  EXPORT_KINDS,
  buildLookups,
  fetchPages,
  ledgerCsv,
  pricesCsv,
  resultsCsv,
  scoresCsv,
  type ExportKind,
  type LedgerExportRow,
  type Lookups,
  type PriceExportRow,
  type ResultExportRow,
  type ScoreExportRow,
} from "./export";

async function loadLookups(sb: SupabaseClient, eventId: string): Promise<Lookups> {
  const [teams, companies, rounds] = await Promise.all([
    fetchPages<{ id: string; code: string; track: Track }>(
      (from, to) => sb.from("teams").select("id, code, track").eq("event_id", eventId).order("id").range(from, to),
      "the teams",
    ),
    fetchPages<{ id: string; ticker: string | null }>(
      (from, to) => sb.from("companies").select("id, ticker").eq("event_id", eventId).order("id").range(from, to),
      "the companies",
    ),
    fetchPages<{ id: string; number: number }>(
      (from, to) => sb.from("rounds").select("id, number").eq("event_id", eventId).order("id").range(from, to),
      "the rounds",
    ),
  ]);
  return buildLookups(teams, companies, rounds);
}

export async function buildExport(sb: SupabaseClient, eventId: string, kind: ExportKind): Promise<string> {
  const lk = await loadLookups(sb, eventId);
  switch (kind) {
    case "ledger":
      return ledgerCsv(
        await fetchPages<LedgerExportRow>(
          (from, to) =>
            sb
              .from("ledger_entries")
              .select("id::text, txn_id, kind, team_id, company_id, lot, cash_delta_cents::text, share_delta, price_cents, round_id, memo, created_at")
              .eq("event_id", eventId)
              .order("id")
              .range(from, to),
          "the ledger",
        ),
        lk,
      );
    case "prices":
      return pricesCsv(
        await fetchPages<PriceExportRow>(
          (from, to) =>
            sb
              .from("round_prices")
              .select(
                "id::text, company_id, round_id, kind, market_before, market_after, ai_before, ai_after, buy_qty, sell_qty, short_qty, cover_qty, net_qty, capped_net, tier_bp, created_at",
              )
              .eq("event_id", eventId)
              .order("id")
              .range(from, to),
          "the prices",
        ),
        lk,
      );
    case "scores":
      return scoresCsv(
        await fetchPages<ScoreExportRow>(
          (from, to) =>
            sb
              .from("scores")
              .select("company_id, type, run_totals, median, final_score, tier_bp, capped, penalty, missing, status, released_at")
              .eq("event_id", eventId)
              .order("id")
              .range(from, to),
          "the scores",
        ),
        lk,
      );
    case "results":
      return resultsCsv(
        await fetchPages<ResultExportRow>(
          (from, to) =>
            sb
              .from("results")
              .select("team_id, track, final_value_cents::text, start_value_cents::text, return_bp::text, rank, eligible")
              .eq("event_id", eventId)
              .order("id")
              .range(from, to),
          "the results",
        ),
        lk,
      );
  }
}

/** How many rows each export has now (for the exports page); null when the count could not be read. */
export async function exportCounts(sb: SupabaseClient, eventId: string): Promise<Record<ExportKind, number | null>> {
  const counts = await Promise.all(
    EXPORT_KINDS.map(async (kind) => {
      const { count, error } = await sb.from(EXPORTS[kind].table).select("*", { count: "exact", head: true }).eq("event_id", eventId);
      return [kind, error ? null : (count ?? 0)] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<ExportKind, number | null>;
}
