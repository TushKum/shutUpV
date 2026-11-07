import { describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import {
  AWARD_STEP_SECONDS,
  ceremony,
  changeBp,
  circleLines,
  closingMovers,
  competitionRanks,
  evenPages,
  hexGroups,
  lotteryRecordUrl,
  nextAwardAt,
  awardsRevealed,
  pageAt,
  prdSummary,
  rescueCircles,
  revealMovers,
  type ClosingRow,
  type PrdRow,
  type RevealRow,
} from "./takeovers";


describe("hexGroups", () => {
  test("a SHA-256 commitment is 4 groups of 16, lower case", () => {
    const c = sha256Hex("seed");
    const g = hexGroups(c.toUpperCase());
    expect(g).toHaveLength(4);
    expect(g.every((x) => x.length === 16)).toBe(true);
    expect(g.join("")).toBe(c);
  });

  test("nothing, or an odd length", () => {
    expect(hexGroups(null)).toEqual([]);
    expect(hexGroups(" abc ", 2)).toEqual(["ab", "c"]);
  });
});

describe("lotteryRecordUrl", () => {
  test("an absolute address from the request host", () => {
    expect(lotteryRecordUrl("night-2026", "market.example.org", "https")).toBe("https://market.example.org/api/lottery-record?event=night-2026");
    expect(lotteryRecordUrl("e2e", "127.0.0.1:3100", null)).toBe("http://127.0.0.1:3100/api/lottery-record?event=e2e");
    expect(lotteryRecordUrl("e2e", "market.example.org", null)).toBe("https://market.example.org/api/lottery-record?event=e2e");
    expect(lotteryRecordUrl("e2e", "a.example.org, b.example.org", "https,http")).toBe("https://a.example.org/api/lottery-record?event=e2e");
  });

  test("no host, or a strange one: the path", () => {
    expect(lotteryRecordUrl("e2e", null, "https")).toBe("/api/lottery-record?event=e2e");
    expect(lotteryRecordUrl("e2e", "evil.example.org/<script>", "https")).toBe("/api/lottery-record?event=e2e");
  });
});

describe("changeBp", () => {
  test("half-up basis points", () => {
    expect(changeBp(1050, 893)).toBe(-1495); // −14.95%
    expect(changeBp(1000, 1263)).toBe(2630);
    expect(changeBp(3, 4)).toBe(3333); // 3333.33…
    expect(changeBp(3, 2)).toBe(-3333);
    expect(changeBp(8, 9)).toBe(1250);
    expect(changeBp(16, 17)).toBe(625);
    expect(changeBp(1000, 1000)).toBe(0);
  });

  test("a tie rounds away from zero (half-up on the size of the change)", () => {
    expect(changeBp(20_000, 20_001)).toBe(1); // 0.5 → 1
    expect(changeBp(20_000, 19_999)).toBe(-1);
    expect(changeBp(2_000, 2_009)).toBe(45);
  });

  test("missing prices", () => {
    expect(changeBp(null, 1000)).toBeNull();
    expect(changeBp(1000, undefined)).toBeNull();
    expect(changeBp(0, 1000)).toBeNull();
  });
});

describe("prdSummary", () => {
  const row = (ticker: string, score: number | null, startPrice: number | null): PrdRow => ({ ticker, name: null, score, startPrice });
  test("the top PRDs, highest score first, then ticker; the count and the range of starting prices", () => {
    const s = prdSummary([row("BBB", 80, 1300), row("AAA", 80, 1300), row("CCC", 95, 1450), row("DDD", 0, 500), row("EEE", 60, 1100), row("FFF", 60, 1100), row("GGG", 60, 1100)]);
    expect(s.top.map((r) => r.ticker)).toEqual(["CCC", "AAA", "BBB", "EEE", "FFF"]);
    expect(s).toMatchObject({ listed: 7, low: 500, high: 1450, moreTied: 1 });
    expect(competitionRanks(s.top.map((r) => r.score))).toEqual([1, 2, 2, 4, 4]);
  });
  test("nothing listed yet", () => {
    expect(prdSummary([row("AAA", null, null)])).toEqual({ listed: 0, low: null, high: null, top: [], moreTied: 0 });
  });
});

describe("rescueCircles", () => {
  // Teams t1..t5 built A..E. t1 rescues C, t3 rescues B, t2 rescues A: one circle A → C → B → A. t4 and t5 swap.
  const c = (id: string, ticker: string, founder: string, rescuer: string | null) => ({ id, ticker, founder_team_id: founder, rescuer_team_id: rescuer });
  const companies = [c("a", "AAA", "t1", "t2"), c("b", "BBB", "t2", "t3"), c("c", "CCC", "t3", "t1"), c("d", "DDD", "t4", "t5"), c("e", "EEE", "t5", "t4")];
  test("every circle, starting at its first ticker and closing on it", () => {
    expect(rescueCircles(companies)).toEqual([
      ["AAA", "CCC", "BBB", "AAA"],
      ["DDD", "EEE", "DDD"],
    ]);
  });
  test("before the lottery: nothing", () => {
    expect(rescueCircles(companies.map((x) => ({ ...x, rescuer_team_id: null })))).toEqual([]);
  });
  test("long circles wrap into lines", () => {
    const big = Array.from({ length: 23 }, (_, i) => c(`x${i}`, `T${String(i).padStart(2, "0")}`, `t${i}`, `t${(i + 22) % 23}`));
    const circles = rescueCircles(big);
    expect(circles).toHaveLength(1);
    expect(circles[0]).toHaveLength(24);
    expect(circleLines(circles, 10).map((l) => l.length)).toEqual([10, 10, 4]);
  });
});

describe("revealMovers", () => {
  const row = (ticker: string, score: number, before = 850): RevealRow => {
    const factorBp = 10_000 + 50 * (score - 50);
    return { ticker, name: null, score, factorBp, before, after: before };
  };
  test("risers by highest factor, fallers by lowest; a 50 is neither; ties by ticker; at most 5", () => {
    const m = revealMovers([row("A", 90), row("B", 90), row("C", 50), row("D", 10), row("E", 70), row("F", 60), row("G", 55), row("H", 51), row("I", 52)]);
    expect(m.risers.map((r) => r.ticker)).toEqual(["A", "B", "E", "F", "G"]);
    expect(m.fallers.map((r) => r.ticker)).toEqual(["D"]);
    expect(m).toMatchObject({ up: 7, down: 1, unchanged: 1 });
  });
});

describe("closingMovers", () => {
  const row = (ticker: string, startPrice: number | null, closingPrice: number | null): ClosingRow => ({ ticker, name: null, startPrice, closingPrice });
  test("gainers and losers from the starting price to the closing price", () => {
    const m = closingMovers([row("A", 1000, 1250), row("B", 1000, 900), row("C", 1000, 1000), row("D", null, 900), row("E", 800, 1200)]);
    expect(m.gainers.map((r) => [r.ticker, r.changeBp])).toEqual([
      ["E", 5000],
      ["A", 2500],
    ]);
    expect(m.losers.map((r) => [r.ticker, r.changeBp])).toEqual([["B", -1000]]);
    expect(m.flat).toBe(1);
  });
});

describe("the awards, one by one", () => {
  const at = "2026-11-20T23:45:00.000Z"; // 05:15 IST
  const t = (s: number) => Date.parse(at) + s * 1000;
  test("the first at once, then one more every step, until all are up", () => {
    expect(awardsRevealed(at, t(-1), 7)).toBe(0);
    expect(awardsRevealed(at, t(0), 7)).toBe(1);
    expect(awardsRevealed(at, t(AWARD_STEP_SECONDS - 1), 7)).toBe(1);
    expect(awardsRevealed(at, t(AWARD_STEP_SECONDS), 7)).toBe(2);
    expect(awardsRevealed(at, t(3600), 7)).toBe(7);
    expect(awardsRevealed(at, t(0), 0)).toBe(0);
  });
  test("when the next one comes; faster in a rehearsal, never below 5 s", () => {
    expect(nextAwardAt(at, t(10), 7)).toBe(new Date(t(AWARD_STEP_SECONDS)).toISOString());
    expect(nextAwardAt(at, t(3600), 7)).toBeNull();
    expect(awardsRevealed(at, t(10), 7, 60)).toBe(3); // 5 s steps
  });
  test("ceremony order: special awards first, the winner last", () => {
    const lines = [{ code: "WINNER" as const }, { code: "BEST_PRD" as const }, { code: "THIRD" as const }, { code: "BEST_COMPANY" as const }];
    expect(ceremony(lines).map((l) => l.code)).toEqual(["BEST_PRD", "BEST_COMPANY", "THIRD", "WINNER"]);
  });
});

describe("paging", () => {
  test("pages as even as possible", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => i);
    expect(evenPages(fifty, 20).map((x) => x.length)).toEqual([17, 17, 16]);
    expect(evenPages(fifty, 25).map((x) => x.length)).toEqual([25, 25]);
    expect(evenPages(fifty.slice(0, 21), 20).map((x) => x.length)).toEqual([11, 10]);
    expect(evenPages(fifty.slice(0, 3), 20)).toEqual([[0, 1, 2]]);
    expect(evenPages([], 20)).toEqual([[]]);
    expect(evenPages(fifty, 20).flat()).toEqual(fifty);
  });

  test("each page in turn every 20 s by the server clock", () => {
    const t = 1_800_000_000_000; // a multiple of 20 s
    expect(pageAt(t, 3)).toBe(t / 20_000 % 3);
    expect(pageAt(t + 19_999, 3)).toBe(pageAt(t, 3));
    expect(pageAt(t + 20_000, 3)).toBe((pageAt(t, 3) + 1) % 3);
    expect(pageAt(t + 60_000, 3)).toBe(pageAt(t, 3));
    expect(pageAt(t, 1)).toBe(0);
    expect(pageAt(Number.NaN, 2)).toBe(0);
  });
});

describe("competitionRanks", () => {
  test("equal scores share a rank and the next rank skips", () => {
    expect(competitionRanks([95, 95, 95, 80, 70])).toEqual([1, 1, 1, 4, 5]);
    expect(competitionRanks([90, 80, 80, 60])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([])).toEqual([]);
    expect(competitionRanks([null, null])).toEqual([1, 1]);
  });
});

