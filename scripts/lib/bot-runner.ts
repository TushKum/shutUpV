// Signs teams in (with the passwords on their login cards, derived from CARD_SECRET) and plays their turns: read what
// the team can see through RLS, decide (bots.ts), call the public game functions as the team. Used by
// `pnpm rehearse` (bots playing a rehearsal night) and `pnpm load-test` (the sign-ins and connections).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PHASE_CODES, teamEmail, type PhaseCode, type SubmissionType, type Track } from "@msim/engine";
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
  track: Track;
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

/** Everything a bot reads for one turn, through RLS as its team (only what its track needs). */
export async function snapshot(sb: SupabaseClient, eventId: string, team: TeamLogin): Promise<Snapshot> {
  const res = await sb.rpc("event_status", { p_event: eventId });
  if (res.error || !res.data) throw new Error(`event_status: ${res.error?.message ?? "no answer"}`);
  const status = res.data as { phase: PhaseCode; trading: string; open_round: { number: number } | null };
  const squadQ = sb.from("squads").select("id, number, dealt_card_ids, chosen_card_id").maybeSingle();
  const teamQ = sb.from("teams").select("cash_cents").eq("id", team.id).single();
  const companiesQ = sb.from("companies").select("id, ticker, squad_id, ipo_price, market_price, post_crisis_price").eq("event_id", eventId);
  const [squad, me, companies] = await Promise.all([squadQ, teamQ, companiesQ]);
  const s: Snapshot = {
    phase: status.phase,
    trading: status.trading,
    openRound: status.open_round?.number ?? null,
    team: { id: team.id, code: team.code, track: team.track, cash_cents: Number(me.data?.cash_cents ?? 0) },
    squad: squad.data ?? null,
    companyId: null,
    drafts: {},
    submitted: {},
    fee: null,
    deal: null,
    calls: [],
    companies: (companies.data ?? []) as Snapshot["companies"],
    holdings: [],
    pendingOrders: [],
    ipoBids: 0,
    flashPublished: false,
  };
  s.companyId = s.companies.find((c) => c.squad_id === s.squad?.id)?.id ?? null;
  const reads: PromiseLike<unknown>[] = [];
  if (team.track !== "FINANCE") {
    reads.push(
      sb.from("submission_drafts").select("type, version").then(({ data }) => {
        for (const d of data ?? []) s.drafts[d.type as SubmissionType] = d.version;
      }),
      s.squad
        ? sb.from("submissions").select("type").is("superseded_at", null).eq("squad_id", s.squad.id).then(({ data }) => {
            for (const d of data ?? []) s.submitted[d.type as SubmissionType] = true;
          })
        : Promise.resolve(),
      sb.from("fees").select("version, cash_cents, shares, product_confirmed_at, consulting_confirmed_at, executed_at").maybeSingle().then(({ data }) => {
        s.fee = data ?? null;
      }),
    );
  }
  reads.push(
    sb.from("deals").select("version, amount_cents, price_cents, signed_product_at, signed_consulting_at, signed_finance_at, executed_at").maybeSingle().then(({ data }) => {
      s.deal = data ?? null;
    }),
  );
  if (team.track === "PRODUCT" && status.phase === "ROUNDS_13_21") {
    reads.push(
      sb.from("bulletins").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("kind", "FLASH").not("published_at", "is", null)
        .then(({ count }) => void (s.flashPublished = (count ?? 0) > 0)),
    );
  }
  if (team.track === "CONSULTING") {
    reads.push(sb.from("calls").select("company_id, call_no, direction").then(({ data }) => void (s.calls = (data ?? []) as Snapshot["calls"])));
  }
  if (team.track === "FINANCE") {
    reads.push(
      sb.from("holdings").select("company_id, lot, qty").eq("team_id", team.id).then(({ data }) => void (s.holdings = (data ?? []) as Snapshot["holdings"])),
      sb.from("orders").select("company_id, type, qty").eq("team_id", team.id).eq("status", "PENDING").then(({ data }) => void (s.pendingOrders = data ?? [])),
      sb.from("ipo_bids").select("id", { count: "exact", head: true }).eq("team_id", team.id).then(({ count }) => void (s.ipoBids = count ?? 0)),
    );
  }
  await Promise.all(reads);
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
    for (const a of decide(s, this.memory, this.random, now, PHASE_CODES)) await this.act(a, s, now);
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
