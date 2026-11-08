import { describe, expect, test } from "vitest";
import { mmwAlpha, mmwAssign, mmwCentre, mmwCurl, mmwEase, mmwRandom } from "./murmuration-wordmark";

describe("murmuration flock helpers", () => {
  test("the PRNG is seeded and stays in [0, 1)", () => {
    const a = mmwRandom(7), b = mmwRandom(7);
    const xs = Array.from({ length: 500 }, () => a());
    expect(xs).toEqual(Array.from({ length: 500 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  test("the current is divergence-free (it folds the flock, never piles it up)", () => {
    const e = 1e-4;
    for (const [x, y, t] of [[0.1, 0.2, 0], [-0.7, 0.4, 3.1], [1.3, -0.9, 10]]) {
      const div = (mmwCurl(x + e, y, t)[0] - mmwCurl(x - e, y, t)[0]) / (2 * e) + (mmwCurl(x, y + e, t)[1] - mmwCurl(x, y - e, t)[1]) / (2 * e);
      expect(Math.abs(div)).toBeLessThan(1e-5);
    }
  });

  test("every bird gets a point of the word, all points are used, and nothing when there is no word", () => {
    const t = mmwAssign(10, 4, 23);
    expect(new Set(t)).toEqual(new Set([0, 1, 2, 3]));
    expect(Array.from(mmwAssign(3, 0, 1))).toEqual([-1, -1, -1]);
  });

  test("ease, centre and colours", () => {
    expect([mmwEase(-1), mmwEase(0.5), mmwEase(2)]).toEqual([0, 0.5, 1]);
    expect(Math.abs(mmwCentre(5)[0])).toBeLessThanOrEqual(0.54);
    expect(mmwAlpha("#4ade80", 0.5)).toBe("rgba(74,222,128,0.5)");
    expect(mmwAlpha("#fff", 1)).toBe("rgba(255,255,255,1)");
    expect(mmwAlpha("green", 0.2)).toBe("green");
  });
});
