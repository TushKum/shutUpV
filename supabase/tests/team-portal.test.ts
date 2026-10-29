// Database rules the team portal relies on (Phase 4).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("team-portal");

/** A 3-squad event in ROUNDS_1_4 with round 1 open (every pitch scored 60). */
async function roundOpen() {
  const n = await Night.create(db.pool, 3);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "3");
  const s = [await n.squad(1), await n.squad(2), await n.squad(3)];
  await n.advanceTo("BUILD");
  for (const [i, x] of s.entries()) {
    await n.ok(n.team(x.p_code), "save_draft", "PITCH", { company_name: `Co ${i}`, ticker: `TP${"ABC"[i]}`, problem: "A real problem." }, 0);
    await n.ok(n.team(x.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const x of s) await n.judge(x.company_id, "PITCH", [60, 60, 60]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("ROUNDS_1_4");
  await n.openRound(1);
  return { n, s };
}

describe("orders while paused", () => {
  test("a pause freezes the book: no order is placed, edited or cancelled until the event resumes", async () => {
    const { n, s } = await roundOpen();
    const fund = n.team(s[0]!.f_code);
    const placed = await n.ok(fund, "place_order", s[1]!.company_id, "BUY", 10);
    const order = placed.order.id;
    await n.org("pause_event", n.eventId);
    expect(await n.call(fund, "cancel_order", order)).toMatchObject({ ok: false, code: "TRADING_PAUSED", message: "Trading is paused." });
    expect(await n.call(fund, "edit_order", order, 20)).toMatchObject({ ok: false, code: "TRADING_PAUSED" });
    expect(await n.call(fund, "place_order", s[1]!.company_id, "BUY", 5)).toMatchObject({ ok: false, code: "TRADING_PAUSED" });
    expect((await n.one("select status from orders where id = $1", [order])).status).toBe("PENDING");
    // The refusal is audited like every other.
    expect(
      (await n.one("select count(*)::int as c from audit_log where entity = 'cancel_order' and after ->> 'code' = 'TRADING_PAUSED' and event_id = $1", [n.eventId])).c,
    ).toBe(1);
    await n.org("resume_event", n.eventId);
    expect(await n.call(fund, "cancel_order", order)).toMatchObject({ ok: true, order: { status: "CANCELLED" } });
  });
});

describe("team_plan_facts", () => {
  test("one call returns what the team could read itself; unanswered counts its own visible, unanswered questions", async () => {
    const { n, s } = await roundOpen();
    const product = n.team(s[0]!.p_code);
    const callAs = async (who: ReturnType<Night["team"]>) =>
      (await rowsAs<{ f: Record<string, any> }>(db.pool, who, "select public.team_plan_facts() as f"))[0]!.f;
    const p = await callAs(product);
    expect(p.released).toEqual(["PITCH"]);
    expect(p.submitted).toEqual(["PITCH"]);
    expect(p.flash_published).toBe(false);
    expect(p.ipo_allocated_at).not.toBeNull();
    expect(p.deadlines.length).toBe((await n.q("select 1 from deadlines where event_id = $1", [n.eventId])).length);
    expect(p.phases.length).toBe((await n.q("select 1 from phases where event_id = $1", [n.eventId])).length);
    expect(p.calls).toEqual([]);
    expect(p.ipo_bids).toBe(0);
    expect(p.unanswered).toBe(0);

    // Two funds ask the product team's company; one question is hidden by the organisers; then one is answered.
    const q1 = await n.ok(n.team(s[1]!.f_code), "post_question", s[0]!.company_id, "How many users?");
    const q2 = await n.ok(n.team(s[2]!.f_code), "post_question", s[0]!.company_id, "Spam?");
    await n.q("update qa_questions set hidden = true where id = $1", [q2.question_id]);
    expect((await callAs(product)).unanswered).toBe(1);
    await n.ok(product, "answer_question", q1.question_id, "Two thousand.");
    expect((await callAs(product)).unanswered).toBe(0);

    // A consultant sees its own calls; a fund its own IPO bids; another squad's fee and deal stay out.
    const consultant = await callAs(n.team(s[0]!.c_code));
    expect(consultant.calls.length).toBe((await n.q("select 1 from calls where consultant_team_id = $1", [n.teamId(s[0]!.c_code)])).length);
    expect(consultant.unanswered).toBe(0);
    const fund = await callAs(n.team(s[0]!.f_code));
    expect(fund.ipo_bids).toBe((await n.q("select 1 from ipo_bids where team_id = $1 and qty_requested > 0", [n.teamId(s[0]!.f_code)])).length);
    await expect(rowsAs(db.pool, n.lead, "select public.team_plan_facts()")).rejects.toThrow(/only a team/);
  });
});
