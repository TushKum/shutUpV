import { describe, expect, it } from "vitest";
import { boardView, liveParts, rankText, type BoardRow } from "./leaderboard";

const rows: BoardRow[] = [
  { team_id: "t1", code: "A101", r1: 80, r2: 70, r3: 60, total: 210, rank: 1 },
  { team_id: "t2", code: "B202", r1: 70, r2: 70, r3: 60, total: 200, rank: 2 },
  { team_id: "t3", code: "C303", r1: 90, r2: 90, r3: 90, total: 270, rank: null },
];

describe("boardView", () => {
  it("live, with the team's own row and the parts counted so far", () => {
    const v = boardView({ ok: true, data: { final: false, frozen: false, rows } }, "MARKET_BLIND", "t2");
    expect(v).toMatchObject({ state: "LIVE", mine: { code: "B202" }, parts: { r1: true, r2: false, r3: true } });
  });
  it("frozen: the function refuses between 03:30 and the awards", () => {
    expect(boardView({ ok: false, code: "NOT_ALLOWED", message: "the leaderboard is frozen until the awards" }, "MARKET", "t1")).toEqual({ state: "FROZEN" });
    expect(boardView({ ok: false, code: "ERROR", message: "boom" }, "MARKET", "t1")).toEqual({ state: "ERROR", message: "boom" });
  });
  it("final at the awards", () => {
    expect(boardView({ ok: true, data: { final: true, rows } }, "AWARDS", "t1")).toMatchObject({ state: "FINAL", mine: { rank: 1 } });
  });
});

describe("helpers", () => {
  it("liveParts", () => {
    expect(liveParts("BUILD")).toEqual({ r1: false, r2: false, r3: false });
    expect(liveParts("MARKET")).toEqual({ r1: true, r2: true, r3: true });
  });
  it("rankText", () => {
    expect(rankText(rows[0]!, 40)).toBe("1st of 40");
    expect(rankText({ ...rows[0]!, rank: 12 }, 40)).toBe("12th of 40");
    expect(rankText({ ...rows[0]!, rank: 23 }, 40)).toBe("23rd of 40");
    expect(rankText(rows[2]!, 40)).toBe("not ranked");
    expect(rankText(null, 40)).toBe("—");
  });
});
