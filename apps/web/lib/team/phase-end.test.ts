import { describe, expect, test } from "vitest";
import { phaseOverText } from "./phase-end";

describe("phase end text", () => {
  test("a phase held at its gate says what it waits for, in team words", () => {
    expect(phaseOverText("READING", "Pitch scores have not been released.", "IPO")).toBe("waiting for the pitch scores");
    expect(phaseOverText("VERDICTS", "Plan scores have not been released.", "ROUNDS_13_21")).toBe("waiting for the plan scores");
    expect(phaseOverText("APPEALS", "Collusion flags are still open for the fairness officer.", "AWARDS")).toBe("waiting for the fairness officer");
  });

  test("otherwise the next phase, or the end of the event", () => {
    expect(phaseOverText("BUILD", null, "READING")).toBe("Reading next");
    expect(phaseOverText("AWARDS", "The event has ended.", null)).toBe("the event is over");
  });
});
