// Reads a Consulting team's calls as the signed-in team, through RLS: its two covered companies (coverage), its own
// call rows (private to it), the covered companies' names and prices (public from Reading), which scores have been
// released (they open and close the call windows), whether the market has closed, and the deadlines.

import { SUBMISSION_TYPES, type SubmissionType } from "@msim/engine";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamContext } from "@/lib/team/context";
import type { CallRow, CallsInput, CoveredCompany } from "./calls";
import { loadDeadlines, must, pauseOf } from "./rescue-data";
import type { Deadlines } from "./rescue";

export interface CallsData {
  coverage: { company_id: string }[];
  companies: CoveredCompany[];
  calls: CallRow[];
  deadlines: Deadlines;
  released: Record<SubmissionType, boolean>;
  marketClosedAt: string | null;
  settledAt: string | null;
}

export async function loadCalls(sb: SupabaseClient, ctx: TeamContext): Promise<CallsData> {
  const { event, team } = ctx;
  const [coverage, calls, deadlines, scores, ev] = await Promise.all([
    sb
      .from("coverage")
      .select("company_id")
      .eq("consultant_team_id", team.id)
      .then((r) => must(r, "your covered companies") as { company_id: string }[]),
    sb
      .from("calls")
      .select("id, company_id, call_no, direction, made_at, baseline_price, judged_price, correct, earnings_cents")
      .eq("consultant_team_id", team.id)
      .order("call_no")
      .then((r) => must(r, "your calls") as CallRow[]),
    loadDeadlines(sb, event.id),
    // Only released scores are readable (one row per company and type, at most 150).
    sb
      .from("scores")
      .select("type")
      .eq("event_id", event.id)
      .eq("status", "RELEASED")
      .then((r) => must(r, "the scores") as { type: SubmissionType }[]),
    sb
      .from("events")
      .select("market_closed_at, settled_at")
      .eq("id", event.id)
      .single<{ market_closed_at: string | null; settled_at: string | null }>()
      .then((r) => must(r, "the event")),
  ]);
  const ids = coverage.map((c) => c.company_id);
  // Before Reading the covered companies are not public: this returns nothing, and the page numbers them.
  const companies =
    ids.length > 0
      ? (must(await sb.from("companies").select("id, ticker, name").in("id", ids), "your covered companies") as CoveredCompany[])
      : [];
  const types = new Set(scores.map((s) => s.type));
  return {
    coverage,
    companies,
    calls,
    deadlines,
    released: Object.fromEntries(SUBMISSION_TYPES.map((t) => [t, types.has(t)])) as Record<SubmissionType, boolean>,
    marketClosedAt: ev.market_closed_at,
    settledAt: ev.settled_at,
  };
}

/** What the call windows depend on, judged at the server's time of this render. */
export function callsInput(ctx: TeamContext, d: CallsData): CallsInput {
  return {
    ...pauseOf(ctx),
    nowMs: Date.parse(ctx.status.server_time),
    drawn: ctx.status.drawn,
    released: d.released,
    marketClosed: d.marketClosedAt !== null,
    deadlines: d.deadlines,
  };
}
