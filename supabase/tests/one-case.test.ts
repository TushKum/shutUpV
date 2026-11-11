// One-case mode: a one-card problem deck gives every squad the same case, chosen at the draw (nothing to pick), and
// a one-card crisis deck hits every company with the same crisis at 00:30.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drawLottery, sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("one-case");
const CASE = { number: 1, sector: "Food", title: "The Hostel Kitchen", body: "College hostels throw away a large share of the food they cook." };
const CRISIS = { category: "Regulation", number: 1, title: "The food-safety rule", body: "Cooked food must stay below 5 °C or be served within 2 hours." };

describe("every squad plays the same case", () => {
  test("the draw deals the one card to every squad, already chosen; the pick stays harmless; squads match the engine", async () => {
    const n = await Night.create(db.pool, 5);
    await n.org("upload_problem_deck", n.eventId, JSON.stringify([CASE]));
    await n.org("upload_crisis_deck", n.eventId, JSON.stringify([CRISIS]));
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, "6");

    const card = (await n.one("select id from problem_cards where event_id = $1", [n.eventId])).id;
    const rows = await n.q("select number, dealt_card_ids, chosen_card_id, chosen_by_default from squads where event_id = $1 order by number", [n.eventId]);
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r).toMatchObject({ dealt_card_ids: [card], chosen_card_id: card, chosen_by_default: false });

    const codes = (track: string) => n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code);
    const expected = drawLottery(SEED, "6", { product: codes("PRODUCT"), consulting: codes("CONSULTING"), finance: codes("FINANCE") }, ["1"]);
    for (const e of expected.squads) {
      const s = await n.squad(e.number);
      expect([s.p_code, s.c_code, s.f_code]).toEqual([e.product, e.consulting, e.finance]);
    }

    // The Product team may still "pick" the only card; the default at the deadline changes nothing.
    const s1 = await n.squad(1);
    await n.ok(n.team(s1.p_code), "pick_problem_card", card);
    await n.q("select app.default_problem_cards($1)", [n.eventId]);
    expect((await n.q("select count(*)::int as c from squads where event_id = $1 and chosen_card_id = $2", [n.eventId, card]))[0]!.c).toBe(5);
    await n.checkInvariants();
  });
});
