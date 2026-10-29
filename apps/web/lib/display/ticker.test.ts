import { describe, expect, test } from "vitest";
import { tickerItems, type TickerInput } from "./ticker";

const base: TickerInput = {
  phase: "ROUNDS_1_4",
  nowMs: Date.parse("2026-11-14T18:30:00Z"),
  lastRound: null,
  bulletins: [],
  dealsSigned: 0,
  squads: 50,
  deadlines: [],
  clock: (iso) => iso.slice(11, 16),
};

describe("tickerItems", () => {
  test("the last round's three biggest rises and falls, by percentage, ties by ticker; unchanged prices left out", () => {
    const items = tickerItems({
      ...base,
      lastRound: {
        number: 3,
        moves: [
          { ticker: "AQS", before: 1050, after: 1082 },
          { ticker: "BBB", before: 1000, after: 1100 },
          { ticker: "CCC", before: 1000, after: 1010 },
          { ticker: "DDD", before: 1000, after: 1020 },
          { ticker: "EEE", before: 1000, after: 950 },
          { ticker: "FFF", before: 1000, after: 1000 },
        ],
      },
    });
    expect(items.map((i) => [i.tag, i.text])).toEqual([
      ["Round 3 ▲", "BBB +10%  ·  AQS +3.05%  ·  DDD +2%"],
      ["Round 3 ▼", "EEE −5%"],
    ]);
  });

  test("a round where nothing moved says so", () => {
    expect(tickerItems({ ...base, lastRound: { number: 1, moves: [{ ticker: "AQS", before: 1050, after: 1050 }] } }).map((i) => i.text)).toEqual(["No price moved this round."]);
  });

  test("bulletins, the deals count during the rescue, and the next deadline (never the internal flash tier)", () => {
    const items = tickerItems({
      ...base,
      phase: "RESCUE_2",
      bulletins: [{ kind: "CRISIS", title: "Every company is hit" }],
      dealsSigned: 12,
      deadlines: [
        { code: "FEE", at: "2026-11-14T18:00:00Z" },
        { code: "FLASH_TIER", at: "2026-11-14T18:40:00Z" },
        { code: "DEAL_BONUS", at: "2026-11-14T21:15:00Z" },
        { code: "DEAL", at: "2026-11-14T21:30:00Z" },
      ],
    });
    expect(items.map((i) => [i.tag, i.text])).toEqual([
      ["CRISIS", "Every company is hit"],
      ["Rescue", "12 of 50 rescue deals signed"],
      ["Next", "Deal bonus cut-off at 21:15"],
    ]);
  });

  test("no deals count before the crisis or after the close", () => {
    expect(tickerItems({ ...base, phase: "IPO", dealsSigned: 0 }).some((i) => i.key === "deals")).toBe(false);
    expect(tickerItems({ ...base, phase: "SETTLEMENT", dealsSigned: 50 }).some((i) => i.key === "deals")).toBe(false);
  });
});
