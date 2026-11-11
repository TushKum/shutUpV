import { describe, expect, test } from "vitest";
import { wireFeed } from "./wire";

describe("wire feed", () => {
  test("scores with their price move, the plans going public and bulletins, newest first", () => {
    const feed = wireFeed({
      scores: [
        { ticker: "AAA", type: "PITCH", score: 83, tierBp: 1000, releasedAt: "2026-11-20T17:00:00Z" },
        { ticker: "BBB", type: "PITCH", score: 45, tierBp: -500, releasedAt: "2026-11-20T17:00:00Z" },
        { ticker: "CCC", type: "PLAN", score: 55, tierBp: 0, releasedAt: "2026-11-20T22:00:00Z" },
        { ticker: null, type: "PITCH", score: 70, tierBp: 500, releasedAt: "2026-11-20T17:00:00Z" },
      ],
      bulletins: [{ kind: "CRISIS", title: "Every company is hit", publishedAt: "2026-11-20T19:00:00Z" }],
      plansPublishedAt: "2026-11-20T21:30:00Z",
    });
    expect(feed.map((i) => [i.kind, i.tone, i.text])).toEqual([
      ["SCORE", "flat", "CCC rescue plan scored 55 → price ±0%"],
      ["PLANS", "info", "Every rescue plan is now public: read them before the verdicts"],
      ["NEWS", "down", "CRISIS: Every company is hit"],
      ["SCORE", "up", "AAA pitch scored 83 → price +10%"],
      ["SCORE", "down", "BBB pitch scored 45 → price −5%"],
    ]);
    expect(feed[0]!.href).toBe("/team/market/CCC");
    expect(feed[1]!.href).toBe("/team/market/book?type=PLAN");
  });

  test("keeps only the newest items; an empty wire is empty", () => {
    const scores = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${String(i).padStart(2, "0")}`, type: "FLASH" as const, score: 70, tierBp: 500, releasedAt: `2026-11-20T23:${String(i).padStart(2, "0")}:00Z` }));
    const feed = wireFeed({ scores, bulletins: [], plansPublishedAt: null }, 20);
    expect(feed).toHaveLength(20);
    expect(feed[0]!.text).toBe("T29 flash answer scored 70 → price +5%");
    expect(wireFeed({ scores: [], bulletins: [], plansPublishedAt: null })).toEqual([]);
  });
});
