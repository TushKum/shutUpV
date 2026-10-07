import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { as, rowsAs, seedEvent, service, user } from "./helpers";
import { buildSeedPlan, toSeedPayload } from "../../scripts/lib/seed-plan";
import { randomUUID } from "node:crypto";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("seed_event: the live event", () => {
  test("creates 150 teams, 50 companies, accounts, schedule, decks and starting cash in one call", async () => {
    const ev = await seedEvent(db.pool, { slug: "live-2026", rehearsal: false, teamsPerTrack: 50 });
    const q = async (sql: string) => (await db.pool.query(sql, [ev.eventId])).rows;

    expect(await q("select track, count(*)::int as n from teams where event_id = $1 group by track order by track")).toEqual([
      { track: "PRODUCT", n: 50 },
      { track: "CONSULTING", n: 50 },
      { track: "FINANCE", n: 50 },
    ]);
    expect((await q("select count(*)::int as n from companies where event_id = $1"))[0].n).toBe(50);
    expect(
      (await q("select count(*)::int as n from accounts a join teams t on t.id = a.team_id where t.event_id = $1"))[0].n,
    ).toBe(150);
    expect((await q("select count(*)::int as n from phases where event_id = $1"))[0].n).toBe(19);
    expect((await q("select count(*)::int as n from rounds where event_id = $1"))[0].n).toBe(21);
    expect((await q("select count(*)::int as n from deadlines where event_id = $1"))[0].n).toBe(13);
    expect((await q("select current_phase from events where id = $1"))[0].current_phase).toBe("SETUP");

    // Starting cash: Finance $500,000 (50,000,000 cents), Product and Consulting $0.
    expect(await q("select track, min(cash_cents)::bigint as lo, max(cash_cents)::bigint as hi from teams where event_id = $1 group by track order by track")).toEqual([
      { track: "PRODUCT", lo: "0", hi: "0" },
      { track: "CONSULTING", lo: "0", hi: "0" },
      { track: "FINANCE", lo: "50000000", hi: "50000000" },
    ]);
  });

  test("every team's cash equals the sum of its ledger entries, and the ledger balances", async () => {
    const { rows } = await db.pool.query(`
      select t.code, t.cash_cents, coalesce(sum(l.cash_delta_cents), 0) as ledger
      from teams t left join ledger_entries l on l.team_id = t.id
      group by t.id having t.cash_cents <> coalesce(sum(l.cash_delta_cents), 0)`);
    expect(rows).toEqual([]);
    const bal = await db.pool.query(
      "select e.exchange_cash_cents + (select sum(cash_delta_cents) from ledger_entries where event_id = e.id and team_id is not null) as zero from events e",
    );
    for (const r of bal.rows) expect(Number(r.zero)).toBe(0);
  });

  test("the live event needs exactly 50 teams per track", async () => {
    const plan = buildSeedPlan({
      slug: "short-live",
      name: "x",
      rehearsal: true, // build a small plan, then claim it is live
      clockSpeed: 1,
      startsAt: new Date(),
      teamsPerTrack: 3,
      cardSecret: "test-secret-0123456789",
      emailDomain: "x.org",
    });
    const ids = new Map<string, string>();
    for (const t of plan.teams) {
      const id = randomUUID();
      await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, t.email]);
      ids.set(t.email, id);
    }
    const payload = toSeedPayload(plan, ids);
    payload.event.is_rehearsal = false;
    await expect(
      as(db.pool, service, (c) => c.query("select public.seed_event($1)", [payload])),
    ).rejects.toThrow(/exactly 50 teams per track/);
  });

  test("teams cannot call seed_event or purge_event", async () => {
    const ev = await seedEvent(db.pool);
    const me = [...ev.teams.values()][0]!.userId;
    await expect(rowsAs(db.pool, user(me), "select public.seed_event('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(rowsAs(db.pool, user(me), "select public.purge_event('x')")).rejects.toThrow(/permission denied/);
  });

  test("purge_event removes a rehearsal event but refuses a live event that has started", async () => {
    const ev = await seedEvent(db.pool);
    await as(db.pool, service, (c) => c.query("select public.purge_event($1)", [ev.plan.event.slug]), { commit: true });
    expect((await db.pool.query("select count(*)::int as n from teams where event_id = $1", [ev.eventId])).rows[0].n).toBe(0);
    // Auth users survive so the seed script can reuse them.
    expect((await db.pool.query("select count(*)::int as n from auth.users where email = $1", [ev.plan.teams[0]!.email])).rows[0].n).toBe(1);

    await db.pool.query("update events set current_phase = 'CHECKIN' where slug = 'live-2026'");
    await expect(
      as(db.pool, service, (c) => c.query("select public.purge_event('live-2026')")),
    ).rejects.toThrow(/only a rehearsal event or an event still in SETUP/);
  });
});
