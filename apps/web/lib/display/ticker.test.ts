import { describe, expect, test } from "vitest";
import { tickerItems, type TickerInput } from "./ticker";

const base: TickerInput = {
  nowMs: Date.parse("2026-11-20T21:30:00Z"),
  lastRound: null,
  bulletins: [],
  deadlines: [],
  clock: (iso) => iso.slice(11, 16),
};

describe("tickerItems", () => {
  test("the last round's three biggest rises and falls, by percentage (half-up), ties by ticker; unchanged prices left out", () => {
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
    expect(items).toEqual([
      { key: "up", tag: "Round 3 ▲", text: "BBB +10%  ·  AQS +3.05%  ·  DDD +2%", tone: "up" },
      { key: "down", tag: "Round 3 ▼", text: "EEE −5%", tone: "down" },
    ]);
  });

  test("nobody moved", () => {
    expect(tickerItems({ ...base, lastRound: { number: 1, moves: [{ ticker: "A", before: 1000, after: 1000 }] } })).toEqual([
      { key: "flat", tag: "Round 1", text: "No price moved this round.", tone: "info" },
    ]);
  });

  test("rumours say they are unconfirmed; the next deadline still ahead", () => {
    const items = tickerItems({
      ...base,
      bulletins: [
        { kind: "RUMOUR", title: "A buyer is circling CMP" },
        { kind: "GENERAL", title: "Coffee in the foyer" },
      ],
      deadlines: [
        { code: "SOLUTION_LOCK", at: "2026-11-20T20:15:00Z" },
        { code: "LEADERBOARD_FREEZE", at: "2026-11-20T22:00:00Z" },
        { code: "MARKET_CLOSE", at: "2026-11-20T23:00:00Z" },
      ],
    });
    expect(items).toEqual([
      { key: "b0", tag: "Rumour", text: "A buyer is circling CMP (unconfirmed)", tone: "news" },
      { key: "b1", tag: "General", text: "Coffee in the foyer", tone: "news" },
      { key: "next", tag: "Next", text: "Leaderboard freezes at 22:00", tone: "info" },
    ]);
  });
});
