// The AI-outage fallback (scripts/human-scores.ts): the human panel's CSV, checked like model output, then fed to the
// same worker and queue as the model. The scores come out of the queue exactly as the model's would: median of 3 runs,
// runs 4 and 5 when the panel spreads more than 10 points, and nothing recorded for a company without a row.

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { supabaseJudgeDb, type RpcClient } from "../../apps/web/lib/judge/db";
import { promptLoader } from "../../apps/web/lib/judge/prompts";
import { runWorker } from "../../apps/web/lib/judge/worker";
import { HUMAN_MODEL, humanJudge, missingRows, parseHumanScores } from "../../scripts/lib/human-scores";
import { as, service } from "./helpers";
import { Night } from "./night";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

/** The one method of a SupabaseClient that lib/judge/db.ts uses, over the pool as the service role. */
function pgRpc(pool: pg.Pool): RpcClient {
  return {
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      try {
        const r = await as(pool, service, async (c) => (await c.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values)).rows[0]!.r, { commit: true });
        return { data: r, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  };
}

const HEADER = "ticker,judge,problem,solution,business_model,advantage,rationale";

describe("the panel's CSV", () => {
  test("rows are checked like model output: each line within its maximum, judges 1–5, once each", () => {
    const bad = parseHumanScores("PITCH", `${HEADER}\nAQS,1,26,10,10,10,x\nAQS,6,1,1,1,1,\nAQS,2,1,1,1,1,\nAQS,2,1,1,1,1,\nA1,1,1,1,1,1,`);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors).toEqual([
      expect.stringContaining("problem must be 0–25, got 26"),
      expect.stringContaining("judge must be 1–5"),
      expect.stringContaining("AQS has judge 2 twice"),
      expect.stringContaining("is not 3–4 letters"),
    ]);
    expect(parseHumanScores("PLAN", HEADER)).toMatchObject({ ok: false, errors: [expect.stringContaining("missing column solves_crisis")] });
  });

  test("missing rows: the queued runs without a row, and panels that spread more than 10 points", () => {
    const p = parseHumanScores("PITCH", `${HEADER}\nAQS,1,20,20,10,10,\nAQS,2,20,20,10,12,\nAQS,3,25,25,10,15,`);
    if (!p.ok) throw new Error(p.errors.join());
    expect(p.scores.get("AQS")!.get(1)).toMatchObject({ total: 60, rationale: expect.stringContaining("human judge 1") });
    expect(missingRows(p.scores, [{ ticker: "AQS", runNo: 3 }, { ticker: "CCRT", runNo: 1 }])).toEqual({
      missing: ["CCRT judge 1"],
      extra: ["AQS (judges 1–3 gave 60, 62, 75: add judges 4 and 5)"],
    });
  });
});

describe("judging with the panel's scores", () => {
  test("the worker seals each company with the median of the panel, runs 4–5 included, and stops at a missing row", async () => {
    const n = await Night.create(db.pool, 3);
    const seed = sha256Hex("panel");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "2");
    const squads = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    const tickers = ["PNA", "PNB", "PNC"];
    for (const [i, s] of squads.entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Panel ${i}`, ticker: tickers[i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.org("start_judging", n.eventId, "PITCH");

    // PNA: 64, 66, 68 → 66. PNB: 50, 70, 72 spread 22 → judges 4–5 (60, 61) → median 61. PNC: no rows.
    const csv = [
      HEADER,
      "PNA,1,16,16,16,16,", "PNA,2,17,17,16,16,", "PNA,3,17,17,17,17,",
      "PNB,1,15,15,10,10,", "PNB,2,20,20,15,15,", "PNB,3,20,20,16,16,", "PNB,4,15,15,15,15,", "PNB,5,16,15,15,15,",
    ].join("\n");
    const parsed = parseHumanScores("PITCH", csv);
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const work = () =>
      runWorker({
        db: { ...supabaseJudgeDb(pgRpc(db.pool), n.eventId), claimCalibration: async () => [] },
        judge: humanJudge(parsed.scores),
        budgetMs: 20_000,
        concurrency: 1, // one at a time, so the order is fixed: PNA, PNB, then PNC stops the worker
        models: { PRIMARY: HUMAN_MODEL, BACKUP: HUMAN_MODEL },
        prompts: promptLoader(),
        log: () => {},
      });

    const first = await work();
    expect(first).toMatchObject({ stopped: "fatal", reason: expect.stringContaining("no score from judge") });
    for (let i = 0; i < 5; i++) await work(); // runs 4–5 of PNB are queued once its run 3 is in

    const scores = await n.q(
      "select c.ticker, s.status, s.median, s.run_totals from scores s join companies c on c.id = s.company_id where s.type = 'PITCH' and c.event_id = $1 order by c.ticker",
      [n.eventId],
    );
    expect(scores.filter((s) => s.status === "SEALED").map((s) => [s.ticker, s.median])).toEqual([["PNA", 66], ["PNB", 61]]);
    const runs = await n.q("select c.ticker, j.status, j.model from judge_runs j join companies c on c.id = j.company_id where j.event_id = $1", [n.eventId]);
    expect(runs.filter((r) => r.ticker === "PNC").some((r) => r.status === "DONE")).toBe(false);
    expect(runs.filter((r) => r.status === "DONE").every((r) => r.model === HUMAN_MODEL)).toBe(true);
  });
});
