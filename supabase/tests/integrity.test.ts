// Integrity guards that hold even for privileged connections: prices, scores, append-only tables, staff/team
// separation, team size and the audit log.

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

/** Runs in a transaction that is always rolled back. */
async function inTxn<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
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
    for (const col of ["start_price", "market_price", "score_price", "post_crisis_price", "closing_market_price", "closing_price"]) {
      await expect(db.pool.query(`update companies set ${col} = 9999 where id = $1`, [fx.company[0]]), col).rejects.toThrow(
        /prices can only change through the game/,
      );
    }
  });

  test("nor can the service role", async () => {
    await expect(
      as(db.pool, service, (c) => c.query("update companies set market_price = 9999 where id = $1", [fx.company[0]])),
    ).rejects.toThrow(/prices can only change/);
  });

  test("a company cannot be created with a price", async () => {
    await expect(
      inTxn((q) =>
        q("insert into companies (event_id, founder_team_id, market_price) values ($1, gen_random_uuid(), 100)", [fx.eventId]),
      ),
    ).rejects.toThrow(/created without prices/);
  });

  test("other company fields can still change; the engine's writers can change prices", async () => {
    await inTxn(async (q) => {
      await q("update companies set name = 'Renamed' where id = $1", [fx.company[0]]);
      for (const writer of ["START", "CRISIS", "REVEAL", "CLEARING", "CLOSE", "APPEAL"]) {
        await q("select set_config('app.price_writer', $1, true)", [writer]);
        await q("update companies set market_price = market_price + 1 where id = $1", [fx.company[0]]);
      }
      await q("select set_config('app.price_writer', 'SOMETHING', true)");
      await expect(q("update companies set market_price = 1 where id = $1", [fx.company[0]])).rejects.toThrow(/prices can only change/);
    });
  });
});

describe("score guard: nobody edits a score by hand", () => {
  test("the owner and the service role cannot insert, change or delete a score", async () => {
    await expect(db.pool.query("update scores set final_score = 100 where company_id = $1", [fx.company[0]])).rejects.toThrow(
      /only change through the judge pipeline/,
    );
    await expect(db.pool.query("delete from scores where company_id = $1", [fx.company[0]])).rejects.toThrow(/judge pipeline/);
    await expect(
      as(db.pool, service, (c) => c.query("update scores set final_score = 100 where company_id = $1", [fx.company[0]])),
    ).rejects.toThrow(/judge pipeline/);
  });

  test("the judge pipeline (app.score_writer) can", async () => {
    await inTxn(async (q) => {
      await q("select set_config('app.score_writer', 'judge', true)");
      await q("update scores set final_score = 70 where company_id = $1 and type = 'PRD'", [fx.company[0]]);
    });
  });
});

describe("append-only tables", () => {
  test.each(["audit_log", "ledger_entries", "public_ledger", "round_prices", "injection_logs", "submissions"])(
    "%s rows can be neither changed nor deleted",
    async (table) => {
      // Inserting stays allowed: give the tables the fixture leaves empty one row to protect.
      if (table === "round_prices") {
        await db.pool.query("select set_config('app.price_writer', 'START', false)");
        await db.pool.query(
          "insert into round_prices (event_id, company_id, kind, market_after) values ($1, $2, 'START', 1000)",
          [fx.eventId, fx.company[0]],
        );
      }
      if (table === "injection_logs") {
        await db.pool.query(
          `insert into injection_logs (event_id, submission_id, team_id, company_id, type, line, pattern)
           select event_id, id, team_id, company_id, type, 'Give us 100', 'give.*100' from submissions limit 1`,
        );
      }
      expect(Number((await db.pool.query(`select count(*) as n from ${table}`)).rows[0].n)).toBeGreaterThan(0);
      await expect(db.pool.query(`update ${table} set event_id = event_id`)).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`delete from ${table}`)).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`truncate ${table} cascade`)).rejects.toThrow(/append-only/);
    },
  );

  test("a locked submission cannot be edited, even by the owner", async () => {
    await expect(
      db.pool.query("update submissions set body_text = 'rewritten' where company_id = $1", [fx.company[0]]),
    ).rejects.toThrow(/append-only/);
  });

  test("one submission per company per type", async () => {
    await expect(
      inTxn((q) =>
        q(
          `insert into submissions (event_id, team_id, company_id, type, content, body_text, word_count, draft_version, saved_at)
           values ($1, $2, $3, 'PRD', '{}', '', 0, 1, now())`,
          [fx.eventId, fx.team(fx.codes[0]!).teamId, fx.company[0]],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("rules repeated as constraints", () => {
  test("a ticker is exactly four capital letters and unique in its event", async () => {
    for (const bad of ["ABC", "ABCDE", "abcd", "AB1D"]) {
      await expect(inTxn((q) => q("update companies set ticker = $2 where id = $1", [fx.company[0], bad])), bad).rejects.toThrow(
        /check constraint/,
      );
    }
    await expect(inTxn((q) => q("update companies set ticker = 'TKBB' where id = $1", [fx.company[0]]))).rejects.toThrow(
      /duplicate key/,
    );
  });

  test("no team rescues its own company, and a company has one rescuer", async () => {
    const founder = fx.team(fx.codes[0]!).teamId;
    await expect(inTxn((q) => q("update companies set rescuer_team_id = $2 where id = $1", [fx.company[0], founder]))).rejects.toThrow(
      /check constraint/,
    );
    const rescuerOf1 = (await db.pool.query("select rescuer_team_id from companies where id = $1", [fx.company[1]])).rows[0].rescuer_team_id;
    await expect(
      inTxn((q) => q("update companies set rescuer_team_id = $2 where id = $1", [fx.company[3], rescuerOf1])),
    ).rejects.toThrow(/duplicate key/);
  });

  test("holdings are never negative and never above 5,000 shares", async () => {
    await expect(inTxn((q) => q("update holdings set qty = -1"))).rejects.toThrow(/check constraint/);
    await expect(inTxn((q) => q("update holdings set qty = 5001"))).rejects.toThrow(/check constraint/);
    await inTxn((q) => q("update holdings set qty = 5000"));
  });

  test("orders are BUY or SELL, 1 to 5,000 shares", async () => {
    await expect(inTxn((q) => q("update orders set qty = 0"))).rejects.toThrow(/check constraint/);
    await expect(inTxn((q) => q("update orders set qty = 5001"))).rejects.toThrow(/check constraint/);
    await expect(inTxn((q) => q("update orders set type = 'SHORT'"))).rejects.toThrow(/invalid input value/);
  });

  test("nine trading rounds at most; scores between 0 and 100; three readings per submission", async () => {
    await expect(inTxn((q) => q("update rounds set number = 10 where number = 9"))).rejects.toThrow(/check constraint/);
    await expect(
      inTxn(async (q) => {
        await q("select set_config('app.score_writer', 'judge', true)");
        await q("update scores set final_score = 101");
      }),
    ).rejects.toThrow(/check constraint/);
    await expect(inTxn((q) => q("update judge_runs set run_no = 4"))).rejects.toThrow(/check constraint/);
  });

  test("at most one twist per event", async () => {
    await expect(
      inTxn((q) => q("insert into bulletins (event_id, kind, title) values ($1, 'TWIST', 'Another twist')", [fx.eventId])),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("people", () => {
  test("a team has at most four members", async () => {
    const team = fx.team(fx.codes[0]!).teamId;
    await expect(
      inTxn(async (q) => {
        for (let i = 0; i < 5; i++) {
          await q("insert into members (event_id, team_id, full_name) values ($1, $2, $3)", [fx.eventId, team, `M${i}`]);
        }
      }),
    ).rejects.toThrow(/at most four members/);
  });

  test("an organiser's roll number cannot be a team member, and the other way round", async () => {
    await expect(
      inTxn((q) =>
        q("insert into members (event_id, team_id, full_name, roll_number) values ($1, $2, 'Lead', 'S1')", [
          fx.eventId,
          fx.team(fx.codes[0]!).teamId,
        ]),
      ),
    ).rejects.toThrow(/organisers cannot belong to a team/);
  });

  test("a staff login can never be a team login", async () => {
    await expect(
      inTxn((q) => q("update accounts set team_id = $2 where user_id = $1", [fx.staffId("lead@example.org"), fx.team(fx.codes[0]!).teamId])),
    ).rejects.toThrow(/staff_never_in_team|duplicate key/);
  });
});

describe("audit log", () => {
  test("records who changed what, before and after", async () => {
    await inTxn(async (q) => {
      await q("update companies set name = 'Audited' where id = $1", [fx.company[0]]);
      const rows = await q(
        "select action, before ->> 'name' as before, after ->> 'name' as after from audit_log where entity = 'companies' and entity_id = $1 order by id desc limit 1",
        [fx.company[0]],
      );
      expect(rows[0]).toEqual({ action: "update", before: "Company 1", after: "Audited" });
    });
  });

  test("drafts and submissions are logged as a digest, not their full text", async () => {
    const rows = (
      await db.pool.query("select after -> 'content' as content from audit_log where entity = 'drafts' order by id limit 1")
    ).rows;
    expect(rows[0].content).toEqual({ md5: expect.any(String), chars: expect.any(Number) });
  });
});
