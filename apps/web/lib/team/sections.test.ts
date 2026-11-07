import { describe, expect, test } from "vitest";
import { TEAM_SECTIONS, sectionLive } from "./sections";

describe("team sections", () => {
  test("every team has the same sections, in the order of the night", () => {
    expect(TEAM_SECTIONS.map((s) => s.label)).toEqual([
      "Home",
      "Round 1: PRD",
      "Round 2: Rescue",
      "Q&A",
      "Market",
      "Round 3: Trade",
      "Ledger",
      "Leaderboard",
      "News",
      "How judging works",
    ]);
  });

  test("a section is live from its phase on", () => {
    const trade = TEAM_SECTIONS.find((s) => s.path === "/trade")!;
    expect(sectionLive(trade, "RESCUE")).toBe(false);
    expect(sectionLive(trade, "MARKET_BLIND")).toBe(true);
    expect(sectionLive(TEAM_SECTIONS[0]!, "SETUP")).toBe(true);
  });
});
