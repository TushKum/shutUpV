import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { eventStartIST } from "@msim/engine";
import { createTestDb } from "./pg";
import { as, rowsAs, seedEvent, service, user } from "./helpers";
import { buildSeedPlan, bulletinFromCsv, crisisCardsFromCsv, problemCardsFromCsv, toSeedPayload } from "../../scripts/lib/seed-plan";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("seed_event: the live event", () => {
  let eventId: string;
  const q = async (sql: string) => (await db.pool.query(sql, [eventId])).rows;

  beforeAll(async () => {
    const ev = await seedEvent(db.pool, {
      slug: "primus-2026",
      rehearsal: false,
      startsAt: eventStartIST("2026-11-20"),
      teamCount: 150,
      problemCards: problemCardsFromCsv(readFileSync("seed/problem-cards.csv", "utf8")),
      crisisCards: crisisCardsFromCsv(readFileSync("seed/crisis-cards.csv", "utf8")),
      twist: bulletinFromCsv(readFileSync("seed/twist.csv", "utf8"), "twist"),
    });
    eventId = ev.eventId;
  });

  test("150 teams T001–T150, each with a login and one company it founds", async () => {
    expect((await q("select count(*)::int as n from teams where event_id = $1"))[0].n).toBe(150);
    expect((await q("select min(code) as lo, max(code) as hi from teams where event_id = $1"))[0]).toEqual({ lo: "T001", hi: "T150" });
    expect(
      (await q("select count(*)::int as n from accounts a join teams t on t.id = a.team_id where t.event_id = $1"))[0].n,
    ).toBe(150);
    expect((await q("select count(*)::int as n, count(distinct founder_team_id)::int as f from companies where event_id = $1"))[0]).toEqual({
      n: 150,
      f: 150,
    });
    // Nothing is drawn, priced or rescued yet.
    expect(
      (await q("select count(*)::int as n from companies where event_id = $1 and (problem_card_id is not null or crisis_card_id is not null or rescuer_team_id is not null or market_price is not null)"))[0].n,
    ).toBe(0);
  });

  test("the night's schedule: 13 phases, 9 rounds, 7 deadlines, in SETUP", async () => {
    expect((await q("select count(*)::int as n from phases where event_id = $1"))[0].n).toBe(13);
    expect((await q("select count(*)::int as n from rounds where event_id = $1"))[0].n).toBe(9);
    expect((await q("select count(*)::int as n from deadlines where event_id = $1"))[0].n).toBe(7);
    expect((await q("select current_phase from events where id = $1"))[0].current_phase).toBe("SETUP");
    // Nothing has a time until an organiser starts the night: durations only.
    expect((await q("select count(*)::int as n from deadlines where event_id = $1 and at is not null"))[0].n).toBe(0);
    expect((await q("select count(*)::int as n from phases where event_id = $1 and (starts_at is not null or ends_at is not null)"))[0].n).toBe(0);
    expect((await q("select duration_seconds from phases where event_id = $1 and code = 'BUILD'"))[0].duration_seconds).toBe(6300);
    expect((await q("select duration_seconds from phases where event_id = $1 and code = 'AWARDS'"))[0].duration_seconds).toBeNull();
    expect((await q("select twist_offset_seconds, freeze_offset_seconds, started_at from events where id = $1"))[0]).toEqual({
      twist_offset_seconds: 3600,
      freeze_offset_seconds: 2700,
      started_at: null,
    });
  });

  test("decks and the twist (a draft until 22:15)", async () => {
    expect((await q("select count(*)::int as n from problem_cards where event_id = $1"))[0].n).toBe(50);
    expect((await q("select count(*)::int as n from crisis_cards where event_id = $1"))[0].n).toBe(10);
    expect(await q("select kind, title, published_at from bulletins where event_id = $1")).toEqual([
      { kind: "TWIST", title: "Your distributor wants 3% more margin", published_at: null },
    ]);
  });

  test("every team starts with $100,000, from the exchange, and the ledger balances", async () => {
    expect((await q("select min(cash_cents)::bigint as lo, max(cash_cents)::bigint as hi from teams where event_id = $1"))[0]).toEqual({
      lo: "10000000",
      hi: "10000000",
    });
    const { rows } = await db.pool.query(`
      select t.code from teams t left join ledger_entries l on l.team_id = t.id
       group by t.id having t.cash_cents <> coalesce(sum(l.cash_delta_cents), 0)`);
    expect(rows).toEqual([]);
    expect(
      (await q("select e.exchange_cash_cents + (select sum(cash_delta_cents) from ledger_entries where event_id = e.id and team_id is not null) as zero from events e where e.id = $1"))[0].zero,
    ).toBe("0");
  });

  test("a team can log in and read its own row", async () => {
    const t = (await q("select a.user_id, t.code from accounts a join teams t on t.id = a.team_id where t.event_id = $1 and t.code = 'T007'"))[0];
    const rows = await rowsAs<{ code: string; cash_cents: string }>(db.pool, user(t.user_id), "select code, cash_cents from teams");
    expect(rows).toEqual([{ code: "T007", cash_cents: "10000000" }]);
  });

  test("the live event cannot be purged once it has started", async () => {
    await db.pool.query("update events set current_phase = 'CHECKIN' where id = $1", [eventId]);
    await expect(as(db.pool, service, (c) => c.query("select public.purge_event('primus-2026')"))).rejects.toThrow(
      /only a rehearsal event or an event still in SETUP/,
    );
  });
});

describe("seed_event: rules", () => {
  test("the live event needs exactly 150 teams; any event at least 3", async () => {
    const plan = buildSeedPlan({
      slug: "small",
      name: "x",
      rehearsal: true,
      clockSpeed: 10,
      startsAt: new Date(),
      teamCount: 3,
      cardSecret: "test-secret-0123456789",
      emailDomain: "t.example.org",
      codeLetter: "Q",
    });
    const ids = new Map(plan.teams.map((t) => [t.email, crypto.randomUUID()]));
    for (const [email, id] of ids) await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    const payload = toSeedPayload(plan, ids);
    await expect(
      as(db.pool, service, (c) => c.query("select public.seed_event($1)", [{ ...payload, event: { ...payload.event, is_rehearsal: false } }])),
    ).rejects.toThrow(/exactly 150 teams/);
    await expect(
      as(db.pool, service, (c) => c.query("select public.seed_event($1)", [{ ...payload, teams: payload.teams.slice(0, 2) }])),
    ).rejects.toThrow(/between 3 and 150/);
  });

  test("a rehearsal is purged with everything in it (auth users are kept)", async () => {
    const ev = await seedEvent(db.pool, { slug: "rehearsal-x", teamCount: 5 });
    await as(db.pool, service, (c) => c.query("select public.purge_event('rehearsal-x')"), { commit: true });
    expect((await db.pool.query("select count(*)::int as n from events where slug = 'rehearsal-x'")).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int as n from teams where event_id = $1", [ev.eventId])).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int as n from ledger_entries where event_id = $1", [ev.eventId])).rows[0].n).toBe(0);
    const email = ev.plan.teams[0]!.email;
    expect((await db.pool.query("select count(*)::int as n from auth.users where email = $1", [email])).rows[0].n).toBe(1);
  });

  test("a staff account can never be seeded as a team login", async () => {
    const ev = await seedEvent(db.pool);
    const teamUser = ev.teams.get(ev.plan.teams[0]!.code)!.userId;
    const plan = buildSeedPlan({
      slug: "staffclash",
      name: "x",
      rehearsal: true,
      clockSpeed: 10,
      startsAt: new Date(),
      teamCount: 3,
      cardSecret: "test-secret-0123456789",
      emailDomain: "s.example.org",
      codeLetter: "W",
      staff: [{ email: "boss@example.org", role: "ORGANISER", name: "Boss" }],
    });
    const ids = new Map<string, string>(plan.teams.map((t) => [t.email, crypto.randomUUID()]));
    for (const [email, id] of ids) await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    ids.set("boss@example.org", teamUser);
    await expect(
      as(db.pool, service, (c) => c.query("select public.seed_event($1)", [toSeedPayload(plan, ids)])),
    ).rejects.toThrow(/already a team login/);
  });
});
