// Regression tests for the schedule and scoring-window findings of the SQL review:
//   R1          a late draw keeps the 10-event-minute problem-card pick; an early SQUAD_DRAW → BUILD advance leaves the
//               pick open until its deadline
//   R2 / SEC-4  an early advance closes the windows for the work it publishes (PITCH at READING, PLAN and DEAL at
//               PLANS_PUBLISHED); consultant calls close before the price they are judged against is known
//   R3 / MONEY-2 scores are sealed only once nothing can change what is judged (the submission deadline, and for a plan
//               the deal deadline that decides the cap)
//   R6          a pause during a gate wait is counted once
//   R7          extending during a pause extends what was running when the pause began
//   R8          pitch scores (and the IPO prices) wait for consultant call 1 to close
// Each test plays its own small event (3 squads) through the real game functions as the real callers; the clock is
// moved by editing the schedule, as night.ts does. Tests that mention a second-round case cover what the first fixes missed.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyTier, ipoPrice, sha256Hex, tierBp } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const SEED = sha256Hex("review-schedule"); // 64 hex characters, as run_lottery requires
type Squad = Awaited<ReturnType<Night["squad"]>>;

// ───────────── Driving an event ─────────────

/**
 * A new event with its seed commitment published in SETUP (the day before). SETUP is planned two hours back, as on
 * the night (19:00–20:00, before anything that can shift the schedule), instead of at the moment of seeding.
 */
async function fresh(squads = 3) {
  const n = await Night.create(db.pool, squads);
  await n.q("update phases set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where event_id = $1 and code = 'SETUP'", [n.eventId]);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  return n;
}

async function squadsOf(n: Night) {
  const count = (await n.one("select count(*)::int as c from squads where event_id = $1", [n.eventId])).c;
  const s: Squad[] = [];
  for (let i = 1; i <= count; i++) s.push(await n.squad(i));
  return s;
}

/** A new event, drawn on time in SQUAD_DRAW. */
async function drawn(squads = 3) {
  const n = await fresh(squads);
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "4");
  return { n, s: await squadsOf(n) };
}

const pitchOf = (s: Squad, problem = "Unsafe water in small towns.") => ({
  company_name: `Company ${s.number}`,
  ticker: `TK${"ABCDEFG"[s.number - 1]}`,
  problem,
  solution: "Sensors in every tank.",
  customers: "Town councils.",
  business_model: "Yearly subscription per tank.",
  advantage: "Cheaper than lab tests.",
  use_of_seed: "First 100 sensors.",
});

const planOf = (crisis = "The supplier stopped deliveries.") => ({
  crisis,
  new_plan: "License the software.",
  money: "Costs $60,000.",
  deal: "$40,000 at the post-crisis price.",
  time_to_recovery: "Nine months.",
  risks: "Partners may refuse.",
  next_steps: "Sign two partners.",
});

async function draftVersion(n: Night, s: Squad, type: string): Promise<number> {
  return (await n.one("select version from submission_drafts where squad_id = $1 and type = $2", [s.id, type])).version;
}

/** The squad's Product team saves the draft and submits it. Returns the first refusal, or the submit result. */
async function submit(n: Night, s: Squad, type: "PITCH" | "PLAN" | "FLASH", content: object) {
  const who = n.team(s.p_code);
  const saved = await n.call(who, "save_draft", type, content, await draftVersion(n, s, type));
  if (!saved.ok) return saved;
  return n.call(who, "submit_submission", type);
}

/** Consulting proposes the post-crisis price, Finance $40,000; then `signers` sign. Returns the deal. */
async function dealFor(n: Night, s: Squad, signers: string[] = [s.p_code, s.c_code, s.f_code]) {
  const post = (await n.one("select post_crisis_price from companies where id = $1", [s.company_id])).post_crisis_price;
  await n.ok(n.team(s.c_code), "edit_deal", null, post);
  const deal = (await n.ok(n.team(s.f_code), "edit_deal", 4_000_000, null)).deal;
  for (const code of signers) await n.ok(n.team(code), "sign_deal", deal.version);
  return deal;
}

/** From SQUAD_DRAW: every pitch in, judged after 22:30, released after 23:15. Ends in READING. */
async function pitchesReleased(n: Night, s: Squad[]) {
  await n.advanceTo("BUILD");
  for (const x of s) expect(await submit(n, x, "PITCH", pitchOf(x))).toMatchObject({ ok: true });
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const x of s) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
}

/** From RESCUE_2: every plan in, judged after 03:00, released at VERDICTS. Ends in ROUNDS_13_21. */
async function plansReleased(n: Night, s: Squad[]) {
  for (const x of s) expect(await submit(n, x, "PLAN", planOf())).toMatchObject({ ok: true });
  await n.deadlinePassed("PLAN");
  await n.deadlinePassed("DEAL");
  await n.advanceTo("PLANS_PUBLISHED");
  for (const x of s) expect(await n.judge(x.company_id, "PLAN", [70, 70, 70])).toMatchObject({ ok: true });
  await n.advanceTo("VERDICTS");
  await n.org("release_scores", n.eventId, "PLAN");
  await n.advanceTo("ROUNDS_13_21");
}

/** In ROUNDS_13_21: rounds 13–17 cleared, the flash news out, every answer in. Flash scores are not sealed. */
async function flashAnswered(n: Night, s: Squad[]) {
  for (const r of [13, 14, 15, 16, 17]) {
    await n.openRound(r);
    await n.clearRound(r);
  }
  await n.org("publish_bulletin", n.eventId, "FLASH", "Interest rates rise", "Investors want profit within 12 months.");
  for (const x of s) expect(await submit(n, x, "FLASH", { answer: `Squad ${x.number} stays profitable by licensing.` })).toMatchObject({ ok: true });
}

/** Runs several statements in one transaction, so that they share one now(). `:event` is the event id. */
async function atOnce(n: Night, statements: string) {
  await n.pool.query(statements.replaceAll(":event", `'${n.eventId}'::uuid`));
}

/** Pauses through pause_event, then dates the start of the pause `minutesAgo` back. */
async function pausedSince(n: Night, minutesAgo: number) {
  await n.org("pause_event", n.eventId);
  await n.q("update events set paused_at = now() - make_interval(secs => $2::float8 * 60) where id = $1", [n.eventId, minutesAgo]);
}

/** Lets `minutes` of event time pass: every planned time moves that much earlier. */
async function elapse(n: Night, minutes: number) {
  const d = `${minutes} minutes`;
  await n.q("update phases set starts_at = starts_at - $2::interval, ends_at = ends_at - $2::interval where event_id = $1", [n.eventId, d]);
  await n.q("update deadlines set at = at - $2::interval where event_id = $1", [n.eventId, d]);
  await n.q("update rounds set opens_at = opens_at - $2::interval, closes_at = closes_at - $2::interval where event_id = $1", [n.eventId, d]);
}

// ───────────── Reading the schedule ─────────────

const phaseRow = (n: Night, code: string) =>
  n.one<{ starts_at: Date; ends_at: Date; started_at: Date | null; ended_at: Date | null }>(
    "select starts_at, ends_at, started_at, ended_at from phases where event_id = $1 and code = $2", [n.eventId, code]);
const deadlineAt = async (n: Night, code: string): Promise<Date> =>
  (await n.one("select at from deadlines where event_id = $1 and code = $2", [n.eventId, code])).at;
const roundRow = (n: Night, num: number) => n.one("select * from rounds where event_id = $1 and number = $2", [n.eventId, num]);
/** Minutes from b to a. */
const mins = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;
/** Minutes from the database's clock to a deadline (negative: passed). */
const minutesLeft = async (n: Night, code: string) =>
  Number((await n.one("select extract(epoch from at - clock_timestamp()) / 60 as m from deadlines where event_id = $1 and code = $2", [n.eventId, code])).m);

async function schedule(n: Night) {
  return {
    phases: await n.q("select code, starts_at, ends_at from phases where event_id = $1 order by seq", [n.eventId]),
    deadlines: await n.q("select code, at from deadlines where event_id = $1 order by code", [n.eventId]),
    rounds: await n.q("select number, opens_at, closes_at from rounds where event_id = $1 order by number", [n.eventId]),
  };
}

const chosen = (n: Night) =>
  n.q("select number, chosen_card_id, chosen_by_default, dealt_card_ids from squads where event_id = $1 order by number", [n.eventId]);

/** Coverage pairs, grouped so that [0] and [1] are the two companies one consultant covers. */
async function coverage(n: Night) {
  const rows = await n.q<{ code: string; company_id: string }>(
    "select t.code, k.company_id from coverage k join teams t on t.id = k.consultant_team_id where k.event_id = $1 order by t.code, k.company_id",
    [n.eventId]);
  expect(rows[0]!.code).toBe(rows[1]!.code);
  return { code: rows[0]!.code, x: rows[0]!.company_id, y: rows[1]!.company_id };
}

// ═════════════════════════════ R1 ═════════════════════════════

describe("R1: the problem-card pick after the draw", () => {
  test("R1: a draw 2 minutes late still gives every squad 10 minutes to pick, and BUILD keeps its 80 minutes", async () => {
    const n = await fresh();
    await n.advanceTo("SQUAD_DRAW");
    // 21:10 (end of the draw, the pick deadline, start of BUILD) was 2 minutes ago and the lottery is only drawn now.
    await atOnce(n, `
      update phases set starts_at = now() - interval '12 minutes', ends_at = now() - interval '2 minutes' where event_id = :event and code = 'SQUAD_DRAW';
      update phases set starts_at = now() - interval '2 minutes', ends_at = now() + interval '78 minutes' where event_id = :event and code = 'BUILD';
      update deadlines set at = now() - interval '2 minutes' where event_id = :event and code = 'PROBLEM_PICK';`);
    await n.org("run_lottery", n.eventId, SEED, "4");

    const left = await minutesLeft(n, "PROBLEM_PICK");
    expect(left).toBeGreaterThan(9.9);
    expect(left).toBeLessThanOrEqual(10);
    // The end of the draw and all of BUILD moved with the pick deadline.
    const pick = await deadlineAt(n, "PROBLEM_PICK");
    expect((await phaseRow(n, "SQUAD_DRAW")).ends_at).toEqual(pick);
    const build = await phaseRow(n, "BUILD");
    expect(build.starts_at).toEqual(pick);
    expect(mins(build.ends_at, build.starts_at)).toBeCloseTo(80, 3);

    // The next tick, with auto-advance on, neither applies the default cards nor leaves the draw.
    await n.org("set_auto_advance", n.eventId, true);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.phase()).toBe("SQUAD_DRAW");
    expect((await chosen(n)).filter((x) => x.chosen_card_id !== null)).toEqual([]);
    const s1 = await n.squad(1);
    expect(await n.call(n.team(s1.p_code), "pick_problem_card", s1.dealt_card_ids[1])).toMatchObject({ ok: true });

    // Ten minutes later the tick defaults the others and moves on to an 80-minute BUILD.
    await elapse(n, 10);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.phase()).toBe("BUILD");
    const after = await chosen(n);
    expect(after[0]).toMatchObject({ chosen_card_id: s1.dealt_card_ids[1], chosen_by_default: false });
    for (const x of after.slice(1)) expect(x).toMatchObject({ chosen_card_id: x.dealt_card_ids[0], chosen_by_default: true });
    const started = await phaseRow(n, "BUILD");
    expect(mins(started.ends_at, started.started_at!)).toBeCloseTo(80, 1);
  });

  test("R1: at rehearsal speed (clock ×10) a late draw gives 10 event minutes, i.e. 1 real minute", async () => {
    const n = await fresh();
    await n.q("update events set clock_speed = 10 where id = $1", [n.eventId]);
    await n.advanceTo("SQUAD_DRAW");
    // 21:10 is only 20 real seconds away when the lottery is drawn; BUILD (80 event minutes) is 8 real minutes.
    await atOnce(n, `
      update phases set starts_at = now() - interval '40 seconds', ends_at = now() + interval '20 seconds' where event_id = :event and code = 'SQUAD_DRAW';
      update phases set starts_at = now() + interval '20 seconds', ends_at = now() + interval '8 minutes 20 seconds' where event_id = :event and code = 'BUILD';
      update deadlines set at = now() + interval '20 seconds' where event_id = :event and code = 'PROBLEM_PICK';`);
    await n.org("run_lottery", n.eventId, SEED, "4");
    const left = (await minutesLeft(n, "PROBLEM_PICK")) * 60;
    expect(left).toBeGreaterThan(55);
    expect(left).toBeLessThanOrEqual(60);
    const build = await phaseRow(n, "BUILD");
    expect(build.starts_at).toEqual(await deadlineAt(n, "PROBLEM_PICK"));
    expect(mins(build.ends_at, build.starts_at)).toBeCloseTo(8, 3);
  });

  test("R1: an on-time draw moves nothing; an early SQUAD_DRAW → BUILD advance leaves the pick open until 21:10", async () => {
    const n = await fresh();
    await n.advanceTo("SQUAD_DRAW");
    const before = await schedule(n);
    await n.org("run_lottery", n.eventId, SEED, "4");
    expect(await schedule(n)).toEqual(before);

    await n.advanceTo("BUILD"); // the organiser moves on early; 21:10 is still ahead
    expect(await minutesLeft(n, "PROBLEM_PICK")).toBeGreaterThan(1);
    expect((await chosen(n)).filter((x) => x.chosen_card_id !== null)).toEqual([]); // no default card on entering BUILD
    const [s1, s2, s3] = await squadsOf(n);
    await n.ok(n.team(s2!.p_code), "pick_problem_card", s2!.dealt_card_ids[2]);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await chosen(n)).filter((x) => x.chosen_by_default)).toEqual([]);

    // At 21:10 the pick closes and the tick deals the defaults.
    await n.deadlinePassed("PROBLEM_PICK");
    expect(await n.call(n.team(s3!.p_code), "pick_problem_card", s3!.dealt_card_ids[1])).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    await n.ok(n.lead, "tick", n.eventId);
    const after = await chosen(n);
    expect(after[0]).toMatchObject({ chosen_card_id: s1!.dealt_card_ids[0], chosen_by_default: true });
    expect(after[1]).toMatchObject({ chosen_card_id: s2!.dealt_card_ids[2], chosen_by_default: false });
    expect(after[2]).toMatchObject({ chosen_card_id: s3!.dealt_card_ids[0], chosen_by_default: true });
  });
});

// ═════════════════════════════ R2 / SEC-4 ═════════════════════════════

describe("R2/SEC-4: an early advance closes the windows for the work it publishes", () => {
  test("R2: an early advance to READING closes the pitch window, though 22:30 is still ahead", async () => {
    const { n, s } = await drawn();
    const [s1, s2, s3] = s as [Squad, Squad, Squad];
    await n.advanceTo("BUILD");
    expect(await submit(n, s1, "PITCH", pitchOf(s1, "Secret sauce: water from air."))).toMatchObject({ ok: true });
    expect(await submit(n, s2, "PITCH", pitchOf(s2, "A weak first idea."))).toMatchObject({ ok: true });
    // Squad 3 has a draft with its ticker but has not submitted.
    await n.ok(n.team(s3.p_code), "save_draft", "PITCH", pitchOf(s3), await draftVersion(n, s3, "PITCH"));
    expect(await minutesLeft(n, "PITCH")).toBeGreaterThan(1);

    await n.advanceTo("READING");
    expect(await minutesLeft(n, "PITCH")).toBeLessThanOrEqual(0);
    // The pitch book is public: squad 2 reads squad 1's pitch …
    const seen = await rowsAs<{ body_text: string }>(db.pool, n.team(s2.p_code),
      "select body_text from submissions where squad_id = $1 and type = 'PITCH'", [s1.id]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body_text).toContain("Secret sauce");
    // … and can no longer copy it into its own.
    expect(await n.call(n.team(s2.p_code), "save_draft", "PITCH", pitchOf(s2, "Secret sauce: water from air."), await draftVersion(n, s2, "PITCH")))
      .toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.call(n.team(s2.p_code), "submit_submission", "PITCH")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    // Squad 3 got a default ticker on entering READING and cannot swap it for its own by submitting now.
    const ticker = (await n.one("select ticker from companies where id = $1", [s3.company_id])).ticker;
    expect(ticker).toMatch(/^Z[A-Z]{3}$/);
    expect(await n.call(n.team(s3.p_code), "submit_submission", "PITCH")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect((await n.one("select ticker from companies where id = $1", [s3.company_id])).ticker).toBe(ticker);

    // Judging can start at once.
    for (const x of [s1, s2]) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
    expect(await n.org("seal_missing_scores", n.eventId, "PITCH")).toMatchObject({ sealed_missing: 1 });

    // Second lock: READING keeps the pitch window shut even if the deadline were moved out again.
    await n.deadlinePassed("PITCH", false);
    expect(await n.call(n.team(s2.p_code), "submit_submission", "PITCH")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  });

  test("R2: an early advance to PLANS_PUBLISHED closes the plan and deal windows; a deal signed before it is on time", async () => {
    const { n, s } = await drawn();
    const [s1, s2] = s as [Squad, Squad, Squad];
    await pitchesReleased(n, s);
    await n.advanceTo("RESCUE_2");
    expect(await submit(n, s1, "PLAN", planOf("Secret plan: sell the sensors to farms."))).toMatchObject({ ok: true });
    await dealFor(n, s1);
    expect((await n.one("select executed_at from deals where squad_id = $1", [s1.id])).executed_at).not.toBeNull();
    // Squad 2: a draft plan, and a deal its Product team alone has signed.
    await n.ok(n.team(s2.p_code), "save_draft", "PLAN", planOf(), await draftVersion(n, s2, "PLAN"));
    const deal2 = await dealFor(n, s2, [s2.p_code]);
    expect(await minutesLeft(n, "PLAN")).toBeGreaterThan(1);
    expect(await minutesLeft(n, "DEAL")).toBeGreaterThan(1);

    await n.advanceTo("PLANS_PUBLISHED"); // before 03:00
    expect(await minutesLeft(n, "PLAN")).toBeLessThanOrEqual(0);
    expect(await minutesLeft(n, "DEAL")).toBeLessThanOrEqual(0);
    const seen = await rowsAs(db.pool, n.team(s2.p_code), "select 1 from submissions where squad_id = $1 and type = 'PLAN'", [s1.id]);
    expect(seen).toHaveLength(1);
    expect(await n.call(n.team(s2.p_code), "submit_submission", "PLAN")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.call(n.team(s2.c_code), "sign_deal", deal2.version)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.call(n.team(s2.f_code), "edit_deal", 5_000_000, null)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect((await n.one("select executed_at from deals where squad_id = $1", [s2.id])).executed_at).toBeNull();

    // Judging starts at once, and squad 1's deal (signed before the pulled-in 03:00) lifts the plan cap.
    expect(await n.judge(s1.company_id, "PLAN", [85, 85, 85])).toMatchObject({ ok: true, final: 85, capped: false });
    expect(await n.org("seal_missing_scores", n.eventId, "PLAN")).toMatchObject({ sealed_missing: 2 });

    // Second lock: the phase keeps the windows shut even if the deadlines were moved out again.
    await n.deadlinePassed("PLAN", false);
    await n.deadlinePassed("DEAL", false);
    expect(await n.call(n.team(s2.p_code), "submit_submission", "PLAN")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.call(n.team(s2.c_code), "sign_deal", deal2.version)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  });

  // One event played to the close. Consultant K covers companies x and y.
  describe("SEC-4: each consultant call closes before the price it is judged against is known", () => {
    let n: Night;
    let s: Squad[];
    let k: { code: string; x: string; y: string };

    beforeAll(async () => {
      ({ n, s } = await drawn());
      k = await coverage(n);
      await n.advanceTo("BUILD");
      for (const x of s) expect(await submit(n, x, "PITCH", pitchOf(x))).toMatchObject({ ok: true });
      await n.deadlinePassed("PITCH");
      await n.advanceTo("READING");
      for (const x of s) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
    });

    test("SEC-4: call 1 (judged from the IPO price) closes when the pitch scores are released, whatever the clock", async () => {
      await n.ok(n.team(k.code), "make_call", k.x, 1, "BUY"); // open in READING until 23:15
      await n.deadlinePassed("CALL_1");
      await n.org("release_scores", n.eventId, "PITCH");
      // The IPO prices are public now; even with 23:15 moved out again, call 1 stays closed.
      await n.deadlinePassed("CALL_1", false);
      expect(await n.call(n.team(k.code), "make_call", k.y, 1, "SELL")).toMatchObject({ ok: false, code: "CALL_CLOSED" });
      await n.deadlinePassed("CALL_1");
    });

    test("R3: flash scores are sealed only after 04:15, even when round 17 has cleared early", async () => {
      await n.advanceTo("RESCUE_2");
      await plansReleased(n, s);
      await n.ok(n.team(k.code), "make_call", k.x, 2, "BUY"); // call 2 opens with the plan verdicts
      await flashAnswered(n, s);
      expect(await minutesLeft(n, "FLASH")).toBeGreaterThan(1);
      for (const x of s) expect(await n.judge(x.company_id, "FLASH", [70, 70, 70])).toMatchObject({ ok: false, code: "NOT_READY" });
      expect(await n.call(n.lead, "seal_missing_scores", n.eventId, "FLASH")).toMatchObject({ ok: false, code: "NOT_READY" });
      expect(await n.call(n.lead, "release_scores", n.eventId, "FLASH")).toMatchObject({ ok: false, code: "NOT_READY" });
      await n.deadlinePassed("FLASH");
      for (const x of s) expect(await n.judge(x.company_id, "FLASH", [70, 70, 70])).toMatchObject({ ok: true });
    });

    test("SEC-4: call 2 (judged at the flash price) and the flash window close when the flash scores are released", async () => {
      expect(await minutesLeft(n, "CALL_2")).toBeGreaterThan(1); // 03:40 is still ahead: the release itself closes call 2
      await n.org("release_scores", n.eventId, "FLASH");
      expect(await n.call(n.team(k.code), "make_call", k.y, 2, "SELL")).toMatchObject({ ok: false, code: "CALL_CLOSED" });
      await n.deadlinePassed("FLASH", false);
      expect(await submit(n, s[0]!, "FLASH", { answer: "A better answer, now that the scores are out." }))
        .toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
      await n.deadlinePassed("FLASH");
    });

    test("SEC-4: call 3 (judged at the closing price) closes when the market closes", async () => {
      await n.ok(n.team(k.code), "make_call", k.x, 3, "BUY");
      await n.advanceTo("CLOSE");
      expect(await minutesLeft(n, "CALL_3")).toBeGreaterThan(1);
      expect(await n.call(n.team(k.code), "make_call", k.y, 3, "SELL")).toMatchObject({ ok: false, code: "CALL_CLOSED" });
    });
  });
});

// ═════════════════════════════ R3 / MONEY-2 ═════════════════════════════

describe("R3/MONEY-2: scores are sealed only once nothing can change what is judged", () => {
  test("R3: pitch scores cannot be sealed before 22:30; the sealed score is of the last on-time pitch", async () => {
    const { n, s } = await drawn();
    const [s1, s2, s3] = s as [Squad, Squad, Squad];
    await n.advanceTo("BUILD");
    expect(await submit(n, s1, "PITCH", pitchOf(s1, "Version one."))).toMatchObject({ ok: true });
    expect(await n.judge(s1.company_id, "PITCH", [90, 90, 90])).toMatchObject({ ok: false, code: "NOT_READY" });
    expect(await n.call(n.lead, "seal_missing_scores", n.eventId, "PITCH")).toMatchObject({ ok: false, code: "NOT_READY" });
    expect(await n.q("select 1 from scores where event_id = $1", [n.eventId])).toEqual([]);
    // Both refused seals would have pinned stale work: squad 1 now improves its pitch and squad 2 submits, on time.
    expect(await submit(n, s1, "PITCH", pitchOf(s1, "Version two."))).toMatchObject({ ok: true });
    expect(await submit(n, s2, "PITCH", pitchOf(s2))).toMatchObject({ ok: true });

    await n.deadlinePassed("PITCH");
    expect(await submit(n, s3, "PITCH", pitchOf(s3))).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.judge(s1.company_id, "PITCH", [90, 90, 90])).toMatchObject({ ok: true, final: 90 });
    expect(await n.judge(s2.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true, final: 60 });
    expect(await n.org("seal_missing_scores", n.eventId, "PITCH")).toMatchObject({ sealed_missing: 1 });
    const scores = await n.q(
      `select s.company_id, s.missing, x.body_text from scores s left join submissions x on x.id = s.submission_id
        where s.event_id = $1 and s.type = 'PITCH'`, [n.eventId]);
    const of = (sq: Squad) => scores.find((r) => r.company_id === sq.company_id)!;
    expect(of(s1)).toMatchObject({ missing: false });
    expect(of(s1).body_text).toContain("Version two");
    expect(of(s2)).toMatchObject({ missing: false });
    expect(of(s3)).toMatchObject({ missing: true });

    // Defence in depth: were the window ever reopened after sealing, the release refuses a score of replaced work.
    await n.deadlinePassed("PITCH", false);
    expect(await submit(n, s1, "PITCH", pitchOf(s1, "Version three."))).toMatchObject({ ok: true });
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    await n.deadlinePassed("CALL_1");
    expect(await n.call(n.lead, "release_scores", n.eventId, "PITCH")).toMatchObject({ ok: false, code: "NOT_READY" });
    expect(await n.judge(s1.company_id, "PITCH", [80, 80, 80])).toMatchObject({ ok: true, final: 80 });
    await n.org("release_scores", n.eventId, "PITCH");
    const released = await n.one(
      `select s.status, x.body_text, c.ipo_price from scores s join submissions x on x.id = s.submission_id
         join companies c on c.id = s.company_id where s.company_id = $1 and s.type = 'PITCH'`, [s1.company_id]);
    expect(released).toMatchObject({ status: "RELEASED", ipo_price: ipoPrice(80) });
    expect(released.body_text).toContain("Version three");
  });

  test("MONEY-2: a plan cannot be sealed before 03:00; sealed after the deal deadline it reflects the deal signed on time", async () => {
    const { n, s } = await drawn();
    const [s1, s2, s3] = s as [Squad, Squad, Squad];
    await pitchesReleased(n, s);
    await n.advanceTo("RESCUE_2");
    expect(await submit(n, s1, "PLAN", planOf("Version one."))).toMatchObject({ ok: true });
    // Before the fix this sealed {final: 50, capped: true} for good.
    expect(await n.judge(s1.company_id, "PLAN", [85, 85, 85])).toMatchObject({ ok: false, code: "NOT_READY" });
    expect(await n.call(n.lead, "seal_missing_scores", n.eventId, "PLAN")).toMatchObject({ ok: false, code: "NOT_READY" });

    // Squad 1 then signs its deal and improves its plan, both on time. Squad 2 submits a plan but no deal.
    await dealFor(n, s1);
    expect(await submit(n, s1, "PLAN", planOf("Version two."))).toMatchObject({ ok: true });
    expect(await submit(n, s2, "PLAN", planOf())).toMatchObject({ ok: true });

    // The plan deadline alone is not enough: the deal deadline decides the cap.
    await n.deadlinePassed("PLAN");
    expect(await n.judge(s1.company_id, "PLAN", [85, 85, 85])).toMatchObject({ ok: false, code: "NOT_READY" });
    expect(await n.call(n.lead, "seal_missing_scores", n.eventId, "PLAN")).toMatchObject({ ok: false, code: "NOT_READY" });

    await n.deadlinePassed("DEAL");
    expect((await n.one("select app.deal_signed_in_time($1) as v", [s1.company_id])).v).toBe(true);
    expect(await n.judge(s1.company_id, "PLAN", [85, 85, 85])).toMatchObject({ ok: true, final: 85, capped: false });
    expect(await n.judge(s2.company_id, "PLAN", [85, 85, 85])).toMatchObject({ ok: true, final: 50, capped: true });
    expect(await n.org("seal_missing_scores", n.eventId, "PLAN")).toMatchObject({ sealed_missing: 1 });
    const sealed = await n.one(
      "select x.body_text from scores s join submissions x on x.id = s.submission_id where s.company_id = $1 and s.type = 'PLAN'", [s1.company_id]);
    expect(sealed.body_text).toContain("Version two");

    await n.advanceTo("PLANS_PUBLISHED");
    await n.advanceTo("VERDICTS");
    const before = await n.prices();
    await n.org("release_scores", n.eventId, "PLAN");
    const after = await n.prices();
    expect(after[s1.company_id]).toBe(applyTier(before[s1.company_id]!, tierBp("PLAN", 85))); // +20%, not the capped 0%
    expect(after[s2.company_id]).toBe(applyTier(before[s2.company_id]!, tierBp("PLAN", 50)));
    expect(after[s3.company_id]).toBe(applyTier(before[s3.company_id]!, tierBp("PLAN", 0)));
  });

  test("MONEY-2: a late round opening never reopens 03:00 after it passed; the sealed cap stays right, and release refuses a cap that no longer matches the deal", async () => {
    const { n, s } = await drawn();
    const [, s2] = s as [Squad, Squad, Squad];
    await pitchesReleased(n, s);
    await n.advanceTo("RESCUE_2");
    for (const r of [9, 10, 11]) {
      await n.openRound(r);
      await n.clearRound(r);
    }
    for (const x of s) expect(await submit(n, x, "PLAN", planOf())).toMatchObject({ ok: true });
    // 03:05, not paused: 03:00 (plan and deal deadlines) passed 5 minutes ago, but round 12 (02:45–03:00) never
    // opened because the heartbeat was down for 20 minutes.
    await atOnce(n, `
      update rounds set opens_at = now() - interval '20 minutes', closes_at = now() - interval '5 minutes' where event_id = :event and number = 12;
      update phases set starts_at = now() - interval '65 minutes', ends_at = now() - interval '5 minutes' where event_id = :event and code = 'RESCUE_2';
      update phases set starts_at = now() - interval '5 minutes', ends_at = now() + interval '25 minutes' where event_id = :event and code = 'PLANS_PUBLISHED';
      update deadlines set at = now() - interval '20 minutes' where event_id = :event and code = 'DEAL_BONUS';
      update deadlines set at = now() - interval '5 minutes' where event_id = :event and code in ('PLAN', 'DEAL');`);
    // Scoring is closed, so the judge worker seals at once. Squad 2 has no deal: its plan is capped.
    for (const x of s) expect(await n.judge(x.company_id, "PLAN", [85, 85, 85])).toMatchObject({ ok: true });
    expect(await n.one("select capped, final_score from scores where company_id = $1 and type = 'PLAN'", [s2.company_id]))
      .toMatchObject({ capped: true, final_score: 50 });

    // The heartbeat is back: round 12 opens 20 minutes late and the schedule after it moves, but 03:00 had passed
    // while the plan and deal windows were open, so it stays: nothing reopens.
    await n.ok(n.lead, "tick", n.eventId);
    expect((await roundRow(n, 12)).status).toBe("OPEN");
    expect(await minutesLeft(n, "DEAL")).toBeLessThan(0);
    expect(await minutesLeft(n, "PLAN")).toBeLessThan(0);
    const d = await n.one("select version from deals where squad_id = $1", [s2.id]);
    expect(await n.call(n.team(s2.c_code), "edit_deal", null, 700)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.call(n.team(s2.f_code), "sign_deal", d.version)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await submit(n, s2, "PLAN", planOf())).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    await n.clearRound(12);
    expect((await n.one("select app.deal_signed_in_time($1) as v", [s2.company_id])).v).toBe(false);

    await n.advanceTo("PLANS_PUBLISHED");
    await n.advanceTo("VERDICTS");
    // Defence in depth: if a deal ever counted as signed in time after its plan was sealed capped (simulated by a
    // test-only edit), release refuses the stale cap.
    await n.q("update deals set executed_at = (select at from deadlines where event_id = $1 and code = 'DEAL') - interval '1 minute' where squad_id = $2", [n.eventId, s2.id]);
    expect(await n.call(n.lead, "release_scores", n.eventId, "PLAN")).toMatchObject({ ok: false, code: "NOT_READY" });
    await n.q("update deals set executed_at = null where squad_id = $1", [s2.id]);
    await n.org("release_scores", n.eventId, "PLAN");
    expect(await n.one("select capped, final_score from scores where company_id = $1 and type = 'PLAN'", [s2.company_id]))
      .toMatchObject({ capped: true, final_score: 50 });
  });
});

// ═════════════════════════════ R6 ═════════════════════════════

describe("R6: a pause during a gate wait is counted once", () => {
  /** READING with every pitch sealed but not released. */
  async function readingSealed() {
    const { n, s } = await drawn();
    await n.advanceTo("BUILD");
    for (const x of s) expect(await submit(n, x, "PITCH", pitchOf(x))).toMatchObject({ ok: true });
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const x of s) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
    return { n, s };
  }

  test("R6: the IPO, held at the READING gate, keeps its 15 minutes after a pause during the wait", async () => {
    const { n } = await readingSealed();
    // 23:15 was 8 minutes ago: call 1 closed and the IPO (15 minutes) was due, but the gate waits for the release.
    await atOnce(n, `
      update deadlines set at = now() - interval '53 minutes' where event_id = :event and code = 'PITCH';
      update deadlines set at = now() - interval '8 minutes' where event_id = :event and code = 'CALL_1';
      update phases set starts_at = now() - interval '53 minutes', ends_at = now() - interval '8 minutes' where event_id = :event and code = 'READING';
      update phases set starts_at = now() - interval '8 minutes', ends_at = now() + interval '7 minutes' where event_id = :event and code = 'IPO';
      update phases set starts_at = now() + interval '7 minutes', ends_at = now() + interval '67 minutes' where event_id = :event and code = 'ROUNDS_1_4';
      update deadlines set at = now() + interval '7 minutes' where event_id = :event and code = 'IPO_BIDS';
      update rounds set opens_at = now() + interval '7 minutes', closes_at = now() + interval '22 minutes' where event_id = :event and number = 1;`);
    // Paused 5 minutes into the wait, for 3 minutes.
    await pausedSince(n, 3);
    await n.org("resume_event", n.eventId);
    await n.org("release_scores", n.eventId, "PITCH");
    await n.org("advance_phase", n.eventId, "READING");

    const ipo = await phaseRow(n, "IPO");
    expect(mins(ipo.ends_at, ipo.started_at!)).toBeCloseTo(15, 1); // 18 before the fix
    expect(mins(await deadlineAt(n, "IPO_BIDS"), ipo.started_at!)).toBeCloseTo(15, 1);
    const r1 = await roundRow(n, 1);
    expect(mins(r1.opens_at, ipo.started_at!)).toBeCloseTo(15, 1);
    expect(mins(r1.closes_at, r1.opens_at)).toBeCloseTo(15, 3);
  });

  test("R6: round 18, held for the flash scores, keeps its 10 minutes after a pause during the wait", async () => {
    const { n, s } = await drawn();
    await pitchesReleased(n, s);
    await n.advanceTo("RESCUE_2");
    await plansReleased(n, s);
    await flashAnswered(n, s);
    await n.deadlinePassed("FLASH");
    for (const x of s) expect(await n.judge(x.company_id, "FLASH", [70, 70, 70])).toMatchObject({ ok: true });
    // Round 18 (10 minutes, 04:20) was due 8 minutes ago; the tick holds it for the flash release. 04:15 passed before.
    await atOnce(n, `
      update deadlines set at = now() - interval '13 minutes' where event_id = :event and code = 'FLASH';
      update rounds set opens_at = now() - interval '8 minutes', closes_at = now() + interval '2 minutes' where event_id = :event and number = 18;
      update rounds set opens_at = now() + interval '2 minutes', closes_at = now() + interval '12 minutes' where event_id = :event and number = 19;`);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await roundRow(n, 18)).status).toBe("SCHEDULED");
    // Paused 5 minutes into the wait, for 3 minutes.
    await pausedSince(n, 3);
    await n.org("resume_event", n.eventId);
    await n.org("release_scores", n.eventId, "FLASH");
    await n.ok(n.lead, "tick", n.eventId);

    const r18 = await roundRow(n, 18);
    expect(r18.status).toBe("OPEN");
    expect(mins(r18.closes_at, r18.opened_at)).toBeCloseTo(10, 1); // 13 before the fix
    const r19 = await roundRow(n, 19);
    expect(r19.opens_at).toEqual(r18.closes_at);
    expect(mins(r19.closes_at, r19.opens_at)).toBeCloseTo(10, 3);
  });

  test("R6: a zero-length phase (VERDICTS) that fell due before the pause moves whole, and the resume succeeds", async () => {
    const { n, s } = await drawn();
    await pitchesReleased(n, s);
    await n.advanceTo("RESCUE_2");
    for (const x of s) expect(await submit(n, x, "PLAN", planOf())).toMatchObject({ ok: true });
    await n.deadlinePassed("PLAN");
    await n.deadlinePassed("DEAL");
    await n.advanceTo("PLANS_PUBLISHED");
    for (const x of s) expect(await n.judge(x.company_id, "PLAN", [70, 70, 70])).toMatchObject({ ok: true });
    // 03:30 (VERDICTS, zero length, then ROUNDS_13_21) was 8 minutes ago; auto-advance is off and the organiser is late.
    await atOnce(n, `
      update deadlines set at = now() - interval '38 minutes' where event_id = :event and code in ('PLAN', 'DEAL');
      update phases set starts_at = now() - interval '38 minutes', ends_at = now() - interval '8 minutes' where event_id = :event and code = 'PLANS_PUBLISHED';
      update phases set starts_at = now() - interval '8 minutes', ends_at = now() - interval '8 minutes' where event_id = :event and code = 'VERDICTS';
      update phases set starts_at = now() - interval '8 minutes', ends_at = now() + interval '82 minutes' where event_id = :event and code = 'ROUNDS_13_21';
      update rounds set opens_at = now() - interval '8 minutes', closes_at = now() + interval '2 minutes' where event_id = :event and number = 13;`);
    await pausedSince(n, 3);
    await n.org("resume_event", n.eventId);
    const verdicts = await phaseRow(n, "VERDICTS");
    expect(verdicts.ends_at).toEqual(verdicts.starts_at);

    await n.org("advance_phase", n.eventId, "PLANS_PUBLISHED");
    await n.org("release_scores", n.eventId, "PLAN");
    await n.org("advance_phase", n.eventId, "VERDICTS");
    const rounds = await phaseRow(n, "ROUNDS_13_21");
    expect(mins(rounds.ends_at, rounds.started_at!)).toBeCloseTo(90, 1); // 93 before the fix
    const r13 = await roundRow(n, 13);
    expect(mins(r13.opens_at, rounds.started_at!)).toBeCloseTo(0, 1);
    expect(mins(r13.closes_at, r13.opens_at)).toBeCloseTo(10, 3);
  });

  test("R6: a pause that begins after 23:30 fell due (a READING gate wait of over 15 minutes) keeps the IPO bid window whole", async () => {
    const { n, s } = await readingSealed();
    // The IPO (15 minutes) was due 40 minutes ago, and 23:30 (IPO bids close, round 1 opens) 25 minutes ago; the gate
    // still waits for the pitch release. The organiser paused 20 minutes into the wait, for 20 minutes.
    await atOnce(n, `
      update deadlines set at = now() - interval '85 minutes' where event_id = :event and code = 'PITCH';
      update deadlines set at = now() - interval '40 minutes' where event_id = :event and code = 'CALL_1';
      update phases set starts_at = now() - interval '85 minutes', ends_at = now() - interval '40 minutes' where event_id = :event and code = 'READING';
      update phases set starts_at = now() - interval '40 minutes', ends_at = now() - interval '25 minutes' where event_id = :event and code = 'IPO';
      update phases set starts_at = now() - interval '25 minutes', ends_at = now() + interval '35 minutes' where event_id = :event and code = 'ROUNDS_1_4';
      update deadlines set at = now() - interval '25 minutes' where event_id = :event and code = 'IPO_BIDS';
      update rounds set opens_at = now() - interval '25 minutes', closes_at = now() - interval '10 minutes' where event_id = :event and number = 1;`);
    await pausedSince(n, 20);
    await n.org("resume_event", n.eventId);
    await n.org("release_scores", n.eventId, "PITCH");
    await n.org("advance_phase", n.eventId, "READING");

    // The IPO itself and round 1 are right: 15 minutes each, back to back …
    const ipo = await phaseRow(n, "IPO");
    expect(mins(ipo.ends_at, ipo.started_at!)).toBeCloseTo(15, 1);
    const r1 = await roundRow(n, 1);
    expect(mins(r1.opens_at, ipo.started_at!)).toBeCloseTo(15, 1);
    expect(mins(r1.closes_at, r1.opens_at)).toBeCloseTo(15, 1);
    // … but 23:30 was left behind: it should close the bids with the IPO, 15 minutes after it starts (with a 5-minute
    // pause it closes them after 10; with this 20-minute pause it is already past, and no fund can bid at all).
    expect(await n.call(n.team(s[1]!.f_code), "place_ipo_bid", s[0]!.company_id, 100)).toMatchObject({ ok: true });
    expect(mins(await deadlineAt(n, "IPO_BIDS"), ipo.started_at!)).toBeCloseTo(15, 1);
  });

  test("R6: a pause while a late lottery is awaited (the SQUAD_DRAW gate) does not lengthen BUILD", async () => {
    const n = await fresh();
    await n.advanceTo("SQUAD_DRAW");
    // 21:10 (pick deadline, end of the draw, start of BUILD) was 8 minutes ago; the lottery has not been drawn.
    await atOnce(n, `
      update phases set starts_at = now() - interval '18 minutes', ends_at = now() - interval '8 minutes' where event_id = :event and code = 'SQUAD_DRAW';
      update phases set starts_at = now() - interval '8 minutes', ends_at = now() + interval '72 minutes' where event_id = :event and code = 'BUILD';
      update deadlines set at = now() - interval '8 minutes' where event_id = :event and code = 'PROBLEM_PICK';`);
    // Paused 5 minutes into the wait, for 3 minutes; drawn right after the resume.
    await pausedSince(n, 3);
    await n.org("resume_event", n.eventId);
    await n.org("run_lottery", n.eventId, SEED, "4");
    expect(await minutesLeft(n, "PROBLEM_PICK")).toBeGreaterThan(9.9);

    // Ten minutes later the pick closes and the tick (auto-advance on) starts BUILD.
    await n.org("set_auto_advance", n.eventId, true);
    await elapse(n, 10);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.phase()).toBe("BUILD");
    const build = await phaseRow(n, "BUILD");
    expect(mins(build.ends_at, build.started_at!)).toBeCloseTo(80, 1); // 83: the pause counted again
  });

  test("R6: a resume leaves the planned times of SETUP, a phase that ran before the night began, alone", async () => {
    const n = await fresh(); // SETUP was planned for the hour before 20:00, two hours ago
    await n.advanceTo("BRIEFING");
    const before = await phaseRow(n, "SETUP");
    await pausedSince(n, 3);
    await n.org("resume_event", n.eventId);
    const after = await phaseRow(n, "SETUP");
    expect({ starts_at: after.starts_at, ends_at: after.ends_at }).toEqual({ starts_at: before.starts_at, ends_at: before.ends_at });
  });
});

// ═════════════════════════════ R7 ═════════════════════════════

describe("R7: extending during a pause extends what was running when the pause began", () => {
  test("R7: BUILD and the 22:30 pitch deadline get the extra minutes; a deadline that passed before the pause stays put", async () => {
    const { n } = await drawn();
    await n.advanceTo("BUILD");
    // Paused 10 minutes ago with 5 minutes of BUILD left; the pick closed 30 minutes ago.
    await pausedSince(n, 10);
    await atOnce(n, `
      update phases set starts_at = now() - interval '75 minutes', ends_at = now() - interval '5 minutes' where event_id = :event and code = 'BUILD';
      update phases set starts_at = now() - interval '5 minutes', ends_at = now() + interval '40 minutes' where event_id = :event and code = 'READING';
      update deadlines set at = now() - interval '5 minutes' where event_id = :event and code = 'PITCH';
      update deadlines set at = now() - interval '30 minutes' where event_id = :event and code = 'PROBLEM_PICK';`);
    const pick = await deadlineAt(n, "PROBLEM_PICK");
    await n.org("extend_event", n.eventId, 5);
    await n.org("resume_event", n.eventId);

    const build = await phaseRow(n, "BUILD");
    expect(Number((await n.one("select extract(epoch from $1::timestamptz - clock_timestamp()) / 60 as m", [build.ends_at])).m)).toBeCloseTo(10, 1); // 5 before the fix
    expect(await minutesLeft(n, "PITCH")).toBeCloseTo(10, 1);
    const reading = await phaseRow(n, "READING");
    expect(reading.starts_at).toEqual(build.ends_at);
    expect(mins(reading.ends_at, reading.starts_at)).toBeCloseTo(45, 3);
    expect(await deadlineAt(n, "PROBLEM_PICK")).toEqual(pick);

    // Not paused, an extension still starts from now.
    await n.org("extend_event", n.eventId, 5);
    expect(await minutesLeft(n, "PITCH")).toBeCloseTo(15, 1);
  });

  test("R7: the IPO with its bid deadline, and an open round, get the extra minutes; the next round keeps its 15", async () => {
    const { n, s } = await drawn();
    await pitchesReleased(n, s);
    await n.advanceTo("IPO");
    // Paused 10 minutes ago with 5 minutes of the IPO left.
    await pausedSince(n, 10);
    await atOnce(n, `
      update phases set starts_at = now() - interval '20 minutes', ends_at = now() - interval '5 minutes' where event_id = :event and code = 'IPO';
      update phases set starts_at = now() - interval '5 minutes', ends_at = now() + interval '55 minutes' where event_id = :event and code = 'ROUNDS_1_4';
      update deadlines set at = now() - interval '5 minutes' where event_id = :event and code = 'IPO_BIDS';
      update rounds set opens_at = now() - interval '5 minutes', closes_at = now() + interval '10 minutes' where event_id = :event and number = 1;`);
    await n.org("extend_event", n.eventId, 5);
    await n.org("resume_event", n.eventId);
    expect(await minutesLeft(n, "IPO_BIDS")).toBeCloseTo(10, 1); // 5 before the fix
    const ipo = await phaseRow(n, "IPO");
    expect(ipo.ends_at).toEqual(await deadlineAt(n, "IPO_BIDS"));
    let r1 = await roundRow(n, 1);
    expect(r1.opens_at).toEqual(ipo.ends_at);
    expect(mins(r1.closes_at, r1.opens_at)).toBeCloseTo(15, 3); // 20 before the fix

    // Round 1 open, paused 10 minutes ago with 5 minutes of it left.
    await n.advanceTo("ROUNDS_1_4");
    await n.openRound(1);
    await pausedSince(n, 10);
    await atOnce(n, `
      update rounds set opens_at = now() - interval '20 minutes', closes_at = now() - interval '5 minutes' where event_id = :event and number = 1;
      update rounds set opens_at = now() - interval '5 minutes', closes_at = now() + interval '10 minutes' where event_id = :event and number = 2;`);
    await n.org("extend_event", n.eventId, 5);
    await n.org("resume_event", n.eventId);
    r1 = await roundRow(n, 1);
    expect(r1.status).toBe("OPEN");
    expect(Number((await n.one("select extract(epoch from $1::timestamptz - clock_timestamp()) / 60 as m", [r1.closes_at])).m)).toBeCloseTo(10, 1);
    const r2 = await roundRow(n, 2);
    expect(r2.opens_at).toEqual(r1.closes_at);
    expect(mins(r2.closes_at, r2.opens_at)).toBeCloseTo(15, 3);
  });
});

// ═════════════════════════════ R8 ═════════════════════════════

describe("R8: pitch scores wait for consultant call 1", () => {
  test("R8: pitch scores and IPO prices are not released while call 1 is open, nor while a pause holds 23:15", async () => {
    const { n, s } = await drawn();
    const k = await coverage(n);
    await n.advanceTo("BUILD");
    for (const x of s) expect(await submit(n, x, "PITCH", pitchOf(x))).toMatchObject({ ok: true });
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const x of s) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
    expect(await minutesLeft(n, "CALL_1")).toBeGreaterThan(1);

    expect(await n.call(n.lead, "release_scores", n.eventId, "PITCH")).toMatchObject({ ok: false, code: "CALL_1_OPEN" });
    // Nothing was released: no IPO price for the consultant to see, and READING cannot end yet.
    const seen = await rowsAs(db.pool, n.team(k.code), "select ipo_price from companies where id = $1", [k.x]);
    expect(seen).toEqual([{ ipo_price: null }]);
    expect(await n.call(n.lead, "advance_phase", n.eventId, "READING")).toMatchObject({ ok: false, code: "GATE" });
    await n.ok(n.team(k.code), "make_call", k.x, 1, "BUY"); // call 1 is still open

    // A pause holds 23:15: by the wall clock it has passed, but the release still waits; after the resume 23:15 is
    // later by the pause.
    await n.q("update deadlines set at = now() - interval '30 minutes' where event_id = $1 and code = 'PITCH'", [n.eventId]);
    await pausedSince(n, 2);
    await n.q("update deadlines set at = now() - interval '1 minute' where event_id = $1 and code = 'CALL_1'", [n.eventId]);
    expect(await n.call(n.lead, "release_scores", n.eventId, "PITCH")).toMatchObject({ ok: false, code: "CALL_1_OPEN" });
    await n.org("resume_event", n.eventId);
    expect(await n.call(n.lead, "release_scores", n.eventId, "PITCH")).toMatchObject({ ok: false, code: "CALL_1_OPEN" });

    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    expect(await rowsAs(db.pool, n.team(k.code), "select ipo_price from companies where id = $1", [k.x])).toEqual([{ ipo_price: ipoPrice(60) }]);
    expect(await n.call(n.team(k.code), "make_call", k.y, 1, "SELL")).toMatchObject({ ok: false, code: "CALL_CLOSED" });
  });
});
