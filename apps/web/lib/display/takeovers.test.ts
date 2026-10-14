import { describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import {
  awardMetric,
  capPodium,
  changeBp,
  closingMovers,
  crisisTitle,
  evenPages,
  hexGroups,
  lotteryRecordUrl,
  pageAt,
  pitchSummary,
  podiumDensity,
  podiumNumbers,
  podiums,
  specialAwards,
  verdictMovers,
  type AwardRow,
  type ClosingRow,
  type PitchRow,
  type VerdictRow,
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

describe("crisisTitle", () => {
  test("only when it says more than the category", () => {
    expect(crisisTitle("Data breach", "Data breach")).toBeNull();
    expect(crisisTitle("Data breach", " data BREACH ")).toBeNull();
    expect(crisisTitle("Data breach", "")).toBeNull();
    expect(crisisTitle("Data breach", "Customer records leaked")).toBe("Customer records leaked");
  });
});

const v = (ticker: string, tierBp: number, score: number | null = 60): VerdictRow => ({ ticker, name: `${ticker} Ltd`, score, tierBp, before: 1000, after: 1000 });

describe("verdictMovers", () => {
  test("risers by highest tier, then score, then ticker; fallers by lowest tier, then score, then ticker", () => {
    const rows = [v("AAA", 500, 62), v("BBB", 2500, 95), v("CCC", 2000, 85), v("DDD", 2000, 88), v("EEE", -2000, 30), v("FFF", -1000, 45), v("GGG", -2000, 10), v("HHH", 0, 55)];
    const m = verdictMovers(rows);
    expect(m.risers.map((r) => r.ticker)).toEqual(["BBB", "DDD", "CCC", "AAA"]);
    expect(m.fallers.map((r) => r.ticker)).toEqual(["GGG", "EEE", "FFF"]);
    expect([m.up, m.down, m.unchanged]).toEqual([4, 3, 1]);
  });

  test("ties on tier and score go by ticker; at most 5 each", () => {
    const rows = ["ZZZ", "QQQ", "AAA", "MMM", "BBB", "CCC", "DDD"].map((t) => v(t, 1000, 75));
    const m = verdictMovers(rows);
    expect(m.risers.map((r) => r.ticker)).toEqual(["AAA", "BBB", "CCC", "DDD", "MMM"]);
    expect(m.fallers).toEqual([]);
    expect(m.up).toBe(7);
  });

  test("fewer than 5 companies", () => {
    const m = verdictMovers([v("AAA", -500, 40), v("BBB", 500, 75)]);
    expect(m.risers.map((r) => r.ticker)).toEqual(["BBB"]);
    expect(m.fallers.map((r) => r.ticker)).toEqual(["AAA"]);
  });

  test("all tiers equal: everyone on one side (or nobody moved)", () => {
    expect(verdictMovers([v("AAA", -500), v("BBB", -500)]).fallers.map((r) => r.ticker)).toEqual(["AAA", "BBB"]);
    const none = verdictMovers([v("AAA", 0), v("BBB", 0), v("CCC", 0)]);
    expect(none).toEqual({ risers: [], fallers: [], up: 0, down: 0, unchanged: 3 });
  });

  test("zero movers: no companies at all", () => {
    expect(verdictMovers([])).toEqual({ risers: [], fallers: [], up: 0, down: 0, unchanged: 0 });
  });

  test("a missing score sorts after any real score among equal tiers", () => {
    const m = verdictMovers([v("AAA", -2000, null), v("BBB", -2000, 0), v("CCC", 2000, null), v("DDD", 2000, 80)]);
    expect(m.risers.map((r) => r.ticker)).toEqual(["DDD", "CCC"]);
    expect(m.fallers.map((r) => r.ticker)).toEqual(["BBB", "AAA"]);
  });
});

const p = (ticker: string, score: number | null, ipoPrice: number | null): PitchRow => ({ ticker, name: null, score, ipoPrice });

describe("pitchSummary", () => {
  test("the highest IPO prices, highest score first; the count and the range", () => {
    const rows = [p("AAA", 60, 1050), p("BBB", 85, 1100), p("CCC", 81, 1100), p("DDD", 30, 900), p("EEE", 55, 1000), p("FFF", 60, 1050), p("GGG", 45, 950)];
    const s = pitchSummary(rows);
    expect(s.top.map((r) => r.ticker)).toEqual(["BBB", "CCC", "AAA", "FFF", "EEE"]);
    expect(s).toMatchObject({ listed: 7, low: 900, high: 1100 });
  });

  test("fewer than 5, all equal, and companies without a price", () => {
    const s = pitchSummary([p("CCC", 60, 1050), p("AAA", 60, 1050), p("BBB", null, null)]);
    expect(s.top.map((r) => r.ticker)).toEqual(["AAA", "CCC"]);
    expect(s).toMatchObject({ listed: 2, low: 1050, high: 1050 });
    expect(pitchSummary([])).toEqual({ listed: 0, low: null, high: null, top: [] });
  });
});

const c = (ticker: string, ipoPrice: number | null, closingPrice: number | null): ClosingRow => ({ ticker, name: null, ipoPrice, closingPrice });

describe("closingMovers", () => {
  test("gainers and losers by the change from the IPO price to the closing price", () => {
    const rows = [c("AQS", 1050, 1263), c("CCRT", 1000, 815), c("SNAP", 1000, 922), c("FLAT", 1000, 1000), c("UPP", 900, 1350), c("NOPE", 1000, null)];
    const m = closingMovers(rows);
    expect(m.gainers.map((r) => [r.ticker, r.changeBp])).toEqual([["UPP", 5000], ["AQS", 2029]]);
    expect(m.losers.map((r) => [r.ticker, r.changeBp])).toEqual([["CCRT", -1850], ["SNAP", -780]]);
    expect(m.flat).toBe(1);
  });

  test("ties go by ticker; at most 5; nobody moved", () => {
    const rows = ["FFF", "EEE", "DDD", "CCC", "BBB", "AAA"].map((t) => c(t, 1000, 1100));
    expect(closingMovers(rows).gainers.map((r) => r.ticker)).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE"]);
    expect(closingMovers([c("AAA", 1000, 1000)])).toEqual({ gainers: [], losers: [], flat: 1 });
    expect(closingMovers([])).toEqual({ gainers: [], losers: [], flat: 0 });
  });
});

const team = (code: string) => ({ code, name: `Team ${code}` });
const a = (code: string, place: number, t: string | null, metric: Record<string, unknown> = {}, ticker: string | null = null): AwardRow => ({
  code,
  place,
  metric,
  teams: t ? team(t) : null,
  companies: ticker ? { ticker, name: `${ticker} Ltd` } : null,
});

describe("podiums", () => {
  test("each track's places in order; a tie shares a place", () => {
    const awards = [
      a("PRODUCT_TOP3", 2, "P05"),
      a("PRODUCT_TOP3", 1, "P01"),
      a("PRODUCT_TOP3", 2, "P03"),
      a("FINANCE_TOP3", 1, "F02"),
      a("FINANCE_TOP3", 3, "F09"),
      a("FINANCE_TOP3", 2, "F04"),
      a("BEST_TURNAROUND", 1, "P01"),
    ];
    const [product, consulting, finance] = podiums(awards);
    expect(product!.label).toBe("Product");
    expect(product!.places.map((x) => [x.place, x.winners.map((w) => w.teams!.code)])).toEqual([
      [1, ["P01"]],
      [2, ["P03", "P05"]],
    ]);
    expect(consulting!.places).toEqual([]);
    expect(finance!.places.map((x) => x.place)).toEqual([1, 2, 3]);
  });

  test("at most 6 teams on a podium; the tied teams left out are counted", () => {
    const places = (sizes: number[]) => sizes.map((n, i) => ({ place: i + 1, winners: Array.from({ length: n }, (_, k) => a("FINANCE_TOP3", i + 1, `F${i}${k}`)) }));
    expect(capPodium(places([1, 1, 1]))).toMatchObject({ more: 0 });
    expect(capPodium(places([1, 2, 3])).places.map((p) => p.winners.length)).toEqual([1, 2, 3]);
    const big = capPodium(places([1, 1, 7]));
    expect(big.places.map((p) => p.winners.length)).toEqual([1, 1, 4]);
    expect(big.more).toBe(3);
    const firsts = capPodium(places([8]));
    expect(firsts.places.map((p) => p.winners.length)).toEqual([6]);
    expect(firsts.more).toBe(2);
    const late = capPodium(places([6, 1]));
    expect(late.places.map((p) => p.place)).toEqual([1]);
    expect(late.more).toBe(1);
    expect(capPodium([])).toEqual({ places: [], more: 0 });
    expect([1, 3, 4, 5, 6, 9].map(podiumDensity)).toEqual(["large", "large", "compact", "compact", "dense", "dense"]);
  });

  test("the final value and return of a winner", () => {
    expect(podiumNumbers(a("FINANCE_TOP3", 1, "F02", { final_value: 73_413_000, return_bp: 46_826 }))).toEqual({ value: "$734,130.00", change: "+468.26%", changeBp: 46_826 });
    expect(podiumNumbers(a("FINANCE_TOP3", 1, "F02", { final_value: "6663000", return_bp: null }))).toEqual({ value: "$66,630.00", change: "—", changeBp: null });
  });
});

describe("specialAwards", () => {
  test("a fixed order, with the winners of each (none, one, or a tie)", () => {
    const s = specialAwards([
      a("BEST_JUDGING_FUND", 1, "F07", { ai_value: 52_000_000, return_bp: 400 }),
      a("BEST_JUDGING_FUND", 1, "F03", { ai_value: 52_000_000, return_bp: 400 }),
      a("BEST_RESCUE_PLAN", 1, "P02", { score: 88, median: 88 }, "AQS"),
      a("PRODUCT_TOP3", 1, "P01"),
    ]);
    expect(s.map((x) => x.code)).toEqual(["BEST_TURNAROUND", "BEST_RESCUE_PLAN", "BEST_JUDGING_FUND"]);
    expect(s[0]!.winners).toEqual([]);
    expect(s[1]!.winners.map((w) => w.companies!.ticker)).toEqual(["AQS"]);
    expect(s[2]!.winners.map((w) => w.teams!.code)).toEqual(["F03", "F07"]);
    expect(s.map((x) => x.label)).toEqual(["Best turnaround", "Best rescue plan", "Best judging fund"]);
  });

  test("each metric in plain English", () => {
    expect(awardMetric(a("BEST_TURNAROUND", 1, "P01", { closing_price: 1263, post_crisis_price: 956 }, "AQS"))).toBe("$9.56 after the crisis → $12.63 at the close (+32.11%)");
    expect(awardMetric(a("BEST_RESCUE_PLAN", 1, "P01", { score: 88, median: 88 }, "AQS"))).toBe("Plan score 88 / 100");
    expect(awardMetric(a("BEST_JUDGING_FUND", 1, "F01", { ai_value: 52_000_000, return_bp: 400 }))).toBe("$520,000.00 at AI prices (+4%)");
    expect(awardMetric(a("PRODUCT_TOP3", 1, "P01", { final_value: 73_413_000, return_bp: 46_826 }))).toBe("$734,130.00 (+468.26%)");
    expect(awardMetric(a("BEST_RESCUE_PLAN", 1, "P01", {}))).toBe("Plan score — / 100");
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
