// The rehearsal bots' decisions (Phase 7). Pure: given what a team can see now and what it has already done, which
// game functions it calls next. The bots play through the same public functions as real teams, so every refusal
// (a closed window, a limit, a rate limit) is the game's own answer; a bot simply tries again later or moves on.
// The runner (scripts/lib/bot-runner.ts) reads the snapshot through RLS as the team and executes the actions.

import type { PhaseCode, SubmissionType, Track } from "@msim/engine";

// ───────────────────────────── Randomness (deterministic per team) ─────────────────────────────

/** mulberry32: a small seeded generator, so a rehearsal can be replayed. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ───────────────────────────── What a bot sees ─────────────────────────────

export interface BotCompany {
  id: string;
  ticker: string | null;
  squad_id: string | null;
  ipo_price: number | null;
  market_price: number | null;
  post_crisis_price: number | null;
}

export interface BotHolding {
  company_id: string;
  lot: "RETAINED" | "SQUAD" | "EXCHANGE" | "SHORT" | "FEE";
  qty: number;
}

export interface BotFee {
  version: number;
  cash_cents: number;
  shares: number;
  product_confirmed_at: string | null;
  consulting_confirmed_at: string | null;
  executed_at: string | null;
}

export interface BotDeal {
  version: number;
  amount_cents: number | null;
  price_cents: number | null;
  signed_product_at: string | null;
  signed_consulting_at: string | null;
  signed_finance_at: string | null;
  executed_at: string | null;
}

export interface BotCall {
  company_id: string;
  call_no: number;
  direction: "BUY" | "SELL" | null;
}

export interface Snapshot {
  phase: PhaseCode;
  /** OPEN, HALTED or PAUSED (event_status.trading). */
  trading: string;
  openRound: number | null;
  team: { id: string; code: string; track: Track; cash_cents: number };
  squad: { id: string; number: number; dealt_card_ids: string[]; chosen_card_id: string | null } | null;
  /** The squad's company. */
  companyId: string | null;
  drafts: Partial<Record<SubmissionType, number>>; // type → version
  submitted: Partial<Record<SubmissionType, boolean>>;
  fee: BotFee | null;
  deal: BotDeal | null;
  calls: BotCall[];
  companies: BotCompany[];
  holdings: BotHolding[];
  /** This team's PENDING orders in the open round. */
  pendingOrders: { company_id: string; type: string; qty: number }[];
  ipoBids: number;
}

/** What a bot remembers between turns. */
export interface Memory {
  done: Set<string>;
  /** Action key → time (ms) before which it is not tried again. */
  wait: Map<string, number>;
  /** Round numbers in which this fund has already placed its orders. */
  tradedRounds: Set<number>;
}

export const newMemory = (): Memory => ({ done: new Set(), wait: new Map(), tradedRounds: new Set() });

export type Action =
  | { key: string; fn: "pick_problem_card"; args: { p_card: string } }
  | { key: string; fn: "save_draft"; args: { p_type: SubmissionType; p_content: Record<string, string>; p_expected_version: number } }
  | { key: string; fn: "submit_submission"; args: { p_type: SubmissionType } }
  | { key: string; fn: "propose_fee"; args: { p_cash: number; p_shares: number } }
  | { key: string; fn: "confirm_fee"; args: { p_version: number } }
  | { key: string; fn: "edit_deal"; args: { p_amount?: number; p_price?: number } }
  | { key: string; fn: "sign_deal"; args: { p_version: number } }
  | { key: string; fn: "make_call"; args: { p_company: string; p_call_no: number; p_direction: "BUY" | "SELL" } }
  | { key: string; fn: "place_ipo_bid"; args: { p_company: string; p_qty: number } }
  | { key: string; fn: "place_order"; args: { p_company: string; p_type: "BUY" | "SELL" | "SHORT" | "COVER"; p_qty: number; p_client_ref: string } };

// ───────────────────────────── Content ─────────────────────────────

const SECTORS = ["water", "farming", "transport", "health", "education", "energy", "waste", "retail", "finance", "housing"];

/** A unique 3–4 letter ticker per squad: B + two letters from the squad number (BAA, BAB, …). */
export function tickerFor(squadNumber: number): string {
  const n = squadNumber - 1;
  return `B${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`;
}

export function pitchContent(squadNumber: number, r: () => number): Record<string, string> {
  const sector = pick(r, SECTORS);
  return {
    company_name: `Bot ${sector[0]!.toUpperCase()}${sector.slice(1)} ${squadNumber}`,
    ticker: tickerFor(squadNumber),
    problem: `Small towns lack reliable ${sector} services and lose money every month.`,
    solution: `A low-cost ${sector} service run from a phone app with local partners.`,
    customers: "Town councils and small businesses.",
    business_model: "A monthly subscription per site, plus a set-up fee.",
    advantage: "Half the price of today's options and ready in a week.",
    use_of_seed: "Hire two engineers and sign the first ten towns.",
  };
}

export function planContent(): Record<string, string> {
  return {
    crisis: "The crisis cuts our main supplier for a year.",
    new_plan: "License the software to partners while we change suppliers.",
    money: "Costs fall 20%; the deal funds six months.",
    deal: "The squad's fund invests at a discount for a stake.",
    time_to_recovery: "Nine months.",
    risks: "Partners may refuse; a second supplier may be late.",
    next_steps: "Sign two partners this week.",
  };
}

export const flashContent = (): Record<string, string> => ({ answer: "We cut costs and reach profit within 12 months with no new loans." });

// ───────────────────────────── Decisions ─────────────────────────────

const RESCUE: PhaseCode[] = ["CRISIS", "RESCUE_1", "BREAK", "RESCUE_2"];
const order = (p: PhaseCode, from: PhaseCode, to: PhaseCode, phases: readonly PhaseCode[]) =>
  phases.indexOf(p) >= phases.indexOf(from) && phases.indexOf(p) <= phases.indexOf(to);

/** The next actions of a team, most important first. `now` is used only to respect back-offs. */
export function decide(s: Snapshot, m: Memory, r: () => number, now: number, phases: readonly PhaseCode[]): Action[] {
  const out: Action[] = [];
  const ready = (key: string) => !m.done.has(key) && (m.wait.get(key) ?? 0) <= now;
  const add = (a: Action) => {
    if (ready(a.key)) out.push(a);
  };
  const track = s.team.track;
  const p = s.phase;

  // Squad work: problem card and pitch (Product), plan (Product), flash answer (Product).
  if (track === "PRODUCT" && s.squad) {
    if (order(p, "SQUAD_DRAW", "BUILD", phases)) {
      if (!s.squad.chosen_card_id && s.squad.dealt_card_ids.length) add({ key: "pick", fn: "pick_problem_card", args: { p_card: pick(r, s.squad.dealt_card_ids) } });
      submission(add, s, "PITCH", () => pitchContent(s.squad!.number, r));
    }
    if (RESCUE.includes(p)) submission(add, s, "PLAN", planContent);
    if (p === "ROUNDS_13_21") submission(add, s, "FLASH", flashContent);
  }

  // The advisor's fee (Consulting proposes $20,000 cash; both confirm).
  if ((track === "PRODUCT" || track === "CONSULTING") && RESCUE.includes(p) && s.fee && !s.fee.executed_at) {
    const proposed = s.fee.version > 1;
    if (!proposed && track === "CONSULTING") add({ key: "fee-propose", fn: "propose_fee", args: { p_cash: 2_000_000, p_shares: 0 } });
    const mine = track === "PRODUCT" ? s.fee.product_confirmed_at : s.fee.consulting_confirmed_at;
    if (proposed && !mine) add({ key: `fee-confirm-${s.fee.version}`, fn: "confirm_fee", args: { p_version: s.fee.version } });
  }

  // The rescue deal: Consulting sets the price (75% of the post-crisis price), Finance the amount ($60,000); all sign.
  if (RESCUE.includes(p) && s.deal && !s.deal.executed_at && s.squad) {
    const company = s.companies.find((c) => c.id === s.companyId);
    if (track === "CONSULTING" && s.deal.price_cents === null && company?.post_crisis_price) {
      add({ key: "deal-price", fn: "edit_deal", args: { p_price: Math.max(1, Math.round(company.post_crisis_price * 0.75)) } });
    }
    if (track === "FINANCE" && s.deal.amount_cents === null) add({ key: "deal-amount", fn: "edit_deal", args: { p_amount: 6_000_000 } });
    const signed = track === "PRODUCT" ? s.deal.signed_product_at : track === "CONSULTING" ? s.deal.signed_consulting_at : s.deal.signed_finance_at;
    if (s.deal.price_cents !== null && s.deal.amount_cents !== null && !signed) {
      add({ key: `deal-sign-${s.deal.version}`, fn: "sign_deal", args: { p_version: s.deal.version } });
    }
  }

  // Consultant calls: every unmade call is tried (the database says when its window is open).
  if (track === "CONSULTING") {
    for (const c of s.calls) {
      if (c.direction === null) add({ key: `call-${c.company_id}-${c.call_no}`, fn: "make_call", args: { p_company: c.company_id, p_call_no: c.call_no, p_direction: r() < 0.5 ? "BUY" : "SELL" } });
    }
  }

  if (track === "FINANCE") {
    const others = s.companies.filter((c) => c.squad_id !== null && c.squad_id !== s.squad?.id);
    if (p === "IPO" && s.ipoBids === 0 && !m.done.has("ipo")) {
      for (const a of ipoBids(others, s.team.cash_cents, r)) add(a);
    }
    if (s.trading === "OPEN" && s.openRound !== null && !m.tradedRounds.has(s.openRound)) {
      for (const a of roundOrders(s, others, r)) out.push(a);
    }
  }
  return out;
}

function submission(add: (a: Action) => void, s: Snapshot, type: SubmissionType, content: () => Record<string, string>) {
  if (s.submitted[type]) return;
  const version = s.drafts[type];
  if (version === undefined) return;
  add({ key: `save-${type}`, fn: "save_draft", args: { p_type: type, p_content: content(), p_expected_version: version } });
  add({ key: `submit-${type}`, fn: "submit_submission", args: { p_type: type } });
}

/** IPO bids: 4–8 other companies, 500–2,000 shares each, within 60% of the fund's cash at IPO prices. */
export function ipoBids(companies: BotCompany[], cash: number, r: () => number): Action[] {
  const priced = companies.filter((c) => c.ipo_price);
  const out: Action[] = [];
  let budget = Math.floor(cash * 0.6);
  const n = Math.min(priced.length, between(r, 4, 8));
  const chosen = [...priced].sort(() => r() - 0.5).slice(0, n);
  for (const c of chosen) {
    const qty = Math.min(between(r, 5, 20) * 100, Math.floor(budget / c.ipo_price! / 10) * 10, 4000);
    if (qty < 10) break;
    budget -= qty * c.ipo_price!;
    out.push({ key: `ipo-${c.id}`, fn: "place_ipo_bid", args: { p_company: c.id, p_qty: qty } });
  }
  return out;
}

/**
 * A fund's orders for one round: 1–3 orders. Buys stay within a fifth of its cash and the 4,000-share long cap;
 * sells take part of what it holds on the exchange lot; now and then a small short within the 2,000 cap.
 */
export function roundOrders(s: Snapshot, companies: BotCompany[], r: () => number, count = between(r, 1, 3)): Action[] {
  const priced = companies.filter((c) => c.market_price);
  if (!priced.length) return [];
  const held = (id: string, lot: BotHolding["lot"]) => s.holdings.filter((h) => h.company_id === id && h.lot === lot).reduce((a, h) => a + h.qty, 0);
  // Pending orders, including the ones planned in this turn.
  const planned = s.pendingOrders.map((o) => ({ ...o }));
  const pending = (id: string, type: string) => planned.filter((o) => o.company_id === id && o.type === type).reduce((a, o) => a + o.qty, 0);
  const out: Action[] = [];
  const plan = (company: string, type: "BUY" | "SELL" | "SHORT", qty: number, i: number, ref: string) => {
    planned.push({ company_id: company, type, qty });
    out.push({ key: `order-${s.openRound}-${i}`, fn: "place_order", args: { p_company: company, p_type: type, p_qty: qty, p_client_ref: ref } });
  };
  let cash = s.team.cash_cents;
  for (let i = 0; i < count; i++) {
    const c = pick(r, priced);
    const price = c.market_price!;
    const roll = r();
    const ref = `bot-${s.openRound}-${i}`;
    const exchange = held(c.id, "EXCHANGE");
    if (roll < 0.35 && exchange - pending(c.id, "SELL") >= 10) {
      const qty = Math.max(10, Math.floor((exchange - pending(c.id, "SELL")) * (0.2 + r() * 0.5) / 10) * 10);
      plan(c.id, "SELL", qty, i, ref);
    } else if (roll < 0.45 && held(c.id, "SHORT") + pending(c.id, "SHORT") < 1500) {
      plan(c.id, "SHORT", between(r, 1, 5) * 100, i, ref);
    } else {
      const room = 4000 - exchange - held(c.id, "SQUAD") - pending(c.id, "BUY");
      const affordable = Math.floor(cash / 5 / price / 10) * 10;
      const qty = Math.min(room, affordable, between(r, 1, 10) * 100);
      if (qty < 10) continue;
      cash -= qty * price;
      plan(c.id, "BUY", qty, i, ref);
    }
  }
  return out;
}

/** Refusal codes that mean "not now" (try again later) rather than "never". */
export const LATER = new Set(["RATE_LIMITED", "NOT_OPEN", "WINDOW_CLOSED", "TRADING_HALTED", "TRADING_PAUSED", "NOT_YET", "WRONG_PHASE", "STALE_VERSION", "VERSION_CONFLICT"]);

/** What a refusal means for the memory: done (never again), or wait and retry. */
export function remember(m: Memory, a: Action, result: { ok: boolean; code?: string }, now: number, s: Snapshot) {
  if (result.ok) {
    m.done.add(a.key);
    if (a.fn === "place_ipo_bid") m.done.add("ipo");
    if (a.fn === "place_order" && s.openRound !== null) m.tradedRounds.add(s.openRound);
    return;
  }
  if (a.fn === "place_order" && s.openRound !== null) m.tradedRounds.add(s.openRound); // one try per round
  if (result.code && !LATER.has(result.code) && (result.code.includes("DEADLINE") || result.code.startsWith("ALREADY"))) {
    m.done.add(a.key);
    return;
  }
  m.wait.set(a.key, now + (result.code === "RATE_LIMITED" ? 5_000 : 15_000));
}
