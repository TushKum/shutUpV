// What every team page needs, once per request, read through RLS as the signed-in team: its own row (cash,
// collateral, disqualification), its event and where the night is, and its squad and squad company once the lottery
// has formed them. A team can read only its own team row, its own squad and its squad's company (before Reading).

import { cache } from "react";
import type { Track } from "@msim/engine";
import { requireRole, type Viewer } from "@/lib/auth/viewer";
import { loadEventStatus, type EventStatus } from "@/lib/event-status";
import { cents } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

export interface TeamRow {
  id: string;
  code: string;
  track: Track;
  name: string;
  /** Integer cents. */
  cash: number;
  /** Integer cents locked as short collateral (funds). */
  collateral: number;
  disqualified: boolean;
  disqualified_reason: string | null;
}

export interface TeamEvent {
  id: string;
  name: string;
  is_rehearsal: boolean;
  clock_speed: number;
  drawn_at: string | null;
  crisis_applied_at: string | null;
}

export interface SquadRow {
  id: string;
  number: number;
  product_team_id: string;
  consulting_team_id: string;
  finance_team_id: string;
  dealt_card_ids: string[];
  chosen_card_id: string | null;
  chosen_at: string | null;
  chosen_by_default: boolean;
}

/** The squad's company. Prices are integer cents. */
export interface SquadCompany {
  id: string;
  name: string | null;
  ticker: string | null;
  ipo_price: number | null;
  market_price: number | null;
  ai_price: number | null;
  post_crisis_price: number | null;
  closing_price: number | null;
}

export interface TeamContext {
  viewer: Viewer;
  team: TeamRow;
  event: TeamEvent;
  status: EventStatus;
  /** Null before the 21:00 draw. */
  squad: SquadRow | null;
  company: SquadCompany | null;
}

export const loadTeamContext = cache(async (): Promise<TeamContext> => {
  const viewer = await requireRole(["TEAM"], "/team");
  const sb = await supabaseServer();
  const eventId = viewer.team!.eventId;
  const [team, event, squad, status] = await Promise.all([
    sb
      .from("teams")
      .select("id, code, track, name, cash_cents, collateral_cents, disqualified, disqualified_reason")
      .eq("id", viewer.team!.id)
      .single(),
    sb.from("events").select("id, name, is_rehearsal, clock_speed, drawn_at, crisis_applied_at").eq("id", eventId).single<TeamEvent>(),
    sb
      .from("squads")
      .select("id, number, product_team_id, consulting_team_id, finance_team_id, dealt_card_ids, chosen_card_id, chosen_at, chosen_by_default")
      .eq("event_id", eventId)
      .maybeSingle<SquadRow>(),
    loadEventStatus(eventId),
  ]);
  if (team.error) throw new Error(`Could not read your team: ${team.error.message}`);
  if (event.error) throw new Error(`Could not read the event: ${event.error.message}`);
  if (squad.error) throw new Error(`Could not read your squad: ${squad.error.message}`);
  let company: SquadCompany | null = null;
  if (squad.data) {
    const { data, error } = await sb
      .from("companies")
      .select("id, name, ticker, ipo_price, market_price, ai_price, post_crisis_price, closing_price")
      .eq("squad_id", squad.data.id)
      .maybeSingle<SquadCompany>();
    if (error) throw new Error(`Could not read your company: ${error.message}`);
    company = data;
  }
  const t = team.data as Omit<TeamRow, "cash" | "collateral"> & { cash_cents: string | number; collateral_cents: string | number };
  return {
    viewer,
    team: {
      id: t.id,
      code: t.code,
      track: t.track,
      name: t.name,
      cash: cents(t.cash_cents),
      collateral: cents(t.collateral_cents),
      disqualified: t.disqualified,
      disqualified_reason: t.disqualified_reason,
    },
    event: event.data,
    status,
    squad: squad.data,
    company,
  };
});
