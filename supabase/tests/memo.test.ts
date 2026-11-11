// Round 1 Consultancy (PRIMUS): every Consulting team writes a memo on the same standalone crisis case while Product
// writes the PRD. Only Consulting writes it, it closes with the PRD, the judge scores it like any submission, the score
// moves no price, a released score is final, and settlement pays the firm $500 × (score − 50) as a reputation bonus.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { planBonus, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const memo = {
  diagnosis: "One cold-storage partner held 60% of stock; spoilage and two big customers put ₹6 lakh a week at risk.",
  options: "Rent space 25 km out at twice the rate; build a ₹45 lakh room; share a rival's cold room.",
  recommendation: "Rent now, build later: it keeps the customers this week.",
  numbers: "Rent ₹3 lakh a month against ₹4.5 lakh a month of spoilage.",
  risks: "Longer trips: add a night run.",
  next_steps: "Founders sign the lease by Wednesday; ops moves stock Thursday.",
};

describe("the crisis memo", () => {
  test("Consulting only, by the PRD deadline; judged and released without a price move; final once released; paid at settlement", async () => {
    const n = await Night.create(db.pool, 3);
    const seed = sha256Hex("memo");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "2");
    const [a, b, c3] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");

    // Product cannot write the memo; Consulting cannot write the PRD.
    expect(await n.call(n.team(a.p_code), "save_draft", "MEMO", memo, 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a.c_code), "save_draft", "PITCH", { problem: "x" }, 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    // Over 500 words is refused; then a proper memo goes in.
    const long = { ...memo, diagnosis: Array.from({ length: 501 }, () => "word").join(" ") };
    await n.ok(n.team(a.c_code), "save_draft", "MEMO", long, 0);
    expect(await n.call(n.team(a.c_code), "submit_submission", "MEMO")).toMatchObject({ ok: false, code: "TOO_LONG" });
    await n.ok(n.team(a.c_code), "save_draft", "MEMO", { ...memo, sneaky: "dropped" }, 1);
    const sub = await n.ok(n.team(a.c_code), "submit_submission", "MEMO");
    expect(sub.submission.body_text).toMatch(/^Diagnosis:\nOne cold-storage/);
    expect(sub.submission.content).not.toHaveProperty("sneaky");

    for (const [i, s] of [a, b, c3].entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Memo Co ${i}`, ticker: ["MMA", "MMB", "MMC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }

    // The PRD deadline closes the memo too.
    await n.deadlinePassed("PITCH");
    expect(await n.call(n.team(b.c_code), "save_draft", "MEMO", memo, 0)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });

    const companyA = (await n.one("select id from companies where squad_id = $1", [a.id])).id;
    const companyB = (await n.one("select id from companies where squad_id = $1", [b.id])).id;
    const companyC = (await n.one("select id from companies where squad_id = $1", [c3.id])).id;
    const started = await n.org("start_judging", n.eventId, "MEMO");
    expect(started).toMatchObject({ queued: 3, companies: 1 });
    await n.q("delete from judge_runs where type = 'MEMO' and event_id = $1", [n.eventId]);
    expect(await n.judge(companyA, "MEMO", [70, 74, 72])).toMatchObject({ ok: true, final: 72 });
    await n.org("seal_missing_scores", n.eventId, "MEMO");

    // Released at READING, without touching any price.
    for (const c of [companyA, companyB, companyC]) await n.judge(c, "PITCH", [60, 60, 60]).catch(() => null);
    await n.advanceTo("READING");
    const before = await n.q("select id, market_price, ai_price from companies where event_id = $1 order by id", [n.eventId]);
    const released = await n.org("release_scores", n.eventId, "MEMO");
    expect(released).toMatchObject({ released: 3 });
    expect(await n.q("select id, market_price, ai_price from companies where event_id = $1 order by id", [n.eventId])).toEqual(before);
    expect(await n.q("select c.id, s.final_score, s.tier_bp, s.missing from scores s join companies c on c.id = s.company_id where s.type = 'MEMO' and c.event_id = $1 and c.id in ($2, $3)", [n.eventId, companyA, companyB]))
      .toEqual(expect.arrayContaining([{ id: companyA, final_score: 72, tier_bp: 0, missing: false }, { id: companyB, final_score: 0, tier_bp: 0, missing: true }]));
    expect(await n.call(n.lead, "release_scores", n.eventId, "MEMO")).toMatchObject({ ok: false, code: "ALREADY_RELEASED" });
    expect(await n.call(n.lead, "rerun_judging", companyA, "MEMO", "Judge again please")).toMatchObject({ ok: false, code: "MEMO_RELEASED" });

    // Settlement pays the reputation bonus to each firm, from the exchange.
    await n.q("select app.pay_consultant_bonuses($1)", [n.eventId]);
    const bonuses = await n.q(
      "select team_id, cash_delta_cents::int as cents from ledger_entries where event_id = $1 and kind = 'BONUS_MEMO' and team_id is not null order by cents desc",
      [n.eventId],
    );
    expect(bonuses).toHaveLength(3);
    expect(bonuses[0]).toEqual({ team_id: n.teamId(a.c_code), cents: planBonus(72) });
    expect(bonuses).toContainEqual({ team_id: n.teamId(b.c_code), cents: planBonus(0) });
  });
});
