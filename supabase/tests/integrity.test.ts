// Integrity guards that hold even for privileged connections: prices, append-only tables,
// staff/team separation and the audit log.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { as, service } from "./helpers";
import { buildFixture, type Fixture } from "./fixtures";

let db: Awaited<ReturnType<typeof createTestDb>>;
let fx: Fixture;

beforeAll(async () => {
  db = await createTestDb();
  fx = await buildFixture(db.pool);
});
afterAll(async () => {
  await db.drop();
});

async function inTxn<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    const out = await fn(async (sql, p = []) => (await c.query(sql, p)).rows);
    await c.query("rollback");
    return out;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

describe("price guard: nobody edits a price directly", () => {
  test("the database owner cannot change a price without going through the engine", async () => {
    await expect(db.pool.query("update companies set market_price = 9999 where id = $1", [fx.company[0]])).rejects.toThrow(
      /prices can only change through clearing, the crisis shock or a score tier/,
    );
    await expect(db.pool.query("update companies set ai_price = 1 where id = $1", [fx.company[0]])).rejects.toThrow(/prices can only change/);
  });

  test("nor can the service role", async () => {
    await expect(
      as(db.pool, service, (c) => c.query("update companies set market_price = 9999 where id = $1", [fx.company[0]])),
    ).rejects.toThrow(/prices can only change/);
  });

  test("a company cannot be created with a price", async () => {
    await expect(
      db.pool.query("insert into companies (event_id, product_team_id, market_price) values ($1, $2, 100)", [
        fx.eventId,
        fx.team(fx.code("P", 1)).teamId,
      ]),
    ).rejects.toThrow(/created without prices/);
  });

  test("other company fields can still change; engine writers (clearing, crisis, tier) can change prices", async () => {
    await inTxn(async (q) => {
      await q("update companies set name = 'Renamed' where id = $1", [fx.company[0]]);
      for (const writer of ["CLEARING", "CRISIS", "TIER"]) {
        await q("select set_config('app.price_writer', $1, true)", [writer]);
        await q("update companies set market_price = market_price + 1 where id = $1", [fx.company[0]]);
      }
      expect(await q("select market_price from companies where id = $1", [fx.company[0]])).toEqual([{ market_price: 1053 }]);
    });
  });

  test("an unknown writer name is refused", async () => {
    await expect(
      inTxn(async (q) => {
        await q("select set_config('app.price_writer', 'ADMIN', true)");
        await q("update companies set market_price = 1 where id = $1", [fx.company[0]]);
      }),
    ).rejects.toThrow(/prices can only change/);
  });
});

describe("append-only records", () => {
  test.each(["ledger_entries", "audit_log", "public_ledger", "round_prices", "injection_logs"])(
    "%s rows cannot be updated, deleted or truncated",
    async (table) => {
      await expect(db.pool.query(`update ${table} set event_id = event_id`)).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`delete from ${table}`)).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`truncate ${table} cascade`)).rejects.toThrow(/append-only/);
    },
  );

  test("a submitted text cannot be edited; it can only be superseded by a newer submission", async () => {
    await expect(db.pool.query("update submissions set body_text = 'edited' where company_id = $1", [fx.company[0]])).rejects.toThrow(
      /immutable/,
    );
    await expect(db.pool.query("delete from submissions where company_id = $1", [fx.company[0]])).rejects.toThrow(/immutable/);
    await inTxn(async (q) => {
      await q("update submissions set superseded_at = now() where company_id = $1 and type = 'PITCH' and superseded_at is null", [
        fx.company[0],
      ]);
    });
  });
});

describe("organiser accounts cannot belong to a team", () => {
  test("a staff login cannot be attached to a team", async () => {
    await expect(
      db.pool.query("update accounts set team_id = $2 where user_id = $1", [fx.staffId("lead@example.org"), fx.team(fx.code("F", 3)).teamId]),
    ).rejects.toThrow(/staff_never_in_team/);
  });

  test("a team login cannot become a staff login", async () => {
    await expect(
      db.pool.query("update accounts set role = 'ORGANISER' where user_id = $1", [fx.team(fx.code("F", 3)).userId]),
    ).rejects.toThrow(/staff_never_in_team/);
  });

  test("an organiser (by roll number) cannot be added as a team member, and vice versa", async () => {
    await expect(
      db.pool.query("insert into members (event_id, team_id, full_name, roll_number) values ($1, $2, 'Lead', 'S1')", [
        fx.eventId,
        fx.team(fx.code("P", 2)).teamId,
      ]),
    ).rejects.toThrow(/organisers cannot belong to a team/);

    await inTxn(async (q) => {
      await q("insert into members (event_id, team_id, full_name, roll_number) values ($1, $2, 'Student', 'R777')", [
        fx.eventId,
        fx.team(fx.code("P", 2)).teamId,
      ]);
      await expect(
        q("update accounts set roll_number = 'R777' where user_id = $1", [fx.staffId("exchange@example.org")]),
      ).rejects.toThrow(/organisers cannot belong to a team/);
    });
  });
});

describe("audit log", () => {
  test("records who, what, before and after", async () => {
    const before = await db.pool.query("select max(id) as id from audit_log");
    await inTxn(async (q) => {
      await q("select set_config('app.actor', 'exchange-desk', true)");
      await q("update teams set name = 'Renamed fund' where id = $1", [fx.team(fx.code("F", 2)).teamId]);
      const rows = (await q("select * from audit_log where id > $1 and entity = 'teams'", [before.rows[0].id ?? 0])) as Record<string, any>[];
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      expect(r.action).toBe("update");
      expect(r.actor_role).toBe("exchange-desk");
      expect(r.event_id).toBe(fx.eventId);
      expect(r.entity_id).toBe(fx.team(fx.code("F", 2)).teamId);
      expect(r.before.name).not.toBe("Renamed fund");
      expect(r.after.name).toBe("Renamed fund");
      expect(r.at).toBeInstanceOf(Date);
    });
  });

  test("attributes changes made by a signed-in caller to that account", async () => {
    // Simulates a game function running for a team (SECURITY DEFINER keeps the caller's JWT).
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const userId = fx.team(fx.code("F", 1)).userId;
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
      await c.query("update ipo_bids set qty_requested = 200 where team_id = $1", [fx.team(fx.code("F", 1)).teamId]);
      const { rows } = await c.query("select actor_user_id, actor_role, actor_team_id from audit_log where entity = 'ipo_bids' order by id desc limit 1");
      expect(rows[0]).toEqual({ actor_user_id: userId, actor_role: "TEAM", actor_team_id: fx.team(fx.code("F", 1)).teamId });
      await c.query("rollback");
    } finally {
      c.release();
    }
  });

  test("seeding was audited", async () => {
    const { rows } = await db.pool.query(
      "select count(*)::int as n from audit_log where event_id = $1 and entity = 'teams' and action = 'insert' and actor_role = 'seed'",
      [fx.eventId],
    );
    expect(rows[0].n).toBe(9);
  });
});
