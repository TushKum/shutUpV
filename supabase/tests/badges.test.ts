// public.team_badge_facts: each team reads only its own facts, through the real game functions.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { anon, as } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("badges");

describe("badge facts", () => {
  test("a team's own chat, pitch, questions, answers and bids; staff and the anonymous cannot call it", async () => {
    const n = await Night.create(db.pool, 3);
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, "2");
    await n.advanceTo("BUILD");
    const [a, b] = [await n.squad(1), await n.squad(2)];
    const facts = (code: string) => n.call(n.team(code), "team_badge_facts");

    expect(await facts(a.p_code)).toMatchObject({
      track: "PRODUCT", submitted: [], scores: {}, fee_agreed: false, deal_early: false, messages: 0, answers_given: 0,
      company: { ipo_price: null },
    });
    for (let i = 0; i < 5; i++) await n.ok(n.team(a.p_code), "post_squad_message", `Hello ${i}`);
    await n.ok(n.team(a.c_code), "post_squad_message", "Hi");
    const p = n.team(a.p_code);
    const draft = await n.one("select version from submission_drafts where squad_id = $1 and type = 'PITCH'", [a.id]);
    await n.ok(p, "save_draft", "PITCH", {
      company_name: "Late Boxes", ticker: "LBOX", problem: "Hostels bin 23% of what they cook.", solution: "Rs 50 late boxes.",
      customers: "Students.", business_model: "Rs 18 a box.", advantage: "Annapurna deal.", use_of_seed: "Carriers.",
    }, draft.version);
    await n.ok(p, "submit_submission", "PITCH");

    expect(await facts(a.p_code)).toMatchObject({ messages: 5, submitted: ["PITCH"] });
    expect(await facts(a.c_code)).toMatchObject({ track: "CONSULTING", messages: 1, submitted: ["PITCH"] });
    expect(await facts(b.p_code)).toMatchObject({ messages: 0, submitted: [] }); // another squad's facts are its own

    // Reading: a fund asks, the company answers.
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    const q = await n.ok(n.team(b.f_code), "post_question", a.company_id, "How many boxes a day?");
    await n.ok(p, "answer_question", q.question_id, "540 a day, from 900 wasted plates.");
    expect(await facts(b.f_code)).toMatchObject({ track: "FINANCE", questions_asked: 1, ipo_bids: 0, trades: 0 });
    expect(await facts(a.p_code)).toMatchObject({ answers_given: 1 });

    // Only a team can call it.
    await expect(n.call(n.lead, "team_badge_facts")).rejects.toThrow(/only a team/);
    await expect(as(n.pool, anon, (c) => c.query("select public.team_badge_facts()"))).rejects.toThrow();
  });
});
