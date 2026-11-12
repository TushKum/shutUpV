// Reads the crisis room as the signed-in team, through RLS: the event's format and deadlines, the sub-rounds, the
// crisis cards dealt in each (public once revealed), the firms (their value and profile), this team's offers (a
// company sees its own, a firm those made to it), every engagement (public: who hired whom, on what terms), the
// Round 3 statements and draft, and, for a firm, its clients' drafts and submissions of the sub-round it was hired for.

import { DEADLINE_CODES, type DeadlineCode, type SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import type { CrisisCardRow } from "@/lib/team/market-data";
import { supabaseServer } from "@/lib/supabase/server";
import type { DraftPickRow, EngagementRow, OfferRow, SubroundRow } from "./crisis";
import type { DraftRow, SubmissionRow } from "./squad";

export interface RoomCompany {
  id: string;
  ticker: string | null;
  name: string | null;
  market_price: number | null;
  product_team_id: string | null;
}

export interface FirmRow {
  team_id: string;
  code: string;
  name: string;
  cash_cents: number;
  fee_share_value_cents: number;
  value_cents: number;
  clients: number;
  avg_rating: number | null;
}

export interface FirmProfile {
  team_id: string;
  headline: string;
  specialities: string[];
  rate_card: string;
  about: string;
  asking_cents: number;
}

export interface StatementRow {
  id: string;
  number: number;
  title: string;
  body: string;
  cap: number;
  /** The sector it belongs to (an event split across sectors), or null. */
  sector: string | null;
}

export interface ClientDraft extends DraftRow {
  company_id: string;
}

export interface ClientSubmission extends SubmissionRow {
  company_id: string;
}

export interface CrisisRoomData {
  format: "CLASSIC" | "PRIMUS";
  deadlines: Partial<Record<DeadlineCode, string>>;
  subrounds: SubroundRow[];
  /** Crisis cards by sub-round, then company. */
  cards: { k: number; company_id: string; card: CrisisCardRow }[];
  companies: RoomCompany[];
  firms: FirmRow[];
  profiles: Map<string, FirmProfile>;
  offers: OfferRow[];
  engagements: EngagementRow[];
  statements: StatementRow[];
  picks: DraftPickRow[];
  /** A firm's clients' drafts and submissions (the sub-rounds it was hired for). */
  clientDrafts: ClientDraft[];
  clientSubmissions: ClientSubmission[];
  /** The Round 3 capital injection this team received (funds), in cents, or null. */
  injectionCents: number | null;
  /** This team's squad's sector (the sector on its chosen problem card), or null. */
  mySector: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadCrisisRoom(ctx: TeamContext): Promise<CrisisRoomData> {
  const sb = await supabaseServer();
  const eventId = ctx.event.id;
  const [event, deadlines, subrounds, crises, companies, firms, profiles, offers, engagements, statements, picks, injection] = await Promise.all([
    sb.from("events").select("format").eq("id", eventId).maybeSingle<{ format: "CLASSIC" | "PRIMUS" }>(),
    sb.from("deadlines").select("code, at").eq("event_id", eventId),
    sb.from("subrounds").select("k, revealed_at, hiring_closed_at, due_closed_at, rated_at").eq("event_id", eventId).order("k"),
    sb.from("subround_crises").select("k, company_id, crisis_cards(id, category, title, body)").eq("event_id", eventId).order("k"),
    sb.from("companies").select("id, ticker, name, market_price, product_team_id").eq("event_id", eventId).order("ticker"),
    sb.rpc("firm_values", { p_event: eventId }),
    sb.from("firm_profiles").select("team_id, headline, specialities, rate_card, about, asking_cents").eq("event_id", eventId),
    sb.from("offers").select("id, k, company_id, firm_team_id, cash_cents, shares, note, status, turn, company_counters, firm_counters, updated_at").eq("event_id", eventId).order("updated_at", { ascending: false }),
    sb.from("engagements").select("id, k, company_id, firm_team_id, cash_cents, shares, escrow, rating, rating_default, bonus_cents").eq("event_id", eventId).order("k"),
    sb.from("problem_statements").select("id, number, title, body, cap, sector").eq("event_id", eventId).order("number"),
    sb.from("draft_picks").select("company_id, pick_no, score_avg, opens_at, closes_at, statement_id, picked_at, by_default").eq("event_id", eventId).order("pick_no"),
    sb.from("ledger_entries").select("cash_delta_cents").eq("team_id", ctx.team.id).eq("kind", "INJECTION"),
  ]);
  for (const [what, r] of [
    ["the event", event],
    ["the deadlines", deadlines],
    ["the sub-rounds", subrounds],
    ["the crisis cards", crises],
    ["the companies", companies],
    ["the firms", firms],
    ["the firm profiles", profiles],
    ["your offers", offers],
    ["the engagements", engagements],
    ["the problem statements", statements],
    ["the draft", picks],
    ["your ledger", injection],
  ] as const) {
    if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  }
  const engagementRows = ((engagements.data ?? []) as EngagementRow[]).map((e) => ({
    ...e,
    cash_cents: Number(e.cash_cents),
    bonus_cents: num(e.bonus_cents),
  }));
  // A firm reads the drafts and submissions of the clients it was hired by (policy submission_drafts_firm_read).
  const clientIds = [...new Set(engagementRows.filter((e) => e.firm_team_id === ctx.team.id).map((e) => e.company_id))];
  const [cd, cs] = clientIds.length
    ? await Promise.all([
        sb.from("submission_drafts").select("company_id, type, content, version, updated_at, updated_by_team").in("company_id", clientIds),
        sb
          .from("submissions")
          .select("id, company_id, type, content, word_count, submitted_at, submitted_by_team, superseded_at")
          .in("company_id", clientIds)
          .order("submitted_at", { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (cd.error) throw new Error(`Could not read your clients' drafts: ${cd.error.message}`);
  if (cs.error) throw new Error(`Could not read your clients' submissions: ${cs.error.message}`);
  const chosen = ctx.squad?.chosen_card_id
    ? await sb.from("problem_cards").select("sector").eq("id", ctx.squad.chosen_card_id).maybeSingle<{ sector: string | null }>()
    : null;
  const injected = ((injection.data ?? []) as { cash_delta_cents: number }[]).reduce((s, r) => s + Number(r.cash_delta_cents), 0);
  return {
    format: event.data?.format ?? "CLASSIC",
    deadlines: Object.fromEntries(
      ((deadlines.data ?? []) as { code: DeadlineCode; at: string }[]).filter((d) => DEADLINE_CODES.includes(d.code)).map((d) => [d.code, d.at]),
    ),
    subrounds: (subrounds.data ?? []) as SubroundRow[],
    cards: ((crises.data ?? []) as unknown as { k: number; company_id: string; crisis_cards: CrisisCardRow | CrisisCardRow[] | null }[])
      .map((r) => ({ k: r.k, company_id: r.company_id, card: Array.isArray(r.crisis_cards) ? r.crisis_cards[0] : r.crisis_cards }))
      .filter((r): r is { k: number; company_id: string; card: CrisisCardRow } => !!r.card),
    companies: ((companies.data ?? []) as RoomCompany[]).map((c) => ({ ...c, market_price: num(c.market_price) })),
    firms: ((firms.data ?? []) as FirmRow[]).map((f) => ({
      ...f,
      cash_cents: Number(f.cash_cents),
      fee_share_value_cents: Number(f.fee_share_value_cents),
      value_cents: Number(f.value_cents),
      avg_rating: num(f.avg_rating),
    })),
    profiles: new Map(((profiles.data ?? []) as FirmProfile[]).map((p) => [p.team_id, { ...p, asking_cents: Number(p.asking_cents) }])),
    offers: ((offers.data ?? []) as OfferRow[]).map((o) => ({ ...o, cash_cents: Number(o.cash_cents) })),
    engagements: engagementRows,
    statements: (statements.data ?? []) as StatementRow[],
    picks: ((picks.data ?? []) as DraftPickRow[]).map((p) => ({ ...p, score_avg: Number(p.score_avg) })),
    clientDrafts: (cd.data ?? []) as ClientDraft[],
    clientSubmissions: (cs.data ?? []) as ClientSubmission[],
    injectionCents: injected > 0 ? injected : null,
    mySector: chosen?.data?.sector?.trim() || null,
  };
}

export const draftOf = (rows: readonly ClientDraft[], companyId: string, type: SubmissionType) =>
  rows.find((d) => d.company_id === companyId && d.type === type) ?? null;
