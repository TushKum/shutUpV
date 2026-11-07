import { describe, expect, test } from "vitest";
import { phaseOverText } from "./phase-end";

describe("phase end text", () => {
  test("a phase held at its gate says what it waits for, in team words", () => {
    expect(phaseOverText("BRIEFING", "Run the lottery (seed and dice) to deal the problem cards.", "BUILD")).toBe("waiting for the problem cards");
    expect(phaseOverText("JUDGING_1", "Some PRD scores are not sealed yet.", "REVEAL_1")).toBe("waiting for every PRD score");
    expect(phaseOverText("MARKET_BLIND", "Some crisis-solution scores are not sealed yet.", "MARKET")).toBe("waiting for every crisis-solution score");
    expect(phaseOverText("SETTLEMENT", "Collusion flags are still open for the fairness officer.", "AWARDS")).toBe("waiting for the fairness officer");
  });

  test("otherwise the next phase, or the end of the event", () => {
    expect(phaseOverText("BUILD", null, "JUDGING_1")).toBe("Judging the PRDs next");
    expect(phaseOverText("AWARDS", "The event has ended.", null)).toBe("the event is over");
  });
});
