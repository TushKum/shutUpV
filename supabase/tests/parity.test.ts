// "Database functions must use the same logic": every SQL port of an engine rule is compared with the
// TypeScript engine on thousands of generated inputs. Cases are evaluated in SQL in one batch per rule.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  Rng,
  allocateIpo,
  applyTier,
  avgHalfUp,
  buyReserve,
  clearingPrice,
  crisisShock,
  dealPriceBand,
  divRoundHalfUp,
  drawLottery,
  assignCrises,
  finalScore,
  floorDiv,
  injectionPenalty,
  ipoPrice,
  judgeCall,
  medianScore,
  mulRate,
  needsExtraRuns,
  planBonus,
  returnBp,
  rootSeed,
  sha256Hex,
  shortCollateral,
  shortReserve,
  tierBp,
  validateDeal,
  validateDealTerms,
  validateFee,
  validateOrder,
  validateIpoBids,
  validateJudgeOutput,
  RUBRICS,
  submissionText,
  submissionWords,
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

describe("money", () => {
  test("div_round_half_up, floor_div, mul_rate, avg_half_up", async () => {
    const g = gen(1);
    const cases = Array.from({ length: 3000 }, (_, i) => {
      const den = g.pick([1, 2, 3, 7, 10, 100, 10_000, 100_000, g.int(1, 1_000_000)]);
      // Exact ties are common in this game; make sure many cases sit on .5.
      const num = i % 3 === 0 ? den * g.int(-10_000_000, 10_000_000) + Math.floor(den / 2) * g.pick([1, -1]) : g.int(-1e12, 1e12);
      return { num, den, a: g.int(0, 1e9), b: g.int(0, 1e9), rn: g.int(1, 200), rd: g.pick([100, 1000, 10_000, 100_000]) };
    });
    const sql = await sqlBatch<string>(
      `jsonb_build_array(app.div_round_half_up((c->>'num')::numeric, (c->>'den')::numeric),
                         case when (c->>'num')::numeric >= 0 then app.floor_div((c->>'num')::numeric, (c->>'den')::numeric) end,
                         app.mul_rate((c->>'a')::numeric, (c->>'rn')::numeric, (c->>'rd')::numeric),
                         app.avg_half_up((c->>'a')::numeric, (c->>'b')::numeric))`,
      cases,
    );
    cases.forEach((c, i) => {
      const expected = [
        divRoundHalfUp(c.num, c.den),
        c.num >= 0 ? floorDiv(c.num, c.den) : null,
        mulRate(c.a, c.rn, c.rd),
        avgHalfUp(c.a, c.b),
      ];
      expect((sql[i] as unknown as unknown[]).map(num), JSON.stringify(c)).toEqual(expected);
    });
  });
});

describe("prices", () => {
  test("tier_bp, ipo_price for every score and type", async () => {
    const cases = (["PITCH", "PLAN", "FLASH"] as SubmissionType[]).flatMap((type) =>
      Array.from({ length: 101 }, (_, score) => ({ type, score })),
    );
    const sql = await sqlBatch<number[]>(
      `jsonb_build_array(app.tier_bp((c->>'type')::submission_type, (c->>'score')::int), app.ipo_price((c->>'score')::int))`,
      cases,
    );
    cases.forEach((c, i) => expect(sql[i]!.map(Number)).toEqual([tierBp(c.type, c.score), ipoPrice(c.score)]));
    await expect(db.pool.query("select app.tier_bp('PLAN', 101)")).rejects.toThrow(/0–100/);
  });

  test("apply_tier, clearing_price, crisis_shock", async () => {
    const g = gen(2);
    const bps = [2500, 2000, 1000, 500, 0, -500, -1000, -2000];
    const cases = Array.from({ length: 3000 }, () => ({
      price: g.int(1, 200_000),
      bp: g.pick(bps),
      net: g.pick([0, g.int(-25_000, 25_000), g.int(-500, 500), 10_000, -10_000, 10_001, -10_001]),
    }));
    const sql = await sqlBatch<number[]>(
      `jsonb_build_array(app.apply_tier((c->>'price')::bigint, (c->>'bp')::int),
                         app.clearing_price((c->>'price')::bigint, (c->>'net')::bigint),
                         app.crisis_shock((c->>'price')::bigint))`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i]!.map(Number), JSON.stringify(c)).toEqual([applyTier(c.price, c.bp), clearingPrice(c.price, c.net), crisisShock(c.price)]),
    );
  });

  test("reserves and collateral", async () => {
    const g = gen(3);
    const cases = Array.from({ length: 2000 }, () => ({ qty: g.int(1, 100_000), price: g.int(1, 100_000) }));
    const sql = await sqlBatch<number[]>(
      `jsonb_build_array(app.buy_reserve((c->>'qty')::bigint, (c->>'price')::bigint),
                         app.short_reserve((c->>'qty')::bigint, (c->>'price')::bigint),
                         app.short_collateral((c->>'qty')::bigint, (c->>'price')::bigint))`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i]!.map(Number)).toEqual([buyReserve(c.qty, c.price), shortReserve(c.qty, c.price), shortCollateral(c.qty, c.price)]),
    );
  });
});

describe("IPO allocation", () => {
  test("every request in 300 random books", async () => {
    const g = gen(4);
    const books = Array.from({ length: 300 }, () => Array.from({ length: g.int(0, 49) }, () => ({ qty: g.int(0, 4000) })));
    const cases = books.flatMap((book, b) => {
      const total = book.reduce((s, r) => s + r.qty, 0);
      return allocateIpo(book).map((r) => ({ b, qty: r.qty, total, expected: r.allocated }));
    });
    const sql = await sqlBatch<string>(`app.ipo_allocation((c->>'qty')::bigint, 35000, (c->>'total')::bigint)`, cases);
    cases.forEach((c, i) => expect(Number(sql[i]), JSON.stringify(c)).toBe(c.expected));
  });
});

describe("order validation", () => {
  test("check_order matches validateOrder on 5,000 generated contexts", async () => {
    const g = gen(5);
    const companies = ["A", "B", "C", "D", "E"];
    const types: OrderType[] = ["BUY", "SELL", "SHORT", "COVER"];
    const cases = Array.from({ length: 5000 }, (_, n) => {
      const prices: Record<string, number> = {};
      for (const c of companies) prices[c] = g.pick([g.int(100, 3000), g.int(3000, 20_000), 12_500]);
      const positions: Record<string, { exchangeQty: number; shortQty: number }> = {};
      for (const c of companies) {
        if (g.next() < 0.6) positions[c] = { exchangeQty: g.pick([0, g.int(0, 4000), 4000]), shortQty: g.pick([0, g.int(0, 2000), 2000]) };
      }
      const pending = Array.from({ length: g.int(0, 6) }, (_, k) => {
        const companyId = g.pick(companies);
        const type = g.pick(types);
        const qty = g.int(1, 1500);
        const reserve = type === "BUY" ? buyReserve(qty, prices[companyId]!) : type === "SHORT" ? shortReserve(qty, prices[companyId]!) : 0;
        return { id: `p${n}-${k}`, companyId, type, qty, reserve };
      });
      const cash = g.pick([g.int(0, 60_000_000), 50_000_000, g.int(0, 2_000_000)]);
      const ctx: OrderContext = {
        trading: g.next() < 0.9 ? "OPEN" : g.pick(["PAUSED", "HALTED"] as const),
        prices,
        fund: {
          track: g.next() < 0.93 ? "FINANCE" : g.pick(["PRODUCT", "CONSULTING"] as const),
          cash,
          collateral: g.pick([0, g.int(0, cash + 1_000_000)]),
          squadCompanyId: g.pick([...companies, null]),
          positions,
          pending,
        },
        ...(pending.length && g.next() < 0.2 ? { replacingOrderId: g.pick(pending).id } : {}),
      };
      const order: OrderRequest = {
        companyId: g.next() < 0.03 ? "Z" : g.pick(companies),
        type: g.pick(types),
        qty: g.pick([0, 1, g.int(1, 500), g.int(1, 5000), 1.5, 100_001, 4000, 2000]),
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
      ["BAD_QUANTITY", "COLLATERAL_DEFICIT", "INSIDER", "INSUFFICIENT_CASH", "LONG_LIMIT", "NOT_A_FUND", "NOT_ENOUGH_SHARES",
        "NOT_ENOUGH_SHORT", "NOT_LISTED", "OK", "SHORT_EXPOSURE", "SHORT_LIMIT", "TRADING_HALTED", "TRADING_PAUSED"].sort(),
    );
  });
});

describe("IPO book", () => {
  test("check_ipo_book matches validateIpoBids", async () => {
    const g = gen(11);
    const companies = ["A", "B", "C", "D", "E", "F"];
    const cases = Array.from({ length: 3000 }, () => {
      const prices: Record<string, number> = {};
      for (const c of companies) if (g.next() < 0.9) prices[c] = g.pick([900, 950, 1000, 1050, 1100]);
      const book = Array.from({ length: g.int(0, 8) }, () => ({
        companyId: g.pick(companies),
        qty: g.pick([0, g.int(0, 4000), 4000, 4001, -1, 2.5, g.int(1, 500)]),
      }));
      return { cash: g.pick([g.int(0, 50_000_000), 45_000_000, 0]), squad: g.pick([...companies, null]), book, prices };
    });
    const sql = await sqlBatch<Record<string, unknown>>(
      `app.check_ipo_book((c->>'cash')::bigint, c->>'squad', c->'book', c->'prices')`,
      cases,
    );
    cases.forEach((c, i) => {
      const e = validateIpoBids({ cash: c.cash, squadCompanyId: c.squad }, c.book, c.prices);
      const expected = e.ok ? { ok: true, totalCost: e.totalCost } : { ok: false, code: e.code, ...(e.companyId ? { companyId: e.companyId } : {}) };
      expect(sql[i], JSON.stringify(c)).toEqual(expected);
    });
  });
});

describe("submission text and word counts", () => {
  const samples = [
    "Sensors for town water tanks — alerts in 5 minutes.",
    "  leading and trailing\t\nspaces  ",
    "Water…  ...  — – - ( ) ! words only",
    "Unicode: café naïve 東京 राम ₹500 50% 3.5x",
    Array.from({ length: 50 }, () => "water").join("\u200B"),
    "soft\u00ADhyphen and word\u2060joiner and nbsp\u00A0here",
    "",
    "line one\r\nline two\u2028line three",
  ];

  test("word_count matches wordCount", async () => {
    const sql = await sqlBatch<number>(`app.word_count(c->>'t')`, samples.map((t) => ({ t })));
    samples.forEach((t, i) => expect(sql[i], JSON.stringify(t)).toBe(wordCount(t)));
  });

  test("submission_text and submission_words match the engine for every type", async () => {
    const g = gen(12);
    const fields = {
      PITCH: ["company_name", "ticker", "problem", "solution", "customers", "business_model", "advantage", "use_of_seed"],
      PLAN: ["crisis", "new_plan", "money", "deal", "time_to_recovery", "risks", "next_steps"],
      FLASH: ["answer"],
    } as const;
    const cases = Array.from({ length: 600 }, () => {
      const type = g.pick(["PITCH", "PLAN", "FLASH"] as const);
      const content: Record<string, unknown> = {};
      for (const f of fields[type]) {
        const r = g.next();
        content[f] = r < 0.15 ? "" : r < 0.2 ? 42 : g.pick(samples) + (r < 0.5 ? "  " : "");
      }
      if (type === "PITCH") content.ticker = g.pick(["aqs", "CCRT", " snap "]);
      return { type, content };
    });
    const sql = await sqlBatch<unknown[]>(
      `jsonb_build_array(app.submission_text((c->>'type')::submission_type, c->'content'),
                         app.submission_words((c->>'type')::submission_type, c->'content'))`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i], JSON.stringify(c)).toEqual([submissionText(c.type, c.content), submissionWords(c.type, c.content)]),
    );
  });
});

describe("fee and deal", () => {
  test("check_fee matches validateFee", async () => {
    const g = gen(6);
    const cases = Array.from({ length: 3000 }, () => ({
      cash: g.pick([g.int(-10, 3_600_000), 1_000_000, 3_500_000, 2_250_000, 0]),
      shares: g.pick([g.int(0, 3200), 3000, 3001, 0, -1]),
      ipo: g.pick([900, 950, 1000, 1050, 1100]),
      companyCash: g.pick([5_000_000, g.int(0, 5_000_000)]),
      retained: g.pick([60_000, g.int(0, 5000)]),
    }));
    const sql = await sqlBatch<string | null>(
      `app.check_fee((c->>'cash')::bigint, (c->>'shares')::bigint, (c->>'ipo')::bigint, (c->>'companyCash')::bigint, (c->>'retained')::bigint)`,
      cases,
    );
    cases.forEach((c, i) => {
      const e = validateFee({ cash: c.cash, shares: c.shares }, { ipoPrice: c.ipo, companyCash: c.companyCash, retainedShares: c.retained });
      expect(sql[i], JSON.stringify(c)).toBe(e.ok ? null : e.code);
    });
  });

  test("check_deal_terms / check_deal / deal_band_min match the engine", async () => {
    const g = gen(7);
    const cases = Array.from({ length: 3000 }, () => {
      const post = g.int(400, 2000);
      return {
        amount: g.pick([g.int(3_900_000, 8_100_000), 4_000_000, 8_000_000]),
        price: g.pick([g.int(1, post + 5), Math.floor(post / 2), Math.ceil(post / 2), post, post + 1]),
        post,
        available: g.pick([g.int(0, 9_000_000), 50_000_000]),
        retained: g.pick([60_000, g.int(0, 20_000)]),
      };
    });
    const sql = await sqlBatch<unknown[]>(
      `jsonb_build_array(app.check_deal_terms((c->>'amount')::bigint, (c->>'price')::bigint, (c->>'post')::bigint),
                         app.check_deal((c->>'amount')::bigint, (c->>'price')::bigint, (c->>'post')::bigint, (c->>'available')::bigint, (c->>'retained')::bigint),
                         app.deal_band_min((c->>'post')::bigint))`,
      cases,
    );
    cases.forEach((c, i) => {
      const t = validateDealTerms({ amount: c.amount, price: c.price }, c.post);
      const d = validateDeal({ amount: c.amount, price: c.price }, { postCrisisPrice: c.post, fundAvailableCash: c.available, companyRetainedShares: c.retained });
      expect(sql[i], JSON.stringify(c)).toEqual([t.ok ? null : t.code, d.ok ? null : d.code, dealPriceBand(c.post).min]);
    });
  });
});

describe("judging and scoring", () => {
  test("judge_call: every direction (incl. missing) against equal, higher and lower prices", async () => {
    const cases = (["BUY", "SELL", null] as const).flatMap((dir) => [[1000, 1001], [1000, 1000], [1000, 999]].map(([b, j]) => ({ dir, b, j })));
    const sql = await sqlBatch<boolean>(`app.judge_call((c->>'dir')::call_dir, (c->>'b')::bigint, (c->>'j')::bigint)`, cases);
    cases.forEach((c, i) => expect(sql[i]).toBe(judgeCall(c.dir, c.b!, c.j!)));
  });

  test("median_score, needs_extra_runs", async () => {
    const g = gen(8);
    const cases = Array.from({ length: 1000 }, () => ({ totals: Array.from({ length: g.pick([1, 3, 3, 5]) }, () => g.int(0, 100)) }));
    const sql = await sqlBatch<unknown[]>(
      `jsonb_build_array(app.median_score(array(select jsonb_array_elements_text(c->'totals')::int)),
                         app.needs_extra_runs(array(select jsonb_array_elements_text(c->'totals')::int)))`,
      cases,
    );
    cases.forEach((c, i) => expect(sql[i]).toEqual([medianScore(c.totals), needsExtraRuns(c.totals)]));
  });

  test("judge_run_valid: a stored run passes exactly when validateJudgeOutput accepts it", async () => {
    const g = gen(11);
    const types = ["PITCH", "PLAN", "FLASH"] as SubmissionType[];
    const cases = Array.from({ length: 3000 }, () => {
      const type = g.pick(types);
      const breakdown: Record<string, unknown> = {};
      for (const line of RUBRICS[type]) breakdown[line.key] = g.int(0, line.max);
      let total = Object.values(breakdown).reduce((a: number, v) => a + (v as number), 0);
      let rationale = "Clear problem, weak moat.";
      const key = g.pick(RUBRICS[type]).key;
      switch (g.int(0, 9)) {
        case 0: delete breakdown[key]; break;
        case 1: breakdown.extra_line = 5; break;
        case 2: breakdown[key] = g.pick(RUBRICS[type]).max + g.int(1, 30); break;
        case 3: breakdown[key] = -g.int(1, 5); break;
        case 4: breakdown[key] = (breakdown[key] as number) + 0.5; break;
        case 5: breakdown[key] = String(breakdown[key]); break;
        case 6: total += g.pick([-1, 1, 7]); break;
        case 7: rationale = g.pick(["", "   ", "\n\t"]); break;
        case 8: breakdown[key] = null; break;
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

  test("injection_penalty for every combination", async () => {
    const cases = (["PITCH", "PLAN", "FLASH"] as SubmissionType[]).flatMap((type) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((m) => ({ type, PITCH: !!(m & 1), PLAN: !!(m & 2), FLASH: !!(m & 4) })),
    );
    const sql = await sqlBatch<number>(
      `app.injection_penalty((c->>'type')::submission_type, (c->>'PITCH')::boolean, (c->>'PLAN')::boolean, (c->>'FLASH')::boolean)`,
      cases,
    );
    cases.forEach((c, i) => expect(sql[i], JSON.stringify(c)).toBe(injectionPenalty(c.type, c)));
  });

  test("final_score", async () => {
    const g = gen(9);
    const cases = Array.from({ length: 2000 }, () => ({
      type: g.pick(["PITCH", "PLAN", "FLASH"] as SubmissionType[]),
      median: g.next() < 0.1 ? null : g.int(0, 100),
      signed: g.next() < 0.5,
      penalty: g.pick([0, 0, 10]),
    }));
    const sql = await sqlBatch<Record<string, unknown>>(
      `app.final_score((c->>'type')::submission_type, (c->>'median')::int, (c->>'signed')::boolean, (c->>'penalty')::int)`,
      cases,
    );
    cases.forEach((c, i) =>
      expect(sql[i]).toEqual(finalScore({ type: c.type, median: c.median, dealSignedInTime: c.signed, penalty: c.penalty })),
    );
  });

  test("plan_bonus and return_bp", async () => {
    const g = gen(10);
    const cases = Array.from({ length: 1000 }, (_, i) => ({ score: i % 101, final: g.int(-10_000_000, 200_000_000), start: g.pick([50_000_000, 68_000_000, g.int(1, 70_000_000)]) }));
    const sql = await sqlBatch<number[]>(
      `jsonb_build_array(app.plan_bonus((c->>'score')::int), app.return_bp((c->>'final')::bigint, (c->>'start')::bigint))`,
      cases,
    );
    cases.forEach((c, i) => expect(sql[i]!.map(Number)).toEqual([planBonus(c.score), returnBp(c.final, c.start)]));
  });
});

describe("lottery", () => {
  test("sha256_hex and the generator's word stream", async () => {
    const { rows } = await db.pool.query("select app.sha256_hex('abc') as h, app.sha256_hex('market-night' || '4') as r");
    expect(rows[0].h).toBe(sha256Hex("abc"));
    expect(rows[0].r).toBe(rootSeed("market-night", "4"));

    const root = rootSeed("market-night", "4");
    const rng = new Rng(root, "squads");
    const expected = Array.from({ length: 50 }, () => rng.nextUint32());
    const { rows: words } = await db.pool.query(
      `with recursive w(i, st, val) as (
         select 1, r.st, r.val from app.rng_uint32(app.rng_new($1, 'squads')) r
         union all
         select i + 1, r.st, r.val from w, lateral app.rng_uint32(w.st) r where i < 50)
       select val from w order by i`,
      [root],
    );
    expect(words.map((r) => Number(r.val))).toEqual(expected);
  });

  test("rng_int and rng_shuffle", async () => {
    const root = rootSeed("seed", "6");
    for (const n of [1, 2, 3, 6, 50, 1000, 4_294_967_295]) {
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
    const items = Array.from({ length: 50 }, (_, i) => `T${i}`);
    const { rows } = await db.pool.query("select (app.rng_shuffle(app.rng_new($1, 'coverage'), $2)).result as r", [root, items]);
    expect(rows[0].r).toEqual(new Rng(root, "coverage").shuffle(items));
  });

  test.each([
    ["market-night", "4", 50, 60],
    ["another seed", "12", 50, 60],
    ["rehearsal", "3", 4, 12],
    ["tiny", "1", 3, 5],
  ])("lottery_draw(%s, %s) with %i squads and %i cards matches drawLottery", async (seed, dice, n, nCards) => {
    const code = (p: string, i: number) => `${p}${String(i + 1).padStart(2, "0")}`;
    const teams = {
      product: Array.from({ length: n }, (_, i) => code("P", i)),
      consulting: Array.from({ length: n }, (_, i) => code("C", i)),
      finance: Array.from({ length: n }, (_, i) => code("F", i)),
    };
    const cards = Array.from({ length: nCards }, (_, i) => String(i + 1));
    const expected = drawLottery(seed, dice, teams, cards);
    const { rows } = await db.pool.query("select app.lottery_draw($1, $2, $3, $4, $5) as d", [
      expected.root,
      [...teams.product].reverse(),
      teams.consulting,
      teams.finance,
      cards,
    ]);
    expect(rows[0].d).toEqual(expected.squads);
  });

  test("lottery_crises matches assignCrises (one card per category, and several cards per category)", async () => {
    const root = rootSeed("market-night", "4");
    const decks = [
      ["Supply", "Regulation", "Legal", "Partner", "Breach", "Funding", "Competitor", "Recall", "Demand", "Outage"].map((category, i) => ({ id: `c${i}`, category, number: 1 })),
      [{ id: "a1", category: "A", number: 1 }, { id: "a2", category: "A", number: 2 }, { id: "b1", category: "B", number: 1 }, { id: "b3", category: "B", number: 3 }],
    ];
    for (const deck of decks) {
      const { rows } = await db.pool.query("select app.lottery_crises($1, 50, $2) as r", [root, JSON.stringify(deck)]);
      expect(rows[0].r).toEqual(assignCrises(root, 50, deck));
    }
  });
});
