// Squad chat: only the squad's three teams and the staff read it; a team posts through post_squad_message only, from
// the draw until the awards; and only they hear the squad's channel.

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

const SEED = sha256Hex("squad-chat");

async function drawn() {
  const n = await Night.create(db.pool, 3);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  return n;
}

describe("squad chat", () => {
  test("closed until the draw; then the squad's teams post and read, other squads and the display do not", async () => {
    const n = await drawn();
    const someone = n.team(n.ev.plan.teams[0]!.code);
    expect(await n.call(someone, "post_squad_message", "hello")).toMatchObject({ ok: false, code: "NO_SQUAD" });
    await n.org("run_lottery", n.eventId, SEED, "3");
    const [a, b] = [await n.squad(1), await n.squad(2)];
    await n.ok(n.team(a.p_code), "post_squad_message", "  Fee 4%?  ");
    await n.ok(n.team(a.f_code), "post_squad_message", "Make it 3%.");
    await n.ok(n.team(b.c_code), "post_squad_message", "Other squad.");

    const read = async (who: ReturnType<Night["team"]>) =>
      (await rowsAs<{ body: string }>(db.pool, who, "select body from squad_messages order by id")).map((r) => r.body);
    expect(await read(n.team(a.c_code))).toEqual(["Fee 4%?", "Make it 3%."]);
    expect(await read(n.team(b.p_code))).toEqual(["Other squad."]);
    expect(await read(n.lead)).toEqual(["Fee 4%?", "Make it 3%.", "Other squad."]);
    expect(await read(n.fairness)).toHaveLength(3);
    // Nobody writes directly.
    await expect(
      rowsAs(db.pool, n.team(a.p_code), "insert into squad_messages (event_id, squad_id, team_id, body) values ($1, $2, $3, 'x')", [n.eventId, a.id, a.product_team_id]),
    ).rejects.toThrow(/permission denied/);
    // Every message is audited.
    expect((await n.one("select count(*)::int as c from audit_log where entity = 'squad_messages' and event_id = $1", [n.eventId])).c).toBe(3);
  });

  test("length and rate limits, and the chat closes at the awards", async () => {
    const n = await drawn();
    await n.org("run_lottery", n.eventId, SEED, "3");
    const a = await n.squad(1);
    const t = n.team(a.c_code);
    expect(await n.call(t, "post_squad_message", "   ")).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    expect(await n.call(t, "post_squad_message", "x".repeat(501))).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    await n.ok(t, "post_squad_message", "x".repeat(500));
    await n.q("update events set current_phase = 'AWARDS' where id = $1", [n.eventId]);
    expect(await n.call(t, "post_squad_message", "late")).toMatchObject({ ok: false, code: "CHAT_CLOSED" });
  });

  test("twenty messages a minute per team", async () => {
    const n = await drawn();
    await n.org("run_lottery", n.eventId, SEED, "3");
    const a = await n.squad(1);
    const t = n.team(a.p_code);
    for (let i = 0; i < 20; i++) await n.ok(t, "post_squad_message", `m${i}`);
    expect(await n.call(t, "post_squad_message", "one too many")).toMatchObject({ ok: false, code: "RATE_LIMITED", message: "Too many messages in a minute." });
  });

  test("only the squad's teams and the staff hear its channel", async () => {
    const n = await drawn();
    await n.org("run_lottery", n.eventId, SEED, "3");
    const [a, b] = [await n.squad(1), await n.squad(2)];
    const hears = async (who: ReturnType<Night["team"]>, topic: string) =>
      (await rowsAs<{ v: boolean }>(db.pool, who, "select app.can_hear($1) as v", [topic]))[0]!.v;
    expect(await hears(n.team(a.f_code), `squad:${a.id}`)).toBe(true);
    expect(await hears(n.team(b.f_code), `squad:${a.id}`)).toBe(false);
    expect(await hears(n.lead, `squad:${a.id}`)).toBe(true);
    expect(await hears(n.lead, `squad:00000000-0000-0000-0000-000000000000`)).toBe(false);
    // The older topics still work.
    expect(await hears(n.team(a.f_code), `event:${n.eventId}`)).toBe(true);
    expect(await hears(n.team(a.f_code), `staff:${n.eventId}`)).toBe(false);
  });
});
