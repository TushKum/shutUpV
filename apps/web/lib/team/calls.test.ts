import { describe, expect, test } from "vitest";
import { CALL_WINDOWS, callCell, callSentText, callsSummary, coveredLabels, findCall, windowStage, type CallRow, type CallsInput } from "./calls";

const T = (iso: string) => Date.parse(iso);
// 23:15 IST = 17:45Z; 03:40 IST = 22:10Z; 04:30 IST = 23:00Z.
const deadlines = { CALL_1: "2026-10-10T17:45:00.000Z", CALL_2: "2026-10-10T22:10:00.000Z", CALL_3: "2026-10-10T23:00:00.000Z" };
const none = { PITCH: false, PLAN: false, FLASH: false };
const input = (o: Partial<CallsInput> = {}): CallsInput => ({
  paused: false,
  pausedAt: null,
  nowMs: T("2026-10-10T17:00:00.000Z"),
  drawn: true,
  released: none,
  marketClosed: false,
  deadlines,
  ...o,
});

describe("call windows (make_call)", () => {
  test("the brief's table: due 23:15, 03:40, 04:30; baselines and judged prices", () => {
    expect(CALL_WINDOWS.map((w) => [w.no, w.deadline, w.baseline, w.judgedAt])).toEqual([
      [1, "CALL_1", "IPO price", "round 4 clearing price"],
      [2, "CALL_2", "price after the plan tier", "price after the flash tier"],
      [3, "CALL_3", "price after the flash tier", "closing price"],
    ]);
  });

  test("call 1: from the draw until 23:15, and never after the IPO prices are released", () => {
    expect(windowStage(1, input({ drawn: false }))).toBe("NOT_OPEN");
    expect(windowStage(1, input())).toBe("OPEN");
    expect(windowStage(1, input({ nowMs: T(deadlines.CALL_1) + 1 }))).toBe("CLOSED");
    expect(windowStage(1, input({ released: { ...none, PITCH: true } }))).toBe("CLOSED");
    // A pause that began before 23:15 freezes the deadline.
    expect(windowStage(1, input({ nowMs: T(deadlines.CALL_1) + 60_000, paused: true, pausedAt: "2026-10-10T17:40:00.000Z" }))).toBe("OPEN");
  });

  test("call 2: from the plan release until 03:40, closed by the flash release", () => {
    const at = T("2026-10-10T22:05:00.000Z");
    expect(windowStage(2, input({ nowMs: at }))).toBe("NOT_OPEN");
    expect(windowStage(2, input({ nowMs: at, released: { PITCH: true, PLAN: true, FLASH: false } }))).toBe("OPEN");
    expect(windowStage(2, input({ nowMs: T(deadlines.CALL_2) + 1, released: { PITCH: true, PLAN: true, FLASH: false } }))).toBe("CLOSED");
    expect(windowStage(2, input({ nowMs: at, released: { PITCH: true, PLAN: true, FLASH: true } }))).toBe("CLOSED");
  });

  test("call 3: from the flash release until 04:30, closed by the close", () => {
    const at = T("2026-10-10T22:55:00.000Z");
    expect(windowStage(3, input({ nowMs: at, released: { PITCH: true, PLAN: true, FLASH: false } }))).toBe("NOT_OPEN");
    expect(windowStage(3, input({ nowMs: at, released: { PITCH: true, PLAN: true, FLASH: true } }))).toBe("OPEN");
    expect(windowStage(3, input({ nowMs: T(deadlines.CALL_3) + 1, released: { PITCH: true, PLAN: true, FLASH: true } }))).toBe("CLOSED");
    expect(windowStage(3, input({ nowMs: at, released: { PITCH: true, PLAN: true, FLASH: true }, marketClosed: true }))).toBe("CLOSED");
  });
});

const row = (o: Partial<CallRow> = {}): CallRow => ({
  id: "k1",
  company_id: "a",
  call_no: 1,
  direction: null,
  made_at: null,
  baseline_price: null,
  judged_price: null,
  correct: null,
  earnings_cents: "0",
  ...o,
});

describe("each call", () => {
  test("editable while its window is open; read-only otherwise", () => {
    expect(callCell(row({ direction: "BUY", made_at: "2026-10-10T17:10:00.000Z" }), "OPEN")).toEqual({
      stage: "OPEN",
      direction: "BUY",
      madeAt: "2026-10-10T17:10:00.000Z",
      editable: true,
      result: null,
    });
    expect(callCell(row({ direction: "BUY" }), "CLOSED")).toMatchObject({ stage: "CLOSED", editable: false });
    expect(callCell(row(), "NOT_OPEN")).toMatchObject({ stage: "NOT_OPEN", editable: false });
    expect(callCell(null, "OPEN")).toMatchObject({ editable: false });
  });

  test("judged as the database stored it: baseline, judged price, correct, $2,500", () => {
    // Northline's call 1 on AQS: BUY, $10.50 → $11.25.
    const right = callCell(row({ direction: "BUY", baseline_price: 1050, judged_price: "1125", correct: true, earnings_cents: "250000" }), "CLOSED");
    expect(right).toMatchObject({ stage: "JUDGED", editable: false, result: { baseline: 1050, judged: 1125, correct: true, earnings: 250_000 } });
    const wrong = callCell(row({ direction: "SELL", baseline_price: 1050, judged_price: 1125, correct: false, earnings_cents: 0 }), "OPEN");
    expect(wrong).toMatchObject({ stage: "JUDGED", editable: false, result: { correct: false, earnings: 0 } });
    // A missing call or an equal price is wrong.
    expect(callCell(row({ baseline_price: 1050, judged_price: 1125, correct: false }), "CLOSED").result).toMatchObject({ correct: false, earnings: 0 });
    // A row without the stored verdict falls back to the engine's rule.
    expect(callCell(row({ direction: "SELL", baseline_price: 1104, judged_price: 1050 }), "CLOSED").result).toMatchObject({ correct: true, earnings: 250_000 });
    expect(callCell(row({ direction: "BUY", baseline_price: 1104, judged_price: 1104 }), "CLOSED").result).toMatchObject({ correct: false, earnings: 0 });
  });

  test("the summary counts judged and correct calls and adds their earnings", () => {
    const cells = [
      callCell(row({ direction: "BUY", baseline_price: 1050, judged_price: 1125, correct: true, earnings_cents: "250000" }), "CLOSED"),
      callCell(row({ direction: "BUY", baseline_price: 1050, judged_price: 1000, correct: false }), "CLOSED"),
      callCell(row({ direction: "BUY" }), "OPEN"),
      callCell(row(), "NOT_OPEN"),
    ];
    expect(callsSummary(cells)).toEqual({ judged: 2, correct: 1, earnings: 250_000, pending: 2 });
  });
});

describe("covered companies", () => {
  test("in ticker order; before Reading a covered company has no public name, so it is numbered", () => {
    const coverage = [{ company_id: "z" }, { company_id: "b" }];
    expect(coveredLabels(coverage, []).map((c) => c.label)).toEqual(["Covered company 1", "Covered company 2"]);
    expect(coveredLabels(coverage, []).map((c) => c.id)).toEqual(["b", "z"]);
    const named = coveredLabels(coverage, [
      { id: "z", ticker: "AQS", name: "AquaSense" },
      { id: "b", ticker: "SNAP", name: "SnapStudy" },
    ]);
    expect(named.map((c) => [c.id, c.label])).toEqual([
      ["z", "AQS"],
      ["b", "SNAP"],
    ]);
  });

  test("a call is found by company and window; the sent message names it", () => {
    const calls = [row({ id: "1", company_id: "a", call_no: 1 }), row({ id: "2", company_id: "a", call_no: 2 })];
    expect(findCall(calls, "a", 2)?.id).toBe("2");
    expect(findCall(calls, "b", 1)).toBeNull();
    expect(callSentText("SELL", "AQS", 2, "03:40")).toBe("Call 2 on AQS: SELL. You can change it until it closes at 03:40.");
  });
});
