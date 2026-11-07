// Signs teams in (with the passwords on their login cards, derived from CARD_SECRET) and plays their turns: read what
// the team can see through RLS, decide (bots.ts), call the public game functions as the team. Used by
// `pnpm rehearse` (bots playing a rehearsal night) and `pnpm load-test` (the sign-ins and connections).

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { teamEmail, type PhaseCode } from "@msim/engine";
import { derivePassword } from "./credentials";
import { decide, newMemory, remember, rng, type Action, type Memory, type Snapshot } from "./bots";
export interface Env {
  url: string;
  anonKey: string;
  cardSecret: string;
  emailDomain: string;
}

export interface TeamLogin {
  id: string;
  code: string;
  /** Its place in code order (it sets the bot's ticker). */
  index: number;
}

const noSession = { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false };

/** A signed-in client for one team. Retries a few times (sign-ins are rate limited per IP). */
export async function signInTeam(env: Env, slug: string, code: string): Promise<SupabaseClient> {
  const sb = createClient(env.url, env.anonKey, { auth: noSession });
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.auth.signInWithPassword({ email: teamEmail(code, env.emailDomain), password: derivePassword(env.cardSecret, slug, code) });
    if (!error) return sb;
    if (attempt >= 5) throw new Error(`${code} could not sign in: ${error.message}`);
    await sleep(1000 * attempt);
  }
}

/** Runs `fn` over `items` with at most `limit` at a time. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i);
    }),
  );
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A game function's result as { ok, code? }: a refusal is data; a raised error is reported as ERROR. */
export async function call(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; code?: string; message?: string; data?: unknown }> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, code: "ERROR", message: error.message };
  const d = data as { ok?: boolean; code?: string; message?: string } | null;
  return { ok: d?.ok === true, code: d?.code, message: d?.message, data };
}

/** Everything a bot reads for one turn, through RLS as its team. */
export async function snapshot(sb: SupabaseClient, eventId: string, team: TeamLogin): Promise<Snapshot> {
  const res = await sb.rpc("event_status", { p_event: eventId });
  if (res.error || !res.data) throw new Error(`event_status: ${res.error?.message ?? "no answer"}`);
  const status = res.data as { phase: PhaseCode; trading: string; paused: boolean; drawn: boolean; open_round: { number: number } | null };
  const [me, ev, companies, drafts, holdings, pending] = await Promise.all([
    sb.from("teams").select("cash_cents").eq("id", team.id).single(),
    sb.from("events").select("crisis_applied_at").eq("id", eventId).single(),
    sb.from("companies").select("id, ticker, founder_team_id, rescuer_team_id, market_price").eq("event_id", eventId),
    sb.from("drafts").select("type, version").eq("team_id", team.id),
    sb.from("holdings").select("company_id, qty").eq("team_id", team.id),
    sb.from("orders").select("id", { count: "exact", head: true }).eq("team_id", team.id).eq("status", "PENDING"),
  ]);
  for (const r of [me, ev, companies, drafts, holdings]) if (r.error) throw new Error(r.error.message);
  const list = (companies.data ?? []) as Snapshot["companies"];
  const s: Snapshot = {
    phase: status.phase,
    trading: status.trading,
    openRound: status.open_round?.number ?? null,
    paused: status.paused,
    team: { id: team.id, code: team.code, index: team.index, cash_cents: Number(me.data?.cash_cents ?? 0) },
    drawn: status.drawn,
    crisisApplied: !!ev.data?.crisis_applied_at,
    drafts: { PRD: 0, SOLUTION: 0 },
    companies: list,
    holdings: Object.fromEntries((holdings.data ?? []).map((h) => [h.company_id as string, h.qty as number])),
    unanswered: [],
    asked: 0,
    pendingOrders: pending.count ?? 0,
  };
  for (const d of drafts.data ?? []) s.drafts[d.type as "PRD" | "SOLUTION"] = d.version as number;
  if (s.crisisApplied) {
    const built = list.find((c) => c.founder_team_id === team.id);
    const [mine, asked] = await Promise.all([
      built ? sb.from("qa_questions").select("id").eq("company_id", built.id) : Promise.resolve({ data: [] as { id: string }[], error: null }),
      sb.from("qa_questions").select("id", { count: "exact", head: true }).eq("asker_team_id", team.id),
    ]);
    const ids = (mine.data ?? []).map((q) => q.id as string);
    const answered = ids.length ? ((await sb.from("qa_answers").select("question_id").in("question_id", ids)).data ?? []).map((a) => a.question_id as string) : [];
    s.unanswered = ids.filter((id) => !answered.includes(id));
    s.asked = asked.count ?? 0;
  }
  return s;
}

export interface BotStats {
  turns: number;
  calls: number;
  ok: number;
  refused: Record<string, number>;
  errors: number;
  /** The last few error messages, for the progress line. */
  lastErrors: string[];
}

/** One bot: a team that keeps playing until `stop` resolves. */
export class Bot {
  readonly memory: Memory = newMemory();
  private readonly random: () => number;
  constructor(
    readonly sb: SupabaseClient,
    readonly eventId: string,
    readonly team: TeamLogin,
    readonly stats: BotStats,
  ) {
    this.random = rng(team.code);
  }

  async turn(now = Date.now()): Promise<void> {
    this.stats.turns++;
    let s: Snapshot;
    try {
      s = await snapshot(this.sb, this.eventId, this.team);
    } catch (e) {
      this.stats.errors++;
      this.stats.lastErrors = [...this.stats.lastErrors.slice(-2), e instanceof Error ? e.message : String(e)];
      return;
    }
    for (const a of decide(s, this.memory, this.random, now, randomUUID)) await this.act(a, s, now);
  }

  private async act(a: Action, s: Snapshot, now: number) {
    this.stats.calls++;
    const r = await call(this.sb, a.fn, a.args as Record<string, unknown>);
    if (r.ok) this.stats.ok++;
    else if (r.code === "ERROR") {
      this.stats.errors++;
      this.stats.lastErrors = [...this.stats.lastErrors.slice(-2), `${a.fn}: ${r.message}`];
    }
    else this.stats.refused[r.code ?? "?"] = (this.stats.refused[r.code ?? "?"] ?? 0) + 1;
    remember(this.memory, a, r, now, s);
  }
}

export const emptyStats = (): BotStats => ({ turns: 0, calls: 0, ok: 0, refused: {}, errors: 0, lastErrors: [] });
