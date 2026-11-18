// The control panel's track pages (Product, Consulting, Finance): who each squad is, and what each team has handed in,
// hired, bid or traded, read as staff (staff read every team's rows).

import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

export interface SquadLine {
  id: string;
  number: number;
  sector: string | null;
  product: { id: string; code: string; name: string };
  consulting: { id: string; code: string; name: string };
  finance: { id: string; code: string; name: string };
  company: { id: string; ticker: string | null; name: string | null; price: number | null } | null;
}

export interface TeamRow {
  id: string;
  code: string;
  name: string;
  track: "PRODUCT" | "CONSULTING" | "FINANCE";
  cash_cents: number | string;
  collateral_cents: number | string;
  disqualified: boolean;
}

export interface SubmissionRow {
  company_id: string | null;
  squad_id: string | null;
  type: string;
  submitted_at: string | null;
  submitted_by_team: string | null;
  auto_submitted: boolean | null;
}

/** Every team of the event, and the squads (with their company and sector) once drawn. */
export async function loadSquads(eventId: string): Promise<{ teams: TeamRow[]; squads: SquadLine[] }> {
  const sb = await supabaseServer();
  const [teams, squads, companies] = await Promise.all([
    sb.from("teams").select("id, code, name, track, cash_cents, collateral_cents, disqualified").eq("event_id", eventId).order("code"),
    sb
      .from("squads")
      .select("id, number, product_team_id, consulting_team_id, finance_team_id, problem_cards!squads_chosen_card_id_fkey(sector)")
      .eq("event_id", eventId)
      .order("number"),
    sb.from("companies").select("id, ticker, name, squad_id, market_price").eq("event_id", eventId),
  ]);
  const t = (teams.data ?? []) as TeamRow[];
  const byId = new Map(t.map((x) => [x.id, x]));
  const team = (id: string) => {
    const x = byId.get(id);
    return { id, code: x?.code ?? "?", name: x?.name ?? "" };
  };
  const cos = (companies.data ?? []) as { id: string; ticker: string | null; name: string | null; squad_id: string | null; market_price: number | null }[];
  const lines = ((squads.data ?? []) as unknown as {
    id: string;
    number: number;
    product_team_id: string;
    consulting_team_id: string;
    finance_team_id: string;
    problem_cards: { sector: string | null } | { sector: string | null }[] | null;
  }[]).map((s): SquadLine => {
    const co = cos.find((c) => c.squad_id === s.id) ?? null;
    const card = Array.isArray(s.problem_cards) ? s.problem_cards[0] : s.problem_cards;
    return {
      id: s.id,
      number: s.number,
      sector: card?.sector ?? null,
      product: team(s.product_team_id),
      consulting: team(s.consulting_team_id),
      finance: team(s.finance_team_id),
      company: co ? { id: co.id, ticker: co.ticker, name: co.name, price: co.market_price } : null,
    };
  });
  return { teams: t, squads: lines };
}

/** The current (not superseded) submissions of the event. */
export async function loadSubmissions(eventId: string): Promise<SubmissionRow[]> {
  const sb = await supabaseServer();
  const out: SubmissionRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("submissions")
      .select("company_id, squad_id, type, submitted_at, submitted_by_team, auto_submitted")
      .eq("event_id", eventId)
      .is("superseded_at", null)
      .order("id")
      .range(from, from + 999);
    const rows = (data ?? []) as SubmissionRow[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** A tick, a dash, or "auto" (submitted for the team at the deadline). */
export function mark(s: SubmissionRow | undefined): string {
  if (!s?.submitted_at) return "—";
  return s.auto_submitted ? "✓ auto" : "✓";
}
