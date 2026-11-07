// The rehearsal bots' decisions. Pure: given what a team can see now and what it has already done, which game
// functions it calls next. Bots play through the same public functions as real teams, so every refusal (a closed
// window, a limit, a version conflict, a rate limit) is the game's own answer; a bot simply tries again later or
// moves on. The runner (scripts/lib/bot-runner.ts) reads the snapshot through RLS as the team and executes the
// actions. Every team plays all three rounds: a PRD (21:15–23:00), the Q&A board and a crisis solution
// (23:45–01:45), and orders in every trading round (02:15–04:30).

import { RULES, type PhaseCode, type SubmissionType } from "@msim/engine";

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
  founder_team_id: string;
  rescuer_team_id: string | null;
  market_price: number | null;
}

export interface Snapshot {
  phase: PhaseCode;
  /** OPEN, HALTED or PAUSED (event_status.trading). */
  trading: string;
  openRound: number | null;
  paused: boolean;
  team: { id: string; code: string; index: number; cash_cents: number };
  drawn: boolean;
  crisisApplied: boolean;
  /** Saved versions of the team's drafts (0 when none). */
  drafts: Record<SubmissionType, number>;
  companies: BotCompany[];
  /** Shares the team owns, by company. */
  holdings: Record<string, number>;
  /** Questions about the company the team built that have no answer yet. */
  unanswered: string[];
  /** Questions this team asked. */
  asked: number;
  /** This team's PENDING orders (only the open round has any). */
  pendingOrders: number;
}

/** What a bot remembers between turns. */
export interface Memory {
  done: Set<string>;
  /** Action key → time (ms) before which it is not tried again. */
  wait: Map<string, number>;
  /** Round numbers in which this team has already placed its orders. */
  tradedRounds: Set<number>;
}

export const newMemory = (): Memory => ({ done: new Set(), wait: new Map(), tradedRounds: new Set() });

export type Action =
  | { key: string; fn: "save_draft"; args: { p_type: SubmissionType; p_content: Record<string, string>; p_expected_version: number } }
  | { key: string; fn: "post_question"; args: { p_body: string } }
  | { key: string; fn: "answer_question"; args: { p_question: string; p_body: string } }
  | { key: string; fn: "place_order"; args: { p_company: string; p_type: "BUY" | "SELL"; p_qty: number; p_client_ref: string } };

// ───────────────────────────── Content ─────────────────────────────

const SECTORS = ["water", "farming", "transport", "health", "education", "energy", "waste", "retail", "snacks", "housing"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A unique four-letter ticker per team: B + three letters from its index (BAAA, BAAB, …). */
export function tickerFor(index: number): string {
  const n = index;
  return `B${LETTERS[Math.floor(n / 676) % 26]}${LETTERS[Math.floor(n / 26) % 26]}${LETTERS[n % 26]}`;
}

/**
 * A PRD of a believable length; its quality (how much of it is filled in, with numbers or not) varies by team, so
 * the fake judge (which hashes the text) and a real one both give a spread of scores.
 */
export function prdContent(index: number, r: () => number, draft: number): Record<string, string> {
  const sector = pick(r, SECTORS);
  const town = pick(r, ["Udupi", "Alappuzha", "Nashik", "Madurai", "Guwahati", "Indore"]);
  const strong = r() < 0.5;
  const c: Record<string, string> = {
    company_name: `Bot ${sector[0]!.toUpperCase()}${sector.slice(1)} ${index + 1}`,
    ticker: tickerFor(index),
    problem: strong
      ? `In ${town}, ${between(r, 20, 80)} small ${sector} businesses we spoke to lose about Rs ${between(r, 500, 3000)} a month to the problem on our card.`
      : `People in ${town} have a ${sector} problem.`,
    target_user: `Owners of small ${sector} businesses in ${town}.`,
    must_have: `A low-cost ${sector} service run from a phone app with local partners.`,
    per_pack_maths: strong ? `Price Rs ${between(r, 40, 90)}, cost Rs ${between(r, 20, 39)}, margin per unit about Rs ${between(r, 10, 40)}.` : "",
    go_to_market: "Start with ten shops through a local distributor.",
    risks: draft > 1 ? "The twist may raise our costs; we would switch to paper packaging." : "Copycats.",
  };
  if (strong) {
    c.should_have = "A monthly report for each owner.";
    c.not_in_v1 = "Home delivery.";
    c.success_metrics = `${between(r, 20, 60)} paying shops by week 8.`;
  }
  return c;
}

export function solutionContent(index: number, r: () => number): Record<string, string> {
  const strong = r() < 0.5;
  return {
    diagnosis: "The crisis cuts the company's main input; without it the product stops within two weeks.",
    three_options: strong ? "A: a far supplier at a higher price. B: raise prices. C: two local suppliers after a trial." : "Find a new supplier.",
    recommendation: strong ? "C, with A as a three-week bridge." : "Find a supplier quickly.",
    per_pack_maths: strong ? `Cost rises Rs ${between(r, 10, 40)} a unit; price up Rs ${between(r, 5, 20)}; margin stays positive.` : "",
    timeline: strong ? "Week 1 bridge order; week 3 contracts; week 4 first local supply." : "Soon.",
    risks: `Quality may vary (team ${index + 1}): weekly checks.`,
  };
}

// ───────────────────────────── Decisions ─────────────────────────────

const WRITING_PRD: readonly PhaseCode[] = ["BRIEFING", "BUILD"];
const WRITING_SOLUTION: readonly PhaseCode[] = ["CRISIS_QA", "RESCUE"];

/** The next actions of a team, most important first. `now` is used only to respect back-offs. */
export function decide(s: Snapshot, m: Memory, r: () => number, now: number, nonce: () => string): Action[] {
  const out: Action[] = [];
  const ready = (key: string) => !m.done.has(key) && (m.wait.get(key) ?? 0) <= now;
  const add = (a: Action) => {
    if (ready(a.key)) out.push(a);
  };
  if (s.paused) return out;
  const p = s.phase;
  const built = s.companies.find((c) => c.founder_team_id === s.team.id) ?? null;
  const rescued = s.companies.find((c) => c.rescuer_team_id === s.team.id) ?? null;

  // Round 1: a first PRD, then one revision (as a team improves its draft before the lock).
  if (s.drawn && WRITING_PRD.includes(p)) {
    for (const draft of [1, 2]) {
      if (s.drafts.PRD === draft - 1) add({ key: `prd-${draft}`, fn: "save_draft", args: { p_type: "PRD", p_content: prdContent(s.team.index, r, draft), p_expected_version: s.drafts.PRD } });
    }
  }

  // The crisis: the rescuer asks the founders one question; founders answer what they are asked.
  if (s.crisisApplied && p === "CRISIS_QA" && rescued && s.asked === 0) {
    add({ key: "ask", fn: "post_question", args: { p_body: `What does your ${rescued.ticker ?? "company"} pay per unit for its main input today, and who supplies it?` } });
  }
  if (s.crisisApplied && WRITING_SOLUTION.includes(p)) {
    for (const q of s.unanswered.slice(0, 2)) {
      add({ key: `answer-${q}`, fn: "answer_question", args: { p_question: q, p_body: "About Rs 400 a unit, from one supplier in the next district; we have no second source yet." } });
    }
    if (rescued && s.drafts.SOLUTION === 0) {
      add({ key: "solution", fn: "save_draft", args: { p_type: "SOLUTION", p_content: solutionContent(s.team.index, r), p_expected_version: 0 } });
    }
  }

  // Round 3: a few orders in every open round.
  if (s.trading === "OPEN" && s.openRound !== null && !m.tradedRounds.has(s.openRound) && s.pendingOrders === 0) {
    for (const a of roundOrders(s, built?.id ?? null, rescued?.id ?? null, r, nonce)) out.push(a);
  }
  return out;
}

/**
 * One round's orders: sell part of a holding now and then, and buy 1–3 other companies, 100–1,500 shares each,
 * within 80% of the cash (a buy reserves price × 1.10) and the 5,000-share limit. Never the built or rescued company.
 */
export function roundOrders(s: Snapshot, builtId: string | null, rescuedId: string | null, r: () => number, nonce: () => string): Action[] {
  const round = s.openRound!;
  const tradable = s.companies.filter((c) => c.market_price && c.id !== builtId && c.id !== rescuedId);
  const out: Action[] = [];
  const held = Object.entries(s.holdings).filter(([, q]) => q > 0);
  if (held.length && r() < 0.4) {
    const [company, qty] = pick(r, held);
    const sell = Math.max(1, Math.floor(qty * (0.2 + r() * 0.6)));
    out.push({ key: `r${round}-sell-${company}`, fn: "place_order", args: { p_company: company, p_type: "SELL", p_qty: sell, p_client_ref: ref(nonce(), company, "SELL", sell) } });
  }
  let budget = Math.floor(s.team.cash_cents * 0.8);
  const n = between(r, 1, 3);
  const chosen = new Set<string>();
  for (let i = 0; i < n && tradable.length; i++) {
    const c = pick(r, tradable);
    if (chosen.has(c.id)) continue;
    chosen.add(c.id);
    const room = RULES.HOLD_LIMIT - (s.holdings[c.id] ?? 0);
    const affordable = Math.floor(budget / Math.ceil((c.market_price! * RULES.RESERVE_PCT) / 100));
    const qty = Math.min(room, affordable, between(r, 1, 15) * 100);
    if (qty < 1) continue;
    budget -= Math.ceil((qty * c.market_price! * RULES.RESERVE_PCT) / 100);
    out.push({ key: `r${round}-buy-${c.id}`, fn: "place_order", args: { p_company: c.id, p_type: "BUY", p_qty: qty, p_client_ref: ref(nonce(), c.id, "BUY", qty) } });
  }
  return out;
}

/** The order's client reference, in the format place_order accepts (nonce|company|type|qty). */
export const ref = (nonce: string, company: string, type: "BUY" | "SELL", qty: number) => `${nonce}|${company}|${type}|${qty}`;

/** After an action: done for good, try again later, or (orders) the round is traded. */
export function remember(m: Memory, a: Action, r: { ok: boolean; code?: string }, now: number, s: Pick<Snapshot, "openRound">) {
  if (a.fn === "place_order") {
    if (s.openRound !== null) m.tradedRounds.add(s.openRound);
    return;
  }
  if (r.ok || ["ALREADY", "TICKER_TAKEN", "TOO_LONG"].includes(r.code ?? "")) {
    m.done.add(a.key);
    return;
  }
  // A closed window, a version conflict or a rate limit: look again in a while.
  m.wait.set(a.key, now + (r.code === "RATE_LIMITED" ? 10_000 : 4_000));
}
