// Regression tests for the second review round (the re-review of the first fixes):
//   locking   a team's flood of requests never holds off the clearing (team actions lock only their own team row);
//             app.tick_all bounds a busy event's wait and keeps ticking the others
//   rules     an advance is refused while paused; an early advance that publishes the plans waits for a signature in
//             flight, which then counts as on time, and a later signature sees the window closed
//   security  an event cannot leave SETUP without a seed commitment; drafts keep only the template's fields, an
//             identical resubmission stores nothing, submissions are throttled and audited as a digest
//   money     correction amounts written with a decimal point (100.0) are applied; a flag decision that changes no
//             one's eligibility rewrites no results

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night } from "./night";
import { holdAsSuperuser, holdTx, settle, sleep, value, waitForLockWaiters } from "./race";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("review-round2");

/** A small event in ROUNDS_1_4 with IPO prices set (every pitch scored 60). */
async function trading(squads = 4) {
  const n = await Night.create(db.pool, squads);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "3");
  const s = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, x] of s.entries()) {
    await n.ok(n.team(x.p_code), "save_draft", "PITCH", { company_name: `Co ${i}`, ticker: `RT${"ABCDEFGH"[i]}`, problem: "A real problem." }, 0);
    await n.ok(n.team(x.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const x of s) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("ROUNDS_1_4");
  return { n, s };
}

describe("locking", () => {
  test("a flood of refused cancels and IPO bids from several funds never holds off the clearing", async () => {
    const { n, s } = await trading();
    await n.openRound(1);
    const order = (await n.ok(n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 100)).order;
    await n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [n.eventId]);

    // Six loops from three funds, for 1.5 s: cancels of an order that is not theirs (or is closed) and IPO bids outside
    // the IPO. Before the second round of fixes each call took a share lock on the round or the event before queuing
    // on its own team row, and the stream of share locks kept the clearing waiting until it stopped.
    const until = performance.now() + 1500;
    let calls = 0;
    const flood = [1, 2, 3, 1, 2, 3].map(async (i) => {
      const fund = n.team(s[i]!.f_code);
      while (performance.now() < until) {
        await n.q("delete from rate_limits where team_id = $1", [n.teamId(s[i]!.f_code)]);
        await n.call(fund, "cancel_order", order.id);
        await n.call(fund, "place_ipo_bid", s[0]!.company_id, 10);
        calls += 2;
      }
    });
    await sleep(300);
    const started = performance.now();
    const tick = await n.call(n.lead, "tick", n.eventId);
    const ms = performance.now() - started;
    await Promise.all(flood);
    expect(tick).toMatchObject({ ok: true });
    expect(tick.actions).toContain("cleared 1");
    expect(calls).toBeGreaterThan(50);
    expect(ms, "the tick finished while the flood was still running").toBeLessThan(800);
    await n.checkInvariants();
  });

  test("app.tick_all gives up on a busy event after a few seconds, logs it, and still ticks the others", async () => {
    const a = await trading(3);
    const b = await trading(3);
    for (const g of [a, b]) {
      await g.n.openRound(1);
      await g.n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [g.n.eventId]);
    }
    // An organiser action on event A that does not finish (held here by a superuser lock on A's row).
    const held = await holdAsSuperuser(db.pool, "select 1 from events where id = $1 for no key update", [a.n.eventId]);
    const started = performance.now();
    const ticked = await db.pool.query("select app.tick_all() as n");
    const ms = performance.now() - started;
    await held.release();
    expect(ms).toBeLessThan(6000);
    expect((await b.n.one("select status from rounds where event_id = $1 and number = 1", [b.n.eventId])).status).toBe("CLEARED");
    expect((await a.n.one("select status from rounds where event_id = $1 and number = 1", [a.n.eventId])).status).toBe("OPEN");
    const logged = await a.n.q("select message, context from error_log where event_id = $1 and source = 'tick'", [a.n.eventId]);
    expect(logged).toHaveLength(1);
    expect(logged[0].context).toMatchObject({ sqlstate: "55P03" }); // lock_not_available
    expect(ticked.rows[0].n).toBeGreaterThanOrEqual(1);
    // The next heartbeat clears A.
    await db.pool.query("select app.tick_all()");
    expect((await a.n.one("select status from rounds where event_id = $1 and number = 1", [a.n.eventId])).status).toBe("CLEARED");
  });
});

describe("rules", () => {
  test("an advance is refused while the event is paused", async () => {
    const { n } = await trading(3);
    await n.org("pause_event", n.eventId);
    expect(await n.call(n.lead, "advance_phase", n.eventId, "ROUNDS_1_4")).toMatchObject({ ok: false, code: "PAUSED" });
    await n.org("resume_event", n.eventId);
    await n.advanceTo("CRISIS");
  });

  async function rescue2() {
    const { n, s } = await trading(3);
    await n.advanceTo("CRISIS");
    await n.advanceTo("RESCUE_2");
    const x = s[0]!;
    const post = (await n.one("select post_crisis_price from companies where id = $1", [x.company_id])).post_crisis_price;
    await n.ok(n.team(x.c_code), "edit_deal", null, post);
    const deal = (await n.ok(n.team(x.f_code), "edit_deal", 4_000_000, null)).deal;
    await n.ok(n.team(x.p_code), "sign_deal", deal.version);
    await n.ok(n.team(x.f_code), "sign_deal", deal.version);
    return { n, x, deal };
  }

  test("an early advance to PLANS_PUBLISHED waits for a last signature in flight, which then counts as on time", async () => {
    const { n, x, deal } = await rescue2();
    const sign = holdTx(db.pool, n.team(x.c_code), async (c) => (await c.query("select public.sign_deal($1) as r", [deal.version])).rows[0].r);
    expect(await sign.started).toMatchObject({ ok: true });
    const advance = settle(n.call(n.lead, "advance_phase", n.eventId, "RESCUE_2"));
    await waitForLockWaiters(db.pool, 1);
    await sign.commit();
    expect(value(await advance, "advance_phase")).toMatchObject({ ok: true });
    expect(await n.phase()).toBe("PLANS_PUBLISHED");
    const d = await n.one("select executed_at, (select at from deadlines where event_id = $1 and code = 'DEAL') as deadline from deals where id = $2", [n.eventId, deal.id]);
    expect(d.executed_at).not.toBeNull();
    expect(new Date(d.executed_at).getTime()).toBeLessThanOrEqual(new Date(d.deadline).getTime());
    expect((await n.one("select app.deal_signed_in_time($1) as v", [x.company_id])).v).toBe(true);
  });

  test("a signature that arrives while the advance to PLANS_PUBLISHED is in flight sees the window closed", async () => {
    const { n, x, deal } = await rescue2();
    const advance = holdTx(db.pool, n.lead, async (c) => (await c.query("select public.advance_phase($1, 'RESCUE_2') as r", [n.eventId])).rows[0].r);
    expect(await advance.started).toMatchObject({ ok: true });
    const sign = settle(n.call(n.team(x.c_code), "sign_deal", deal.version));
    await waitForLockWaiters(db.pool, 1);
    await advance.commit();
    expect(value(await sign, "sign_deal")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect((await n.one("select executed_at from deals where id = $1", [deal.id])).executed_at).toBeNull();
  });
});

describe("security", () => {
  test("an event cannot leave SETUP without a published seed commitment", async () => {
    const n = await Night.create(db.pool, 3);
    expect(await n.call(n.lead, "advance_phase", n.eventId, "SETUP")).toMatchObject({ ok: false, code: "GATE" });
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("CHECKIN");
  });

  test("drafts keep only the template's fields; an identical resubmission stores nothing; submissions are throttled and audited as a digest", async () => {
    const n = await Night.create(db.pool, 3);
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, "3");
    await n.advanceTo("BUILD");
    const x = await n.squad(1);
    const p = n.team(x.p_code);
    const padding = "x".repeat(15_000);
    const saved = await n.ok(p, "save_draft", "PITCH", { company_name: "Padded", ticker: "PAD", problem: "Water.", notes: padding }, 0);
    expect(Object.keys(saved.draft.content).sort()).toEqual(["company_name", "problem", "ticker"]);
    expect(await n.call(p, "save_draft", "PITCH", { problem: { nested: true } }, 1)).toMatchObject({ ok: false, code: "BAD_CONTENT" });

    const first = await n.ok(p, "submit_submission", "PITCH");
    const again = await n.ok(p, "submit_submission", "PITCH");
    expect(again).toMatchObject({ duplicate: true });
    expect(again.submission.id).toBe(first.submission.id);
    expect((await n.one("select count(*)::int as c from submissions where company_id = $1", [x.company_id])).c).toBe(1);

    // The audit log keeps a digest of what was submitted, not the text.
    const audited = await n.q("select after from audit_log where entity = 'submissions' and entity_id = $1", [first.submission.id]);
    expect(audited[0].after.content).toEqual({ md5: expect.any(String), chars: expect.any(Number) });
    expect(audited[0].after.body_text).toEqual({ md5: expect.any(String), chars: expect.any(Number) });

    // 10 submissions a minute per team; the duplicate above counted.
    const results = [];
    for (let i = 0; i < 10; i++) {
      const v = (await n.one("select version from submission_drafts where squad_id = $1 and type = 'PITCH'", [x.id])).version;
      await n.ok(p, "save_draft", "PITCH", { company_name: "Padded", ticker: "PAD", problem: `Water, take ${i}.` }, v);
      results.push(await n.call(p, "submit_submission", "PITCH"));
    }
    expect(results.slice(0, 8).every((r) => r.ok)).toBe(true);
    expect(results.slice(8)).toEqual([
      expect.objectContaining({ ok: false, code: "RATE_LIMITED" }),
      expect.objectContaining({ ok: false, code: "RATE_LIMITED" }),
    ]);
  });
});

describe("money", () => {
  test("correction amounts written with a decimal point are applied; a null lot is refused when requested", async () => {
    const { n, s } = await trading(3);
    const fund = n.teamId(s[1]!.f_code);
    const before = Number((await n.one("select cash_cents from teams where id = $1", [fund])).cash_cents);
    const req = await n.org("request_correction", n.eventId, "Refund written with a decimal point", JSON.stringify([{ team_id: fund, cash_delta_cents: 100.0 }]).replace(":100}", ":100.0}"));
    await n.ok(n.second, "decide_correction", req.correction_id, true, null);
    expect(Number((await n.one("select cash_cents from teams where id = $1", [fund])).cash_cents)).toBe(before + 100);
    await expect(
      n.call(n.lead, "request_correction", n.eventId, "Share entry without a lot", JSON.stringify([{ team_id: fund, company_id: s[0]!.company_id, lot: null, share_delta: 5 }])),
    ).rejects.toThrow(/unknown lot|needs a company of this event and a lot/);
    await n.checkInvariants();
  });

  test("a flag decision that changes no one's eligibility rewrites no results", async () => {
    const { n, s } = await trading(3);
    const [f1, f2] = [n.teamId(s[0]!.f_code), n.teamId(s[1]!.f_code)];
    // Results as settlement would leave them (test-only rows), and two flags naming f1.
    for (const [i, t] of [f1, f2].entries()) {
      await n.q(
        "insert into results (event_id, team_id, track, final_value_cents, start_value_cents, rank) values ($1, $2, 'FINANCE', $3, 50000000, $4)",
        [n.eventId, t, 60_000_000 - i * 1_000_000, i + 1],
      );
    }
    const flag = async (teams: string[]) =>
      (await n.one("insert into flags (event_id, kind, team_ids, details) values ($1, 2, $2, '{}') returning id", [n.eventId, teams])).id;
    const a = await flag([f1, f2]);
    const b = await flag([f1]);
    const fairnessRows = async () =>
      (await n.one("select count(*)::int as c from audit_log where event_id = $1 and entity in ('results', 'awards') and actor_role = 'FAIRNESS'", [n.eventId])).c;

    await n.ok(n.fairness, "decide_flag", a, "CLEARED", "Independent trading.");
    expect(await fairnessRows()).toBe(0); // nothing changed, nothing written
    await n.ok(n.fairness, "decide_flag", b, "DISQUALIFIED", "Copied another fund's orders.");
    expect(await fairnessRows()).toBeGreaterThan(0);
    expect(await n.one("select eligible, rank from results where team_id = $1", [f1])).toEqual({ eligible: false, rank: null });
    expect(await n.one("select eligible, rank from results where team_id = $1", [f2])).toEqual({ eligible: true, rank: 1 });
    // Organisers see neither flag in the audit log.
    expect((await rowsAs(db.pool, n.lead, "select count(*)::int as c from audit_log where entity = 'flags'")).at(0)).toEqual({ c: 0 });
  });
});
