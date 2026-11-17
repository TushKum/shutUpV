import { describe, expect, it } from "vitest";
import { candlesFromTicks, candleTicks, detectPatterns, patternAt, practiceCandles, practiceEdge, PRACTICE } from "../src/candles";

const c = (open: number, close: number, high = Math.max(open, close), low = Math.min(open, close)) => ({ open, close, high, low });

describe("pattern detection", () => {
  const down = [c(1100, 1080), c(1080, 1060), c(1060, 1040)];
  const up = [c(1000, 1020), c(1020, 1040), c(1040, 1060)];
  it("finds a hammer after a fall and a shooting star after a rise", () => {
    expect(patternAt([...down, c(1040, 1042, 1043, 1000)], 3)).toBe("Hammer");
    expect(patternAt([...up, c(1060, 1058, 1100, 1057)], 3)).toBe("Shooting star");
  });
  it("finds engulfing candles", () => {
    expect(patternAt([...down, c(1040, 1030), c(1029, 1046)], 4)).toBe("Bullish engulfing");
    expect(patternAt([...up, c(1060, 1070), c(1071, 1055)], 4)).toBe("Bearish engulfing");
  });
  it("finds a doji, three soldiers and three crows", () => {
    expect(patternAt([c(1000, 1000, 1010, 990)], 0)).toBe("Doji");
    expect(patternAt([c(1000, 1010, 1011, 999), c(1010, 1020, 1021, 1009), c(1020, 1030, 1031, 1019)], 2)).toBe("Three white soldiers");
    expect(patternAt([c(1030, 1020, 1031, 1019), c(1020, 1010, 1021, 1009), c(1010, 1000, 1011, 999)], 2)).toBe("Three black crows");
  });
  it("finds a breakout from a range", () => {
    const box = Array.from({ length: 8 }, (_, i) => c(1000 + (i % 2) * 2, 1002 - (i % 2) * 2, 1004, 998));
    expect(patternAt([...box, c(1002, 1020, 1021, 1001)], 8)).toBe("Breakout up");
    expect(patternAt([...box, c(1000, 980, 1001, 979)], 8)).toBe("Breakdown");
  });
  it("finds nothing in an ordinary candle", () => {
    expect(patternAt([c(1000, 1010, 1012, 998)], 0)).toBeNull();
  });
});

describe("the practice market", () => {
  const seeds = Array.from({ length: 50 }, (_, i) => `event-x:P${String(i + 1).padStart(2, "0")}`);
  it("is the same every time for a ticker, and different between tickers", () => {
    expect(practiceCandles(seeds[0]!)).toEqual(practiceCandles(seeds[0]!));
    expect(practiceCandles(seeds[0]!)[10]).not.toEqual(practiceCandles(seeds[1]!)[10]);
  });
  it("has 180 well-formed candles with positive prices", () => {
    for (const s of seeds) {
      const cs = practiceCandles(s);
      expect(cs).toHaveLength(PRACTICE.candles);
      for (const k of cs) {
        expect(k.low).toBeGreaterThan(0);
        expect(k.high).toBeGreaterThanOrEqual(Math.max(k.open, k.close));
        expect(k.low).toBeLessThanOrEqual(Math.min(k.open, k.close));
      }
    }
  });
  it("plants patterns a trader can see: most planted signals are detected where they were planted", () => {
    let planted = 0;
    let found = 0;
    for (const s of seeds) {
      const cs = practiceCandles(s);
      cs.forEach((k, i) => {
        if (!k.planted) return;
        planted++;
        if (patternAt(cs, i) === k.planted) found++;
      });
    }
    expect(planted).toBeGreaterThan(50 * 12);
    expect(found / planted).toBeGreaterThan(0.75);
  });
  it("rewards reading them: most bullish signals are followed by a rise, most bearish by a fall", () => {
    let right = 0;
    let total = 0;
    for (const s of seeds) {
      const cs = practiceCandles(s);
      for (const p of detectPatterns(cs)) {
        if (p.bias === "neutral" || p.index + 5 >= cs.length) continue;
        const later = cs[p.index + 5]!.close - cs[p.index]!.close;
        total++;
        if ((p.bias === "bullish") === later > 0) right++;
      }
    }
    expect(right / total).toBeGreaterThan(0.58);
    expect(right / total).toBeLessThan(0.9);
  });
  it("turns candles into ticks and back", () => {
    const cs = practiceCandles(seeds[3]!).slice(0, 20);
    const ticks = cs.flatMap((k) => candleTicks(k));
    expect(ticks).toHaveLength(20 * PRACTICE.candleTicks);
    expect(candlesFromTicks(ticks).map(({ open, high, low, close }) => ({ open, high, low, close }))).toEqual(
      cs.map(({ open, high, low, close }) => ({ open, high, low, close })),
    );
  });
  it("turns practice profit into an edge: profit only, capped", () => {
    expect(practiceEdge(PRACTICE.startCents - 500_000)).toBe(0);
    expect(practiceEdge(PRACTICE.startCents + 1_234_500)).toBe(1_234_500);
    expect(practiceEdge(PRACTICE.startCents * 3)).toBe(PRACTICE.edgeCapCents);
  });
});
