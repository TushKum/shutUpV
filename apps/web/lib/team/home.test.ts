import { describe, expect, test } from "vitest";
import { phaseReached, type DeadlineCode, type PhaseCode, type Track } from "@msim/engine";
import { deadlinePassed, holdingsView, homePlan, windowOpen, type HomeFacts, type HomeProgress } from "./home";

// The default night, real time on 8 Oct (IST = UTC+5:30): 20:00 IST is 14:30Z.
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const day = h < 12 ? 9 : 8;
  return new Date(Date.UTC(2026, 9, day, h, m) - 330 * 60_000).toISOString();
};
const DEADLINES: Record<DeadlineCode, string> = {
  PROBLEM_PICK: "21:10",
  PITCH: "22:30",
  CALL_1: "23:15",
  IPO_BIDS: "23:30",
  FEE: "01:05",
  DEAL_BONUS: "02:45",
  DEAL: "03:00",
  PLAN: "03:00",
  CALL_2: "03:40",
  FLASH_BULLETIN: "04:00",
  FLASH: "04:15",
  FLASH_TIER: "04:20",
  CALL_3: "04:30",
};

const progress = (p: Partial<HomeProgress> = {}): HomeProgress => ({
  problemPicked: false,
  submitted: { PITCH: false, PLAN: false, FLASH: false },
  fee: null,
  deal: null,
  calls: { 1: { made: 0, total: 2 }, 2: { made: 0, total: 2 }, 3: { made: 0, total: 2 } },
  ipoBids: 0,
  unanswered: 0,
  ...p,
});

function facts(track: Track, phase: PhaseCode, now: string, extra: Partial<HomeFacts> = {}): HomeFacts {
  return {
    track,
    phase,
    paused: false,
    pausedAt: null,
    nowMs: new Date(at(now)).getTime(),
    drawn: phaseReached(phase, "SQUAD_DRAW"),
    crisisApplied: phaseReached(phase, "CRISIS"),
    ipoAllocated: false,
    marketClosed: false,
    flashBulletinPublished: false,
    released: { PITCH: false, PLAN: false, FLASH: false },
    deadlines: Object.entries(DEADLINES).map(([code, t]) => ({ code: code as DeadlineCode, at: at(t) })),
    phaseStarts: { SQUAD_DRAW: at("21:00"), READING: at("22:30"), CLOSE: at("05:00"), AWARDS: at("05:40") },
    openRound: null,
    nextRound: null,
    progress: progress(),
    ...extra,
  };
}

const keys = (f: HomeFacts) => homePlan(f).now.map((t) => t.key);

describe("deadlines by the server clock", () => {
  test("a deadline passes after its time; while paused, one after the pause began has not passed", () => {
    const f = facts("PRODUCT", "BUILD", "22:31");
    expect(deadlinePassed(f, "PITCH")).toBe(true);
    expect(deadlinePassed({ ...f, paused: true, pausedAt: at("22:20") }, "PITCH")).toBe(false);
    expect(deadlinePassed({ ...f, paused: true, pausedAt: at("22:40") }, "PITCH")).toBe(true);
    expect(deadlinePassed({ ...f, deadlines: [] }, "PITCH")).toBe(false);
  });
});

describe("what to do now, per track and phase", () => {
  test("before the draw: nothing to do yet, the draw is coming up", () => {
    const plan = homePlan(facts("PRODUCT", "CHECKIN", "20:10"));
    expect(plan.now).toEqual([]);
    expect(plan.idle).toMatch(/squad draw is at 21:00/);
    expect(plan.next[0]).toMatchObject({ key: "SQUAD_DRAW", at: at("21:00") });
    expect(plan.next.map((n) => n.key)).toContain("PROBLEM_PICK");
  });

  test("Product after the draw: pick the problem card (Squad), then write the pitch", () => {
    const f = facts("PRODUCT", "SQUAD_DRAW", "21:02");
    const plan = homePlan(f);
    expect(plan.now.map((t) => t.key)).toEqual(["PROBLEM_PICK", "PITCH"]);
    expect(plan.now[0]).toMatchObject({ title: "Pick your problem card", href: "/team/squad", state: "todo", due: at("21:10") });
    expect(plan.now[0]!.detail).toContain("21:10");
    const picked = homePlan({ ...f, progress: progress({ problemPicked: true }) });
    expect(picked.now[0]).toMatchObject({ state: "done" });
    // Past the pick deadline only the pitch is left; it is due 22:30.
    const later = homePlan(facts("PRODUCT", "BUILD", "21:30"));
    expect(later.now.map((t) => t.key)).toEqual(["PITCH"]);
    expect(later.now[0]).toMatchObject({ title: "Write and submit your pitch card", due: at("22:30"), state: "todo" });
  });

  test("Consulting sees the pitch as its partner's, and call 1 is open from the draw until 23:15 or the pitch release", () => {
    const f = facts("CONSULTING", "BUILD", "21:30");
    const plan = homePlan(f);
    expect(plan.now.map((t) => t.key)).toEqual(["PITCH", "CALL_1"]);
    expect(plan.now[0]).toMatchObject({ title: "Help with the pitch card", state: "info" });
    expect(plan.now[1]).toMatchObject({ href: "/team/calls", state: "todo" });
    expect(keys(facts("CONSULTING", "READING", "23:00", { progress: progress({ calls: { 1: { made: 2, total: 2 }, 2: { made: 0, total: 2 }, 3: { made: 0, total: 2 } } }) }))).toEqual(["CALL_1"]);
    expect(homePlan(facts("CONSULTING", "READING", "23:00", { progress: progress({ calls: { 1: { made: 2, total: 2 }, 2: { made: 0, total: 2 }, 3: { made: 0, total: 2 } } }) })).now[0]!.state).toBe("done");
    expect(keys(facts("CONSULTING", "READING", "23:10", { released: { PITCH: true, PLAN: false, FLASH: false } }))).toEqual([]);
  });

  test("Finance during the IPO: place IPO bids (Trade) until 23:30; not while paused or once allocated", () => {
    const f = facts("FINANCE", "IPO", "23:20");
    const plan = homePlan(f);
    expect(plan.now[0]).toMatchObject({ key: "IPO_BIDS", title: "Place IPO bids", href: "/team/trade", due: at("23:30"), state: "todo" });
    expect(plan.now.map((t) => t.key)).toEqual(["IPO_BIDS", "QA"]);
    expect(homePlan({ ...f, progress: progress({ ipoBids: 3 }) }).now[0]).toMatchObject({ state: "done", detail: expect.stringContaining("3 bids placed") });
    expect(windowOpen({ ...f, paused: true, pausedAt: at("23:19") }, "IPO_BIDS")).toBe(false);
    expect(windowOpen({ ...f, ipoAllocated: true }, "IPO_BIDS")).toBe(false);
  });

  test("Finance during Reading: read the pitch book and ask questions; the IPO bids are coming up", () => {
    const plan = homePlan(facts("FINANCE", "READING", "22:40"));
    expect(plan.now.map((t) => t.key)).toEqual(["READ", "QA"]);
    expect(plan.now[0]).toMatchObject({ href: "/team/market/book" });
    expect(plan.next.map((n) => n.key)).toEqual(["IPO_BIDS", "DEAL", "FLASH_BULLETIN"]);
  });

  test("Finance in a round: trade until the round closes; between rounds the next one is coming up", () => {
    const open = homePlan(facts("FINANCE", "ROUNDS_1_4", "23:35", { openRound: { number: 1, closes_at: at("23:45") } }));
    expect(open.now[0]).toMatchObject({ key: "ROUND", title: "Trade: round 1 is open", due: at("23:45"), dueLabel: "Round 1 closes" });
    const between = homePlan(facts("FINANCE", "ROUNDS_1_4", "23:46", { nextRound: { number: 2, opens_at: at("23:47") } }));
    expect(between.next[0]).toMatchObject({ key: "NEXT_ROUND", title: "Round 2 opens", href: "/team/trade" });
  });

  test("after the crisis: fee (Product and Consulting) and deal (all three), each with its own status", () => {
    const f = facts("PRODUCT", "RESCUE_1", "00:50");
    expect(keys(f)).toEqual(["FEE", "DEAL", "PLAN", "QA"]); // the deal and the plan are both due at 03:00
    const fee = (p: Partial<NonNullable<HomeProgress["fee"]>>) =>
      homePlan({ ...f, progress: progress({ fee: { proposed: true, productConfirmed: false, consultingConfirmed: false, executed: false, isDefault: false, ...p } }) }).now[0]!;
    expect(fee({})).toMatchObject({ key: "FEE", state: "todo", href: "/team/rescue" });
    expect(fee({ productConfirmed: true })).toMatchObject({ state: "waiting", detail: expect.stringContaining("Consulting partner") });
    expect(fee({ executed: true })).toMatchObject({ state: "done" });
    // Finance has no fee; its deal task asks for the amount.
    const fund = homePlan(facts("FINANCE", "RESCUE_1", "00:50", { progress: progress({ deal: { amountSet: false, priceSet: true, signed: { PRODUCT: false, CONSULTING: false, FINANCE: false }, executed: false } }) }));
    expect(fund.now.map((t) => t.key)).toEqual(["DEAL", "QA"]);
    expect(fund.now[0]).toMatchObject({ title: "Set the deal amount and sign", detail: expect.stringContaining("Set the amount") });
    // Consulting's deal task counts down to the bonus cut-off first, then to the deadline.
    const c = homePlan(facts("CONSULTING", "RESCUE_2", "02:30"));
    expect(c.now.find((t) => t.key === "DEAL")).toMatchObject({ due: at("02:45"), dueLabel: "Deal bonus cut-off" });
    const c2 = homePlan(facts("CONSULTING", "RESCUE_2", "02:50"));
    expect(c2.now.find((t) => t.key === "DEAL")).toMatchObject({ due: at("03:00"), dueLabel: "Rescue deal" });
    expect(c2.next.map((n) => n.key)).not.toContain("DEAL_BONUS");
  });

  test("a signed deal waits for the other teams, by name", () => {
    const f = facts("FINANCE", "RESCUE_2", "02:10", {
      progress: progress({ deal: { amountSet: true, priceSet: true, signed: { PRODUCT: true, CONSULTING: false, FINANCE: true }, executed: false } }),
    });
    expect(homePlan(f).now[0]).toMatchObject({ state: "waiting", detail: expect.stringContaining("waiting for Consulting by 03:00") });
  });

  test("the flash answer opens with the bulletin and closes at 04:15 or the flash release", () => {
    const f = facts("CONSULTING", "ROUNDS_13_21", "04:05", { released: { PITCH: true, PLAN: true, FLASH: false }, flashBulletinPublished: true });
    expect(keys(f)).toEqual(["FLASH"]); // call 2 closed at 03:40
    expect(keys({ ...f, nowMs: new Date(at("03:35")).getTime() })).toEqual(["CALL_2", "FLASH"]);
    expect(keys({ ...f, released: { PITCH: true, PLAN: true, FLASH: true } })).toEqual(["CALL_3"]);
  });

  test("Product answers questions from Reading until the close, with the number waiting", () => {
    const plan = homePlan(facts("PRODUCT", "READING", "22:40", { progress: progress({ unanswered: 2 }) }));
    expect(plan.now).toEqual([expect.objectContaining({ key: "QA", state: "todo", href: "/team/qa", detail: expect.stringContaining("2 questions") })]);
    expect(keys(facts("PRODUCT", "CLOSE", "05:01"))).toEqual([]);
    expect(homePlan(facts("PRODUCT", "SETTLEMENT", "05:10")).idle).toMatch(/rankings are revealed at the awards at 05:40/);
  });

  test("upcoming: only this track's deadlines, not passed, not open now, not closed early; soonest first", () => {
    const plan = homePlan(facts("CONSULTING", "READING", "22:40", { released: { PITCH: false, PLAN: false, FLASH: false } }));
    expect(plan.now.map((t) => t.key)).toEqual(["CALL_1"]);
    expect(plan.next.map((n) => n.key)).toEqual(["FEE", "DEAL_BONUS", "DEAL", "PLAN", "CALL_2"]);
    expect(plan.next[0]).toMatchObject({ href: "/team/rescue", at: at("01:05") });
    const product = homePlan(facts("PRODUCT", "BUILD", "21:30"));
    expect(product.next.map((n) => n.key)).toEqual(["FEE", "DEAL", "PLAN", "FLASH_BULLETIN", "FLASH"]);
  });
});

describe("holdings", () => {
  const companies = [
    { id: "a", ticker: "AQS", name: "AquaSense", market_price: 1125, closing_price: null },
    { id: "b", ticker: "BRK", name: "Brook", market_price: 1030, closing_price: null },
    { id: "c", ticker: null, name: null, market_price: null, closing_price: null },
  ];
  test("one line per company and lot, valued at the market price; a short is negative; zero lots are left out", () => {
    const v = holdingsView(
      [
        { company_id: "b", lot: "SHORT", qty: 2000 },
        { company_id: "a", lot: "EXCHANGE", qty: 4000 },
        { company_id: "a", lot: "SQUAD", qty: 5000 },
        { company_id: "b", lot: "EXCHANGE", qty: 0 },
      ],
      companies,
    );
    expect(v.lines.map((l) => [l.ticker, l.lotLabel, l.qty, l.price, l.value])).toEqual([
      ["AQS", "Squad lot", 5000, 1125, 5_625_000],
      ["AQS", "Exchange", 4000, 1125, 4_500_000],
      ["BRK", "Short", 2000, 1030, -2_060_000],
    ]);
    expect(v.total).toBe(5_625_000 + 4_500_000 - 2_060_000);
    expect(v.unpriced).toBe(0);
    expect(v.closing).toBe(false);
  });
  test("before the IPO the retained shares have no price; after the close the closing price is used", () => {
    const before = holdingsView([{ company_id: "c", lot: "RETAINED", qty: 60000 }], companies);
    expect(before.lines[0]).toMatchObject({ ticker: null, name: "Your squad's company", lotLabel: "Retained (locked)", value: null });
    expect(before).toMatchObject({ total: null, unpriced: 1 });
    expect(holdingsView([], companies)).toMatchObject({ lines: [], total: null, unpriced: 0 });
    const closed = holdingsView([{ company_id: "a", lot: "RETAINED", qty: 51000 }], [{ ...companies[0]!, closing_price: 1263 }]);
    expect(closed).toMatchObject({ total: 51000 * 1263, closing: true });
  });
});
