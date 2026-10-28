import { describe, expect, test } from "vitest";
import { axisMoney, chartGeometry, chartSummary, niceStep, sparkPath, type ChartBox } from "./chart";

const box: ChartBox = { width: 400, height: 200, padLeft: 50, padRight: 10, padTop: 10, padBottom: 30 };

describe("niceStep", () => {
  test("1, 2 or 5 × 10^k for about four ticks", () => {
    expect(niceStep(400)).toBe(100);
    expect(niceStep(700)).toBe(200);
    expect(niceStep(1600)).toBe(500);
    expect(niceStep(3)).toBe(1);
    expect(niceStep(0)).toBe(1);
  });
});

describe("chartGeometry", () => {
  test("no points: empty paths", () => {
    expect(chartGeometry([], box)).toMatchObject({ path: "", area: "", points: [] });
  });

  test("the first point sits on the left edge, the last on the right; higher values are higher up", () => {
    const g = chartGeometry(
      [
        { label: "IPO", value: 1050, marker: "IPO" },
        { label: "Round 1", value: 1100 },
        { label: "Round 2", value: 1000 },
      ],
      box,
    );
    expect(g.points.map((p) => p.x)).toEqual([50, 220, 390]);
    expect(g.points[1]!.y).toBeLessThan(g.points[0]!.y);
    expect(g.points[2]!.y).toBeGreaterThan(g.points[0]!.y);
    expect(g.path.startsWith("M50 ")).toBe(true);
    expect(g.area.endsWith("Z")).toBe(true);
    // Ticks span the data on round values.
    expect(g.min).toBeLessThanOrEqual(1000);
    expect(g.max).toBeGreaterThanOrEqual(1100);
    const step = g.yTicks[1]!.value - g.yTicks[0]!.value;
    expect(String(step)).toMatch(/^[125]0*$/);
    expect(g.yTicks.every((t) => t.value % step === 0)).toBe(true);
  });

  test("a flat series still gets a range; prices never tick below zero", () => {
    const g = chartGeometry([{ label: "IPO", value: 1000 }, { label: "Round 1", value: 1000 }], box);
    expect(g.max).toBeGreaterThan(g.min);
    expect(g.points[0]!.y).toBe(g.points[1]!.y);
    expect(chartGeometry([{ label: "a", value: 5 }], box).min).toBeGreaterThanOrEqual(0);
  });

  test("the second series breaks where it has no value", () => {
    const g = chartGeometry(
      [
        { label: "a", value: 1000, second: 1000 },
        { label: "b", value: 1100, second: null },
        { label: "c", value: 1200, second: 900 },
        { label: "d", value: 1300, second: 950 },
      ],
      box,
    );
    expect(g.path2.match(/M/g)).toHaveLength(2);
    expect(g.path2.match(/L/g)).toHaveLength(1);
    expect(g.points[1]!.y2).toBeNull();
  });
});

describe("sparkPath and summary", () => {
  test("a sparkline fills its box", () => {
    expect(sparkPath([1000, 1100, 1050], 60, 20)).toBe("M0 20 L30 0 L60 10");
    expect(sparkPath([], 60, 20)).toBe("");
    expect(sparkPath([5, 5], 60, 20)).toBe("M0 10 L60 10");
  });

  test("the summary names the first and last steps and the range", () => {
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(chartSummary([{ label: "IPO price", value: 1050 }, { label: "Round 1", value: 900 }, { label: "Round 2", value: 1263 }], fmt)).toBe(
      "IPO price $10.50, Round 2 $12.63; lowest $9.00, highest $12.63, 3 steps.",
    );
  });
});

describe("axisMoney", () => {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  test("prices stay exact; fund values read in thousands", () => {
    expect(axisMoney(1050, 50, 1200, fmt)).toBe("$10.50");
    expect(axisMoney(54_000_000, 2_000_000, 56_000_000, fmt)).toBe("$540k");
    expect(axisMoney(51_750_000, 50_000, 52_000_000, fmt)).toBe("$517.5k");
  });
});
