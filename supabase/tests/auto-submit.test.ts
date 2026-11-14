// A saved answer is never lost for want of pressing Submit: at the deadline the heartbeat submits the last saved draft
// of every company that submitted nothing (migration 49), if the draft would have been accepted.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

describe("auto-submit at the deadline", () => {
  test("the last saved draft is submitted; a chosen submission is kept; a draft that would be refused is not", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("auto");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "1");
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    // A saves and never submits; B saves version 1, submits it, then saves a version 2; C's draft is too long.
    await n.ok(n.team(a.p_code), "save_draft", "PITCH", { company_name: "Saved Only", ticker: "SAVD", problem: "A real problem." }, 0);
    await n.ok(n.team(b.p_code), "save_draft", "PITCH", { company_name: "Chosen", ticker: "CHSN", problem: "First version." }, 0);
    await n.ok(n.team(b.p_code), "submit_submission", "PITCH");
    await n.ok(n.team(b.p_code), "save_draft", "PITCH", { company_name: "Chosen", ticker: "CHSN", problem: "Second version." }, 1);
    await n.ok(n.team(c.p_code), "save_draft", "PITCH", { company_name: "Long", ticker: "LONG", problem: "word ".repeat(900) }, 0);
    // A firm saves its memo and never submits.
    await n.ok(n.team(a.c_code), "save_draft", "MEMO", { diagnosis: "One partner, no backup." }, 0);

    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select count(*)::int as c from submissions where event_id = $1", [n.eventId])).c).toBe(1); // before the deadline: nothing

    await n.deadlinePassed("PITCH");
    const r = await n.ok(n.lead, "tick", n.eventId);
    expect(r.actions).toContain("auto-submitted 2");
    const subs = await n.q(
      "select c.ticker, s.type, s.auto_submitted, s.body_text from submissions s join companies c on c.id = s.company_id where s.event_id = $1 and s.superseded_at is null order by c.ticker, s.type",
      [n.eventId],
    );
    expect(subs.map((s) => [s.ticker, s.type, s.auto_submitted])).toEqual([["CHSN", "PITCH", false], ["SAVD", "PITCH", true], ["SAVD", "MEMO", true]]);
    expect(subs.find((s) => s.ticker === "CHSN")!.body_text).toContain("First version.");
    await n.ok(n.lead, "tick", n.eventId); // once only
    expect((await n.one("select count(*)::int as c from submissions where event_id = $1", [n.eventId])).c).toBe(3);
    await n.checkInvariants();
  }, 120_000);
});
