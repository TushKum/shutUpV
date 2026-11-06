// Reads the stored draw of one event for the lottery page and the record download, as the signed-in staff member.
// Until the crisis the seed is in event_secrets (staff only); from the crisis on it is published on the event.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LotteryRows } from "./lottery";

export interface LotteryEventRow {
  id: string;
  slug: string;
  seed_commitment: string | null;
  seed_revealed: string | null;
  dice: string | null;
  drawn_at: string | null;
  crisis_applied_at: string | null;
}

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return data ?? [];
}

/** The draw as stored, or null before the lottery has been drawn. Every table here is far below 1,000 rows. */
export async function loadLotteryRows(sb: SupabaseClient, event: LotteryEventRow): Promise<LotteryRows | null> {
  if (!event.drawn_at || !event.seed_commitment || !event.dice) return null;
  const id = event.id;
  const [secret, teams, problemCards, crisisCards, companies] = await Promise.all([
    event.seed_revealed ? Promise.resolve({ data: { seed: event.seed_revealed }, error: null }) : sb.from("event_secrets").select("seed").eq("event_id", id).maybeSingle<{ seed: string }>(),
    rows<LotteryRows["teams"][number]>(sb.from("teams").select("id, code, name").eq("event_id", id), "the teams"),
    rows<LotteryRows["problemCards"][number]>(sb.from("problem_cards").select("id, number, sector, title").eq("event_id", id), "the problem deck"),
    rows<LotteryRows["crisisCards"][number]>(sb.from("crisis_cards").select("id, number, category, title").eq("event_id", id), "the crisis deck"),
    rows<LotteryRows["companies"][number]>(
      sb.from("companies").select("founder_team_id, rescuer_team_id, problem_card_id, crisis_card_id, ticker, name").eq("event_id", id),
      "the companies",
    ),
  ]);
  if (secret.error) throw new Error(`Could not read the seed: ${secret.error.message}`);
  if (!secret.data) throw new Error("The lottery was drawn but its seed is not stored.");
  return {
    commitment: event.seed_commitment,
    seed: secret.data.seed,
    dice: event.dice,
    teams,
    problemCards,
    crisisCards,
    companies,
    crisisApplied: !!event.crisis_applied_at,
  };
}

export async function loadLotteryEvent(sb: SupabaseClient, slug: string): Promise<LotteryEventRow | null> {
  const { data, error } = await sb
    .from("events")
    .select("id, slug, seed_commitment, seed_revealed, dice, drawn_at, crisis_applied_at")
    .eq("slug", slug)
    .maybeSingle<LotteryEventRow>();
  if (error) throw new Error(`Could not read the event: ${error.message}`);
  return data;
}
