import { describe, expect, it } from "vitest";
import { awardLines, awardMetricText } from "./awards";

describe("awards", () => {
  it("in ceremony order, with codes, tickers and the metric", () => {
    const codes = new Map([
      ["t1", "A101"],
      ["t2", "B202"],
    ]);
    const tickers = new Map([["c1", "CMP"]]);
    const lines = awardLines(
      [
        { code: "BEST_COMPANY", team_id: "t1", company_id: "c1", metric: { rise_bp: 2500, post_crisis: 800, closing: 1000 } },
        { code: "BEST_COMPANY", team_id: "t2", company_id: "c1", metric: { rise_bp: 2500, post_crisis: 800, closing: 1000 } },
        { code: "WINNER", team_id: "t2", company_id: null, metric: { total: 241 } },
      ],
      codes,
      tickers,
    );
    expect(lines).toEqual([
      { code: "WINNER", winners: ["B202"], metric: "241 points" },
      { code: "BEST_COMPANY", winners: ["A101 (CMP)", "B202 (CMP)"], metric: "+25% from $8.00 to $10.00" },
    ]);
  });
  it("metrics", () => {
    expect(awardMetricText("BEST_INVESTOR", { return_bp: 1234 })).toBe("+12.34% return");
    expect(awardMetricText("BEST_PRD", { score: 91 })).toBe("score 91");
    expect(awardMetricText("THIRD", null)).toBe("");
  });
});
