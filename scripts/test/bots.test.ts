import { describe, expect, test } from "vitest";
import { PHASE_CODES, type PhaseCode, type Track } from "@msim/engine";
import { decide, ipoBids, newMemory, remember, rng, roundOrders, tickerFor, type BotCompany, type Snapshot } from "../lib/bots";

const company = (i: number, extra: Partial<BotCompany> = {}): BotCompany => ({
  id: `c${i}`, ticker: tickerFor(i), squad_id: `s${i}`, ipo_price: 1000, market_price: 1000, post_crisis_price: 850, ...extra,
});

function snap(track: Track, phase: PhaseCode, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    phase, trading: "HALTED", openRound: null,
    team: { id: "t1", code: "XP01", track, cash_cents: 50_000_000 },
    squad: { id: "s1", number: 1, dealt_card_ids: ["a", "b", "c"], chosen_card_id: null },
    companyId: "c1", drafts: { PITCH: 0, PLAN: 0, FLASH: 0 }, submitted: {}, fee: null, deal: null, calls: [],
    companies: Array.from({ length: 10 }, (_, i) => company(i + 1)), holdings: [], pendingOrders: [], ipoBids: 0, flashPublished: false,
    ...extra,
  };
}

const fns = (s: Snapshot, m = newMemory()) => decide(s, m, rng("x"), 0, PHASE_CODES).map((a) => a.fn);

describe("decide", () => {
  test("Product in BUILD picks a dealt card, then saves and submits its pitch", () => {
    expect(fns(snap("PRODUCT", "BUILD"))).toEqual(["pick_problem_card", "save_draft", "submit_submission"]);
    expect(fns(snap("PRODUCT", "BUILD", { squad: { id: "s1", number: 1, dealt_card_ids: ["a"], chosen_card_id: "a" }, submitted: { PITCH: true } }))).toEqual([]);
  });

  test("the flash answer waits for the flash bulletin", () => {
    expect(fns(snap("PRODUCT", "ROUNDS_13_21"))).toEqual([]);
    expect(fns(snap("PRODUCT", "ROUNDS_13_21", { flashPublished: true }))).toEqual(["save_draft", "submit_submission"]);
  });

  test("the fee: Consulting proposes $20,000; then both confirm the proposed version", () => {
    const fee = { version: 1, cash_cents: 0, shares: 0, product_confirmed_at: null, consulting_confirmed_at: null, executed_at: null };
    expect(fns(snap("CONSULTING", "CRISIS", { fee }))).toEqual(["propose_fee"]);
    expect(fns(snap("PRODUCT", "CRISIS", { fee, drafts: {}, submitted: {} }))).toEqual([]);
    const proposed = { ...fee, version: 2, cash_cents: 2_000_000 };
    expect(fns(snap("PRODUCT", "RESCUE_1", { fee: proposed, drafts: {} }))).toEqual(["confirm_fee"]);
  });

  test("the deal: Consulting prices it at 75% of the post-crisis price, Finance sets $60,000, all three sign", () => {
    const deal = { version: 1, amount_cents: null, price_cents: null, signed_product_at: null, signed_consulting_at: null, signed_finance_at: null, executed_at: null };
    const c = decide(snap("CONSULTING", "RESCUE_2", { deal, drafts: {} }), newMemory(), rng("x"), 0, PHASE_CODES);
    expect(c).toContainEqual(expect.objectContaining({ fn: "edit_deal", args: { p_price: 638 } }));
    expect(fns(snap("FINANCE", "RESCUE_2", { deal }))).toEqual(["edit_deal"]);
    const agreed = { ...deal, version: 3, amount_cents: 6_000_000, price_cents: 638 };
    expect(fns(snap("FINANCE", "RESCUE_2", { deal: agreed }))).toEqual(["sign_deal"]);
  });

  test("a fund trades once per open round; never its own squad's company", () => {
    const s = snap("FINANCE", "ROUNDS_1_4", { trading: "OPEN", openRound: 3 });
    const m = newMemory();
    const actions = decide(s, m, rng("fund"), 0, PHASE_CODES);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.fn === "place_order" && a.args.p_company !== "c1")).toBe(true);
    remember(m, actions[0]!, { ok: true }, 0, s);
    expect(decide(s, m, rng("fund"), 0, PHASE_CODES)).toEqual([]);
  });

  test("a refusal that means 'not now' waits; a passed deadline is never tried again", () => {
    const s = snap("PRODUCT", "BUILD");
    const m = newMemory();
    const [pick] = decide(s, m, rng("x"), 0, PHASE_CODES);
    remember(m, pick!, { ok: false, code: "RATE_LIMITED" }, 1000, s);
    expect(fns(s, m)).not.toContain("pick_problem_card");
    expect(decide(s, m, rng("x"), 7000, PHASE_CODES).map((a) => a.fn)).toContain("pick_problem_card");
    remember(m, pick!, { ok: false, code: "DEADLINE_PASSED" }, 7000, s);
    expect(decide(s, m, rng("x"), 1e9, PHASE_CODES).map((a) => a.fn)).not.toContain("pick_problem_card");
  });
});

describe("limits", () => {
  test("tickers are unique 3-letter codes for 50 squads", () => {
    const all = Array.from({ length: 50 }, (_, i) => tickerFor(i + 1));
    expect(new Set(all).size).toBe(50);
    expect(all.every((t) => /^[A-Z]{3,4}$/.test(t))).toBe(true);
  });

  test("IPO bids stay within 60% of the cash, at most 4,000 shares each, in tens", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const bids = ipoBids(Array.from({ length: 12 }, (_, i) => company(i + 2)), 50_000_000, rng(seed));
      const spent = bids.reduce((a, b) => a + (b.args as { p_qty: number }).p_qty * 1000, 0);
      expect(spent).toBeLessThanOrEqual(30_000_000);
      expect(bids.every((b) => { const q = (b.args as { p_qty: number }).p_qty; return q % 10 === 0 && q <= 4000 && q >= 10; })).toBe(true);
    }
  });

  test("orders respect the 4,000 long cap and sell only what is held", () => {
    const s = snap("FINANCE", "ROUNDS_1_4", {
      trading: "OPEN", openRound: 2, companies: [company(2)],
      holdings: [{ company_id: "c2", lot: "EXCHANGE", qty: 3990 }],
    });
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      for (const o of roundOrders(s, s.companies, rng(seed), 3)) {
        const a = o.args as { p_type: string; p_qty: number };
        if (a.p_type === "BUY") expect(a.p_qty).toBeLessThanOrEqual(10);
        if (a.p_type === "SELL") expect(a.p_qty).toBeLessThanOrEqual(3990);
      }
    }
  });
});
