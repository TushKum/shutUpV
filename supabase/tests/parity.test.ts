// "The database functions must use the same logic and match it exactly": every SQL port of an engine rule is compared
// with the TypeScript engine on generated inputs. Cases are evaluated in SQL in one batch per rule.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  RUBRICS,
  Rng,
  applyReveal,
  assignCrises,
  avgHalfUp,
  buyReserve,
  clearingPrice,
  closingPrice,
  crisisShock,
  dealProblemCards,
  divRoundHalfUp,
  finalScore,
  injectionPenalty,
  medianScore,
  mulRate,
  rescueCircle,
  returnBp,
  revealFactorBp,
  riseBp,
  rootSeed,
  round3Points,
  scorePrice,
  sha256Hex,
  startPrice,
  submissionText,
  submissionWords,
  validateDraft,
  validateJudgeOutput,
  validateOrder,
  wordCount,
  type OrderContext,
  type OrderRequest,
  type OrderType,
  type SubmissionType,
} from "@msim/engine";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

// Deterministic test-case generator (mulberry32).
function gen(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  return { next, int, pick };
}

/** Evaluates `expr` (using $1::jsonb as `c`) for every case in one query. */
async function sqlBatch<T = unknown>(expr: string, cases: unknown[]): Promise<T[]> {
  const { rows } = await (db.pool as pg.Pool).query(
    `select (${expr}) as r from jsonb_array_elements($1::jsonb) with ordinality as x(c, i) order by i`,
    [JSON.stringify(cases)],
  );
  return rows.map((r) => r.r as T);
}

const num = (v: unknown) => (v === null ? null : Number(v));
const TYPES: SubmissionType[] = ["PRD", "SOLUTION"];

describe("money", () => {
  test("div_round_half_up, mul_rate, avg_half_up", async () => {
    const g = gen(1);
    const cases = Array.from({ length: 3000 }, (_, i) => {
      const den = g.pick([1, 2, 3, 7, 10, 100, 10_000, 100_000, g.int(1, 1_000_000)]);
      // Exact ties are common in this game; make sure many cases sit on .5.
      const n = i % 3 === 0 ? den * g.int(-10_000_000, 10_000_000) + Math.floor(den / 2) * g.pick([1, -1]) : g.int(-1e12, 1e12);
      return { n, den, a: g.int(0, 1e9), b: g.int(0, 1e9), rn: g.int(1, 200), rd: g.pick([100, 1000, 10_000, 100_000]) };
    });
    const sql = await sqlBatch<unknown[]>(
      `jsonb_build_array(app.div_round_half_up((c->>'n')::numeric, (c->>'den')::numeric),
                         app.mul_rate((c->>'a')::numeric, (c->>'rn')::numeric, (c->>'rd')::numeric),
                         app.avg_half_up((c->>'a')::numeric, (c->>'b')::numeric))`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i]!.map(num), JSON.stringify(c)).toEqual([divRoundHalfUp(c.n, c.den), mulRate(c.a, c.rn, c.rd), avgHalfUp(c.a, c.b)]),
    );
  });
});

describe("prices", () => {
  test("start_price, reveal_factor_bp for every score; out-of-range scores are refused", async () => {
    const cases = Array.from({ length: 101 }, (_, score) => ({ score }));
    const sql = await sqlBatch<number[]>(`jsonb_build_array(app.start_price((c->>'score')::int), app.reveal_factor_bp((c->>'score')::int))`, cases);
    cases.forEach((c, i) => expect(sql[i]!.map(Number)).toEqual([startPrice(c.score), revealFactorBp(c.score)]));
    await expect(db.pool.query("select app.start_price(101)")).rejects.toThrow(/0–100/);
    await expect(db.pool.query("select app.reveal_factor_bp(-1)")).rejects.toThrow(/0–100/);
  });

  test("crisis_shock, apply_reveal, score_price, clearing_price, closing_price", async () => {
    const g = gen(2);
    const cases = Array.from({ length: 4000 }, () => ({
      price: g.int(1, 200_000),
      other: g.int(1, 200_000),
      score: g.int(0, 100),
      blind: g.next() < 0.2,
      net: g.pick([0, g.int(-25_000, 25_000), g.int(-500, 500), 10_000, -10_000, 10_001, -10_001]),
    }));
    const sql = await sqlBatch<number[]>(
      `jsonb_build_array(app.crisis_shock((c->>'price')::bigint),
                         app.apply_reveal((c->>'price')::bigint, (c->>'score')::int),
                         app.score_price((c->>'price')::bigint, case when (c->>'blind')::boolean then null else (c->>'score')::int end),
                         app.clearing_price((c->>'price')::bigint, (c->>'net')::bigint),
                         app.closing_price((c->>'price')::bigint, (c->>'other')::bigint))`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i]!.map(Number), JSON.stringify(c)).toEqual([
        crisisShock(c.price),
        applyReveal(c.price, c.score),
        scorePrice(c.price, c.blind ? null : c.score),
        clearingPrice(c.price, c.net),
        closingPrice(c.price, c.other),
      ]),
    );
  });
});

describe("order validation", () => {
  test("buy_reserve", async () => {
    const g = gen(3);
    const cases = Array.from({ length: 2000 }, () => ({ qty: g.int(1, 5000), price: g.int(1, 50_000) }));
    const sql = await sqlBatch<number>(`app.buy_reserve((c->>'qty')::bigint, (c->>'price')::bigint)`, cases);
    cases.forEach((c, i) => expect(Number(sql[i])).toBe(buyReserve(c.qty, c.price)));
  });

  test("check_order matches validateOrder on 6,000 generated contexts", async () => {
    const g = gen(5);
    const companies = ["A", "B", "C", "D", "E"];
    const types: OrderType[] = ["BUY", "SELL"];
    const cases = Array.from({ length: 6000 }, (_, n) => {
      const prices: Record<string, number> = {};
      for (const c of companies) prices[c] = g.pick([g.int(100, 3000), g.int(3000, 20_000), 1088]);
      const positions: Record<string, { qty: number; cost: number }> = {};
      for (const c of companies) {
        if (g.next() < 0.6) {
          const qty = g.pick([0, g.int(0, 5000), 5000]);
          positions[c] = { qty, cost: qty * g.int(500, 1500) };
        }
      }
      const pending = Array.from({ length: g.int(0, 6) }, (_, k) => {
        const companyId = g.pick(companies);
        const type = g.pick(types);
        const qty = g.int(1, 2500);
        return { id: `p${n}-${k}`, companyId, type, qty, reserve: type === "BUY" ? buyReserve(qty, prices[companyId]!) : 0 };
      });
      const ctx: OrderContext = {
        trading: g.next() < 0.9 ? "OPEN" : g.pick(["PAUSED", "HALTED"] as const),
        prices,
        trader: {
          cash: g.pick([g.int(0, 10_000_000), 10_000_000, g.int(0, 2_000_000)]),
          builtCompanyId: g.pick([...companies, null]),
          rescuedCompanyId: g.pick([...companies, null]),
          positions,
          pending,
        },
        ...(pending.length && g.next() < 0.2 ? { replacingOrderId: g.pick(pending).id } : {}),
      };
      const order: OrderRequest = {
        companyId: g.next() < 0.03 ? "Z" : g.pick(companies),
        type: g.pick(types),
        qty: g.pick([0, 1, g.int(1, 500), g.int(1, 5000), 1.5, 5001, 5000, 4000]),
      };
      return { ctx, order };
    });
    const sql = await sqlBatch<Record<string, unknown>>(`app.check_order(c->'ctx', c->'order')`, cases);
    const codes = new Map<string, number>();
    cases.forEach((c, i) => {
      const e = validateOrder(c.ctx, c.order);
      const expected = e.ok ? { ok: true, reserve: e.reserve, entryPrice: e.entryPrice } : { ok: false, code: e.code };
      codes.set(e.ok ? "OK" : e.code, (codes.get(e.ok ? "OK" : e.code) ?? 0) + 1);
      expect(sql[i], JSON.stringify(c)).toEqual(expected);
    });
    // The generator must reach every outcome, or the comparison proves little.
    expect([...codes.keys()].sort()).toEqual(
      ["BAD_QUANTITY", "HOLD_LIMIT", "INSUFFICIENT_CASH", "NOT_ENOUGH_SHARES", "NOT_LISTED", "OK", "OWN_COMPANY",
        "RESCUED_COMPANY", "TRADING_HALTED", "TRADING_PAUSED"].sort(),
    );
  });
});

describe("submission text, word counts and draft checks", () => {
  const samples = [
    "Snacks for humid towns — packs that stay crisp for 5 days.",
    "  leading and trailing\t\nspaces  ",
    "Crisp…  ...  — – - ( ) ! words only",
    "Unicode: café naïve 東京 राम ₹500 50% 3.5x",
    Array.from({ length: 50 }, () => "chai").join("​"),
    "soft­hyphen and word⁠joiner and nbsp here",
    "",
    "line one\r\nline two line three",
    Array.from({ length: 120 }, () => "w").join(" "),
    Array.from({ length: 260 }, () => "pack").join(" "),
  ];
  const fields = {
    PRD: ["company_name", "ticker", "problem", "target_user", "must_have", "should_have", "not_in_v1", "per_pack_maths", "go_to_market", "success_metrics", "risks"],
    SOLUTION: ["diagnosis", "three_options", "recommendation", "per_pack_maths", "timeline", "risks"],
  } as const;

  test("word_count matches wordCount", async () => {
    const sql = await sqlBatch<number>(`app.word_count(c->>'t')`, samples.map((t) => ({ t })));
    samples.forEach((t, i) => expect(sql[i], JSON.stringify(t)).toBe(wordCount(t)));
  });

  test("submission_text, submission_words and check_draft match the engine for both types", async () => {
    const g = gen(12);
    const cases = Array.from({ length: 1500 }, () => {
      const type = g.pick(TYPES);
      const content: Record<string, unknown> = {};
      for (const f of fields[type]) {
        const r = g.next();
        content[f] = r < 0.15 ? "" : r < 0.2 ? 42 : g.pick(samples) + (r < 0.5 ? "  " : "");
      }
      if (type === "PRD") {
        content.ticker = g.pick(["mlbt", "MLBT", " chai ", "ML1T", "MLB", "", "ABCDE"]);
        content.company_name = g.pick(["Masala Labs", "", "x".repeat(60), "x".repeat(61)]);
      }
      return { type, content };
    });
    const sql = await sqlBatch<unknown[]>(
      `jsonb_build_array(app.submission_text((c->>'type')::submission_type, c->'content'),
                         app.submission_words((c->>'type')::submission_type, c->'content'),
                         app.check_draft((c->>'type')::submission_type, c->'content'))`,
      cases,
    );
    const outcomes = new Set<string>();
    cases.forEach((c, i) => {
      const d = validateDraft(c.type, c.content);
      outcomes.add(d.ok ? "OK" : d.code);
      expect(sql[i], JSON.stringify(c)).toEqual([submissionText(c.type, c.content), submissionWords(c.type, c.content), d.ok ? null : d.code]);
    });
    expect([...outcomes].sort()).toEqual(["BAD_NAME", "BAD_TICKER", "OK", "TOO_LONG"]);
  });
});

describe("judging and scoring", () => {
  test("median_score", async () => {
    const g = gen(7);
    const cases = Array.from({ length: 1000 }, () => ({ t: [g.int(0, 100), g.int(0, 100), g.int(0, 100)] }));
    const sql = await sqlBatch<number>(`app.median_score(array(select jsonb_array_elements_text(c->'t')::int))`, cases);
    cases.forEach((c, i) => expect(sql[i]).toBe(medianScore(c.t)));
    await expect(db.pool.query("select app.median_score(array[1, 2])")).rejects.toThrow(/odd/);
  });

  test("judge_run_valid: a stored reading passes exactly when validateJudgeOutput accepts it", async () => {
    const g = gen(11);
    const cases = Array.from({ length: 3000 }, () => {
      const type = g.pick(TYPES);
      const breakdown: Record<string, unknown> = {};
      for (const line of RUBRICS[type]) breakdown[line.key] = g.int(0, line.max);
      let total = Object.values(breakdown).reduce((a: number, v) => a + (v as number), 0);
      let rationale = "Clear user, weak maths.";
      const key = g.pick(RUBRICS[type]).key;
      switch (g.int(0, 10)) {
        case 0: delete breakdown[key]; break;
        case 1: breakdown.extra_line = 5; break;
        case 2: breakdown[key] = g.pick(RUBRICS[type]).max + g.int(1, 30); break;
        case 3: breakdown[key] = -g.int(1, 5); break;
        case 4: breakdown[key] = (breakdown[key] as number) + 0.5; break;
        case 5: breakdown[key] = String(breakdown[key]); break;
        case 6: total += g.pick([-1, 1, 7]); break;
        case 7: rationale = g.pick(["", "   ", "\n\t"]); break;
        case 8: breakdown[key] = null; break;
        case 9: {
          // The other round's rubric.
          const other = type === "PRD" ? "SOLUTION" : "PRD";
          for (const k of Object.keys(breakdown)) delete breakdown[k];
          for (const line of RUBRICS[other]) breakdown[line.key] = g.int(0, line.max);
          total = Object.values(breakdown).reduce((a: number, v) => a + (v as number), 0);
          break;
        }
        default: break; // valid
      }
      return { type, breakdown, total, rationale };
    });
    const sql = await sqlBatch<boolean>(
      `app.judge_run_valid((c->>'type')::submission_type, c->'breakdown', (c->>'total')::int, c->>'rationale')`,
      cases,
    );
    let valid = 0;
    cases.forEach((c, i) => {
      const ts = validateJudgeOutput(c.type, { breakdown: c.breakdown, total: c.total, rationale: c.rationale }).ok;
      if (ts) valid++;
      expect(sql[i], JSON.stringify(c)).toBe(ts);
    });
    expect(valid).toBeGreaterThan(200);
    expect(valid).toBeLessThan(2800);
  });

  test("injection_penalty for every count of removed lines", async () => {
    const cases = TYPES.flatMap((type) => [0, 1, 2, 3].flatMap((prd) => [0, 1, 2, 3].map((solution) => ({ type, prd, solution }))));
    const sql = await sqlBatch<number>(
      `app.injection_penalty((c->>'type')::submission_type, (c->>'prd')::int, (c->>'solution')::int)`,
      cases,
    );
    cases.forEach((c, i) => expect(sql[i], JSON.stringify(c)).toBe(injectionPenalty(c.type, { PRD: c.prd, SOLUTION: c.solution })));
  });

  test("final_score", async () => {
    const g = gen(9);
    const cases = Array.from({ length: 2000 }, () => ({ median: g.next() < 0.1 ? null : g.int(0, 100), penalty: g.pick([0, 0, 10]) }));
    const sql = await sqlBatch<Record<string, unknown>>(`app.final_score((c->>'median')::int, (c->>'penalty')::int)`, cases);
    cases.forEach((c, i) => expect(sql[i]).toEqual(finalScore(c.median, c.penalty)));
  });

  test("return_bp, round3_points, rise_bp", async () => {
    const g = gen(10);
    const cases = Array.from({ length: 3000 }, (_, i) => ({
      value: i % 7 === 0 ? 10_000_000 + 4_000 * g.int(-2_500, 2_500) + 2_000 : g.int(0, 30_000_000), // ties at x.5 points
      post: g.int(1, 20_000),
      close: g.int(1, 30_000),
    }));
    const sql = await sqlBatch<number[]>(
      `jsonb_build_array(app.return_bp((c->>'value')::bigint, 10000000), app.round3_points((c->>'value')::bigint, 10000000),
                         app.rise_bp((c->>'post')::bigint, (c->>'close')::bigint))`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i]!.map(Number), JSON.stringify(c)).toEqual([returnBp(c.value), round3Points(c.value), riseBp(c.post, c.close)]),
    );
  });
});

describe("lottery", () => {
  test("sha256_hex and the generator's word stream", async () => {
    const { rows } = await db.pool.query("select app.sha256_hex('abc') as h, app.sha256_hex('primus-night' || '4') as r");
    expect(rows[0].h).toBe(sha256Hex("abc"));
    expect(rows[0].r).toBe(rootSeed("primus-night", "4"));

    const root = rootSeed("primus-night", "4");
    const rng = new Rng(root, "circle");
    const expected = Array.from({ length: 50 }, () => rng.nextUint32());
    const { rows: words } = await db.pool.query(
      `with recursive w(i, st, val) as (
         select 1, r.st, r.val from app.rng_uint32(app.rng_new($1, 'circle')) r
         union all
         select i + 1, r.st, r.val from w, lateral app.rng_uint32(w.st) r where i < 50)
       select val from w order by i`,
      [root],
    );
    expect(words.map((r) => Number(r.val))).toEqual(expected);
  });

  test("rng_int and rng_shuffle", async () => {
    const root = rootSeed("seed", "6");
    for (const n of [1, 2, 3, 6, 50, 150, 1000, 4_294_967_295]) {
      const rng = new Rng(root, "problems");
      const expected = Array.from({ length: 30 }, () => rng.int(n));
      const { rows } = await db.pool.query(
        `with recursive w(i, st, val) as (
           select 1, r.st, r.val from app.rng_int(app.rng_new($1, 'problems'), $2) r
           union all
           select i + 1, r.st, r.val from w, lateral app.rng_int(w.st, $2) r where i < 30)
         select val from w order by i`,
        [root, n],
      );
      expect(rows.map((r) => Number(r.val)), `n=${n}`).toEqual(expected);
    }
    const items = Array.from({ length: 150 }, (_, i) => `T${String(i + 1).padStart(3, "0")}`);
    const { rows } = await db.pool.query("select (app.rng_shuffle(app.rng_new($1, 'crisis'), $2)).result as r", [root, items]);
    expect(rows[0].r).toEqual(new Rng(root, "crisis").shuffle(items));
  });

  test.each([
    ["primus-night", "4", 150, 50],
    ["another seed", "12", 150, 60],
    ["rehearsal", "3", 8, 3],
    ["tiny", "1", 3, 1],
  ])("lottery_problems, lottery_crises and lottery_circle (%s, %s) with %i teams and %i cards match the engine", async (seed, dice, n, nCards) => {
    const root = rootSeed(seed, dice);
    const teams = Array.from({ length: n }, (_, i) => `T${String(i + 1).padStart(3, "0")}`);
    const cards = Array.from({ length: nCards }, (_, i) => String(i + 1));
    const deck = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), number: i + 1 }));
    const map = (rows: { a: string; b: string }[]) => Object.fromEntries(rows.map((r) => [r.a, r.b]));
    const problems = await db.pool.query("select team as a, card as b from app.lottery_problems($1, $2, $3)", [root, [...teams].reverse(), cards]);
    expect(map(problems.rows)).toEqual(Object.fromEntries(dealProblemCards(root, teams, cards)));
    const crises = await db.pool.query("select team as a, card as b from app.lottery_crises($1, $2, $3)", [root, teams, JSON.stringify([...deck].reverse())]);
    expect(map(crises.rows)).toEqual(Object.fromEntries(assignCrises(root, teams, deck)));
    const circle = await db.pool.query("select rescuer as a, founder as b from app.lottery_circle($1, $2)", [root, [...teams].reverse()]);
    expect(map(circle.rows)).toEqual(Object.fromEntries(rescueCircle(root, teams)));
  });

  test("the draws refuse what the engine refuses", async () => {
    const root = rootSeed("x", "1");
    await expect(db.pool.query("select * from app.lottery_problems($1, $2, $3)", [root, ["A", "B", "C", "D"], ["1"]])).rejects.toThrow(/at least 2 cards/);
    await expect(db.pool.query("select * from app.lottery_problems($1, $2, $3)", [root, ["A", "A"], ["1"]])).rejects.toThrow(/duplicate/);
    await expect(db.pool.query("select * from app.lottery_circle($1, $2)", [root, ["A"]])).rejects.toThrow(/at least 2/);
  });
});
