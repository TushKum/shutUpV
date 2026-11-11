// Reads the stored draw of one event for the lottery page and the record download, as the signed-in staff member
// (RLS: staff read every table, including the secret seed in event_secrets).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LotteryRows } from "./lottery";

export interface LotteryEventRow {
  id: string;
  seed_commitment: string | null;
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
  const [secret, teams, problemCards, squads, coverage, companies, crisisCards] = await Promise.all([
    sb.from("event_secrets").select("seed").eq("event_id", id).maybeSingle<{ seed: string }>(),
    rows<LotteryRows["teams"][number]>(sb.from("teams").select("id, code, track").eq("event_id", id), "the teams"),
    rows<LotteryRows["problemCards"][number]>(sb.from("problem_cards").select("id, number, sector, title").eq("event_id", id), "the problem deck"),
    rows<LotteryRows["squads"][number]>(
      sb
        .from("squads")
        .select("number, product_team_id, consulting_team_id, finance_team_id, dealt_card_ids, chosen_card_id, chosen_by_default")
        .eq("event_id", id),
      "the squads",
    ),
    rows<LotteryRows["coverage"][number]>(sb.from("coverage").select("consultant_team_id, company_id").eq("event_id", id), "the coverage"),
    rows<LotteryRows["companies"][number]>(sb.from("companies").select("id, product_team_id, ticker, crisis_card_id").eq("event_id", id), "the companies"),
    event.crisis_applied_at
      ? rows<NonNullable<LotteryRows["crisisCards"]>[number]>(sb.from("crisis_cards").select("id, category, number").eq("event_id", id), "the crisis deck")
      : Promise.resolve(null),
  ]);
  if (secret.error) throw new Error(`Could not read the seed: ${secret.error.message}`);
  if (!secret.data) throw new Error("The lottery was drawn but its seed is not stored.");
  return {
    commitment: event.seed_commitment,
    seed: secret.data.seed,
    dice: event.dice,
    teams,
    problemCards,
    squads,
    coverage,
    companies,
    crisisCards,
  };
}

/** The lottery columns of an event (crisis_applied_at is not part of the shared admin event). */
export async function loadLotteryEvent(sb: SupabaseClient, slug: string): Promise<(LotteryEventRow & { slug: string }) | null> {
  const { data, error } = await sb
    .from("events")
    .select("id, slug, seed_commitment, dice, drawn_at, crisis_applied_at")
    .eq("slug", slug)
    .maybeSingle<LotteryEventRow & { slug: string }>();
  if (error) throw new Error(`Could not read the event: ${error.message}`);
  return data;
}
