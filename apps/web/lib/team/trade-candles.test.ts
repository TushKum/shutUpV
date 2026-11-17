import { describe, expect, it } from "vitest";
import { liveCandle, tradeCandles, type StepRow } from "./trade-candles";

const step = (kind: string, before: number | null, after: number, round: string | null = null, qty = 0): StepRow => ({
  company_id: "c",
  kind,
  round_id: round,
  market_before: before,
  market_after: after,
  buy_qty: qty,
  sell_qty: 0,
  short_qty: 0,
  cover_qty: 0,
});

describe("the order screen's candles", () => {
  it("makes one candle per step, with a round's real high and low and its volume", () => {
    const rows = [step("IPO", null, 1050), step("CLEARING", 1050, 1071, "r1", 2000), step("CRISIS", 1071, 1017)];
    const ranges = [{ round_id: "r1", company_id: "c", open_cents: 1050, high_cents: 1090, low_cents: 1040, last_cents: 1071 }];
    const cs = tradeCandles(rows, ranges, () => 1);
    expect(cs.map((c) => c.label)).toEqual(["IPO", "Round 1", "Crisis"]);
    expect(cs[1]).toMatchObject({ open: 1050, close: 1071, high: 1090, low: 1040, volume: 2000 });
    expect(cs[2]).toMatchObject({ open: 1071, close: 1017, high: 1071, low: 1017 });
  });
  it("draws the open round's live candle from its range, or flat before any order", () => {
    expect(liveCandle(3, 1200, null)).toMatchObject({ open: 1200, close: 1200, high: 1200, low: 1200 });
    expect(liveCandle(3, 1200, { round_id: "r", company_id: "c", open_cents: 1200, high_cents: 1224, low_cents: 1190, last_cents: 1212 })).toMatchObject({
      open: 1200,
      close: 1212,
      high: 1224,
      low: 1190,
    });
  });
});
