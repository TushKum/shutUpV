import { describe, expect, test } from "vitest";
import { marketPulse } from "./pulse";

const row = (ticker: string | null, before: number | null, after: number, volume = 0) => ({ ticker, name: ticker ? `${ticker} Ltd` : null, before, after, volume });

describe("market pulse", () => {
  test("the biggest riser, the biggest faller, the busiest company and the mood", () => {
    const p = marketPulse(3, [row("AAA", 1000, 1042, 4200), row("BBB", 1100, 1080, 9000), row("CCC", 1050, 1050, 0), row("DDD", 900, 909, 1000)]);
    expect(p).toMatchObject({ round: 3, up: 2, down: 1, flat: 1, totalVolume: 14_200, mood: "BULL" });
    expect(p.riser).toMatchObject({ ticker: "AAA", changeBp: 420, price: 1042 });
    expect(p.faller).toMatchObject({ ticker: "BBB", changeBp: -182 });
    expect(p.busiest).toMatchObject({ ticker: "BBB", volume: 9000 });
    expect(p.moves.map((m) => [m.ticker, m.changeBp])).toEqual([["AAA", 420], ["BBB", -182], ["CCC", 0], ["DDD", 100]]);
  });

  test("a quiet round has no headline; ties go to the first ticker; unnamed or unpriced rows are skipped", () => {
    expect(marketPulse(1, [row("AAA", 1000, 1000), row("BBB", 1000, 1000)])).toMatchObject({ riser: null, faller: null, busiest: null, mood: "CALM", flat: 2 });
    const tie = marketPulse(2, [row("ZZZ", 1000, 1010, 500), row("MMM", 1000, 1010, 500), row(null, 1000, 2000, 99_999), row("NEW", null, 1100, 7)]);
    expect(tie.riser!.ticker).toBe("MMM");
    expect(tie.busiest!.ticker).toBe("MMM");
    expect(tie).toMatchObject({ up: 2, down: 0, totalVolume: 1000 });
    expect(marketPulse(5, [row("AAA", 1000, 990, 10)])).toMatchObject({ mood: "BEAR", riser: null });
  });
});
