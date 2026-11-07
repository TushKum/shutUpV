// What every team page needs, once per request, read through RLS as the signed-in team: its own row (cash,
// disqualification), its event and where the night is, the company it builds (from the start) and the company it
// rescues (from the 23:45 rescue lottery).

import { cache } from "react";
import { requireRole, type Viewer } from "@/lib/auth/viewer";
import { loadEventStatus, type EventStatus } from "@/lib/event-status";
import { cents } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

export interface TeamRow {
  id: string;
  code: string;
  name: string;
  /** Integer cents. */
  cash: number;
  disqualified: boolean;
  disqualified_reason: string | null;
}

export interface TeamEvent {
  id: string;
  name: string;
  is_rehearsal: boolean;
  clock_speed: number;
  drawn_at: string | null;
  prds_locked_at: string | null;
  prices_started_at: string | null;
  crisis_applied_at: string | null;
  solutions_locked_at: string | null;
  scores_revealed_at: string | null;
  market_closed_at: string | null;
}

/** A company as every team reads it. Prices are integer cents (null until they are set). */
export interface CompanyRow {
  id: string;
  founder_team_id: string;
  rescuer_team_id: string | null;
  problem_card_id: string | null;
  crisis_card_id: string | null;
  name: string | null;
  ticker: string | null;
  start_price: number | null;
  market_price: number | null;
  score_price: number | null;
  post_crisis_price: number | null;
  closing_price: number | null;
}

export const COMPANY_COLUMNS =
  "id, founder_team_id, rescuer_team_id, problem_card_id, crisis_card_id, name, ticker, start_price, market_price, score_price, post_crisis_price, closing_price";

export interface TeamContext {
  viewer: Viewer;
  team: TeamRow;
  event: TeamEvent;
  status: EventStatus;
  /** The company this team builds (Round 1). */
  built: CompanyRow | null;
  /** The company this team rescues (Round 2), from 23:45. */
  rescued: CompanyRow | null;
}

export const loadTeamContext = cache(async (): Promise<TeamContext> => {
  const viewer = await requireRole(["TEAM"], "/team");
  const sb = await supabaseServer();
  const eventId = viewer.team!.eventId;
  const teamId = viewer.team!.id;
  const [team, event, companies, status] = await Promise.all([
    sb.from("teams").select("id, code, name, cash_cents, disqualified, disqualified_reason").eq("id", teamId).single(),
    sb
      .from("events")
      .select("id, name, is_rehearsal, clock_speed, drawn_at, prds_locked_at, prices_started_at, crisis_applied_at, solutions_locked_at, scores_revealed_at, market_closed_at")
      .eq("id", eventId)
      .single<TeamEvent>(),
    sb.from("companies").select(COMPANY_COLUMNS).or(`founder_team_id.eq.${teamId},rescuer_team_id.eq.${teamId}`),
    loadEventStatus(eventId),
  ]);
  if (team.error) throw new Error(`Could not read your team: ${team.error.message}`);
  if (event.error) throw new Error(`Could not read the event: ${event.error.message}`);
  if (companies.error) throw new Error(`Could not read your companies: ${companies.error.message}`);
  const rows = (companies.data ?? []) as CompanyRow[];
  const t = team.data as Omit<TeamRow, "cash"> & { cash_cents: string | number };
  return {
    viewer,
    team: { id: t.id, code: t.code, name: t.name, cash: cents(t.cash_cents), disqualified: t.disqualified, disqualified_reason: t.disqualified_reason },
    event: event.data,
    status,
    built: rows.find((c) => c.founder_team_id === teamId) ?? null,
    rescued: rows.find((c) => c.rescuer_team_id === teamId) ?? null,
  };
});
