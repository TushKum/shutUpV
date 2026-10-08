// The database side of the control panel: content upload (decks, the flash bulletin), the server clock, client
// heartbeats and the health summary.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
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

const SEED = sha256Hex("control-panel");
const deck = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ number: from + i, sector: "Health", title: `Problem ${from + i}`, body: "Clinics run out of stock." }));

describe("content", () => {
  test("the problem deck is replaced before the draw, validated, and fixed after it", async () => {
    const n = await Night.create(db.pool, 4);
    const upload = (cards: unknown) => n.call(n.lead, "upload_problem_deck", n.eventId, JSON.stringify(cards));
    expect(await upload(deck(5))).toMatchObject({ ok: false, code: "BAD_DECK" }); // 4 squads need 6 cards
    expect(await upload([...deck(5), { number: 5, sector: "x", title: "dup", body: "dup" }])).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await upload([...deck(6), { number: 7.5, sector: "x", title: "t", body: "b" }])).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await upload([...deck(6), { number: 7, sector: "x", title: "", body: "b" }])).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await upload({ cards: deck(6) })).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await upload(deck(8, 101))).toMatchObject({ ok: true, cards: 8 });
    expect((await n.q("select number from problem_cards where event_id = $1 order by number", [n.eventId])).map((r) => r.number)).toEqual(
      [101, 102, 103, 104, 105, 106, 107, 108],
    );
    await expect(n.call(n.team(n.ev.plan.teams[0]!.code), "upload_problem_deck", n.eventId, JSON.stringify(deck(8)))).rejects.toThrow(/only an organiser/);

    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, "2");
    expect(await upload(deck(8))).toMatchObject({ ok: false, code: "TOO_LATE" });
  });

  test("the crisis deck is replaced until the crisis is applied", async () => {
    const n = await Night.create(db.pool, 3);
    const upload = (cards: unknown) => n.call(n.lead, "upload_crisis_deck", n.eventId, JSON.stringify(cards));
    const cards = ["Supply shortage", "Regulation"].flatMap((category) =>
      [1, 2].map((number) => ({ category, number, title: `${category} ${number}`, body: "It hurts." })),
    );
    expect(await upload([])).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await upload([...cards, cards[0]])).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await upload(cards)).toMatchObject({ ok: true, cards: 4, categories: 2 });
    await n.q("update events set crisis_applied_at = now() where id = $1", [n.eventId]); // test-only: the crisis has happened
    expect(await upload(cards)).toMatchObject({ ok: false, code: "TOO_LATE" });
  });

  test("the flash bulletin is prepared in advance, hidden until 04:00, published once, and then opens the flash answers", async () => {
    const n = await Night.create(db.pool, 3);
    const team = n.team(n.ev.plan.teams[0]!.code);
    expect(await n.call(n.lead, "prepare_flash_bulletin", n.eventId, "", "body")).toMatchObject({ ok: false, code: "BAD_BULLETIN" });
    await n.org("prepare_flash_bulletin", n.eventId, "Rates rise", "Investors want profit within 12 months.");
    await n.org("prepare_flash_bulletin", n.eventId, "Interest rates rise", "Investors want profit within 12 months.");
    expect(await n.q("select title, published_at from bulletins where event_id = $1 and kind = 'FLASH'", [n.eventId])).toEqual([
      { title: "Interest rates rise", published_at: null },
    ]);
    // Drafts are invisible to teams and to the display.
    expect(await rowsAs(db.pool, team, "select count(*)::int as c from bulletins where event_id = $1", [n.eventId])).toEqual([{ c: 0 }]);
    expect(await n.call(n.lead, "publish_flash_bulletin", n.eventId)).toMatchObject({ ok: false, code: "WRONG_PHASE" });
    // The general composer cannot publish a FLASH bulletin.
    expect(await n.call(n.lead, "publish_bulletin", n.eventId, "FLASH", "Another flash", "x")).toMatchObject({ ok: false, code: "USE_FLASH" });

    await n.q("update events set current_phase = 'ROUNDS_13_21' where id = $1", [n.eventId]); // test-only jump
    const pub = await n.org("publish_flash_bulletin", n.eventId);
    expect(pub.bulletin.published_at).not.toBeNull();
    expect(await n.call(n.lead, "publish_flash_bulletin", n.eventId)).toMatchObject({ ok: false, code: "ALREADY_PUBLISHED" });
    expect(await n.call(n.lead, "prepare_flash_bulletin", n.eventId, "Late", "Too late.")).toMatchObject({ ok: false, code: "TOO_LATE" });
    expect(await rowsAs(db.pool, team, "select title from bulletins where event_id = $1", [n.eventId])).toEqual([{ title: "Interest rates rise" }]);
    expect((await n.one("select app.window_opened($1, 'FLASH') as v", [n.eventId])).v).toBe(true);
    const msg = await n.one("select event, payload from realtime.messages where topic = $1 and event = 'bulletin' order by id desc limit 1", [`event:${n.eventId}`]);
    expect(msg.payload).toMatchObject({ kind: "bulletin", bulletin_kind: "FLASH", title: "Interest rates rise" });
  });
});

describe("clock and health", () => {
  test("every signed-in account reads the server clock", async () => {
    const n = await Night.create(db.pool, 3);
    const [row] = await rowsAs<{ t: Date }>(db.pool, n.team(n.ev.plan.teams[0]!.code), "select public.server_time() as t");
    expect(Math.abs(new Date(row!.t).getTime() - Date.now())).toBeLessThan(60_000);
  });

  test("screens ping; staff see who is connected and whether their realtime works; nobody else does", async () => {
    const n = await Night.create(db.pool, 3);
    const codes = n.ev.plan.teams.map((t) => t.code);
    const [a, b] = [randomUUID(), randomUUID()];
    expect(await n.call(n.team(codes[0]!), "ping", a, null, "team", "SUBSCRIBED")).toMatchObject({ ok: true });
    await n.call(n.team(codes[1]!), "ping", b, null, "team", "CHANNEL_ERROR");
    await n.call(n.lead, "ping", randomUUID(), n.eventId, "admin", "SUBSCRIBED");
    // A team's ping always counts for its own event, whatever event id it sends.
    const other = await Night.create(db.pool, 3);
    await n.call(n.team(codes[2]!), "ping", randomUUID(), other.eventId, "team", "SUBSCRIBED");
    // Another account cannot take over a client id.
    await n.call(n.team(codes[1]!), "ping", a, null, "team", "CLOSED");
    expect((await n.one("select realtime, team_id from client_pings where client_id = $1", [a]))).toEqual({
      realtime: "SUBSCRIBED",
      team_id: n.teamId(codes[0]!),
    });
    await expect(n.call(n.team(codes[0]!), "ping", randomUUID(), null, "hacker", "SUBSCRIBED")).rejects.toThrow(/bad ping/);

    const health = await n.org("admin_health", n.eventId);
    expect(health.screens).toEqual(
      expect.arrayContaining([
        { area: "team", role: "TEAM", connected: 3, realtime_ok: 2 },
        { area: "admin", role: "ORGANISER", connected: 1, realtime_ok: 1 },
      ]),
    );
    expect(health.cron).toBeNull(); // no pg_cron in the test database
    await expect(n.call(n.team(codes[0]!), "admin_health", n.eventId)).rejects.toThrow(/only staff/);
    expect(await rowsAs(db.pool, n.team(codes[0]!), "select count(*)::int as c from client_pings")).toEqual([{ c: 0 }]);
    expect(await rowsAs(db.pool, n.lead, "select count(*)::int as c from client_pings where event_id = $1", [n.eventId])).toEqual([{ c: 4 }]);
    // A screen that stops pinging drops out after a minute.
    await n.q("update client_pings set last_seen = now() - interval '61 seconds' where client_id = $1", [b]);
    const later = await n.org("admin_health", n.eventId);
    expect(later.screens).toEqual(expect.arrayContaining([{ area: "team", role: "TEAM", connected: 2, realtime_ok: 2 }]));
  });

  test("event_status tells every screen where the event is; only those who can see the event may read it", async () => {
    const n = await Night.create(db.pool, 3);
    const other = await Night.create(db.pool, 3);
    const team = n.team(n.ev.plan.teams[0]!.code);
    const status = async (who: typeof team, event = n.eventId) =>
      (await rowsAs<{ s: any }>(db.pool, who, "select public.event_status($1) as s", [event]))[0]!.s;
    expect(await status(team)).toMatchObject({ phase: "SETUP", next_phase: "CHECKIN", gate: "Publish the seed commitment before the event starts.", trading: "HALTED", open_round: null, drawn: false });
    expect(await status(n.lead)).toMatchObject({ phase: "SETUP" });
    await expect(status(team, other.eventId)).rejects.toThrow(/no such event/);
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    expect(await status(team)).toMatchObject({ gate: null });
    await n.org("pause_event", n.eventId);
    expect(await status(team)).toMatchObject({ paused: true, trading: "PAUSED" });
  });

  test("tick errors of the last hour are counted", async () => {
    const n = await Night.create(db.pool, 3);
    await n.q("insert into error_log (event_id, source, message) values ($1, 'tick', 'lock timeout'), ($1, 'tick', 'old')", [n.eventId]);
    await n.q("update error_log set at = now() - interval '2 hours' where event_id = $1 and message = 'old'", [n.eventId]);
    expect(await n.org("admin_health", n.eventId)).toMatchObject({ tick_errors_last_hour: 1 });
  });
});
