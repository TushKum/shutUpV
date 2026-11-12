import { describe, expect, test } from "vitest";
import { crisisHeadline, crisisSteps, currentStep, stepStates } from "./crisis-steps";

const t = (min: number) => new Date(Date.UTC(2026, 10, 14, 10, min)).toISOString();
const ms = (min: number) => Date.parse(t(min));
const D = { REVEAL_2: t(0), HIRE_2: t(20), DUE_2: t(65), RATE_2: t(80), DRAFT: t(15), HIRE_5: t(30), DUE_5: t(75), RATE_5: t(90) };

describe("the steps of a crisis", () => {
  test("each track reads the same steps in its own words", () => {
    expect(crisisSteps("PRODUCT", 2, D).map((s) => s.label)).toEqual(["Crisis card", "Hire a firm", "Write your plan", "Rate your firm", "Scores"]);
    expect(crisisSteps("CONSULTING", 2, D).map((s) => s.label)).toEqual(["Crisis card", "Win clients", "Write your memo", "Get rated", "Scores and bonus"]);
    expect(crisisSteps("FINANCE", 2, D)[1]!.label).toBe("Firms are hired");
    expect(crisisSteps("PRODUCT", 5, D).map((s) => s.key)).toEqual(["DRAFT", "HIRE", "WORK", "RATE", "SCORES"]);
    expect(crisisSteps("PRODUCT", 5, D)[2]!.label).toBe("Write your solution");
  });

  test("the first step not yet over is on now; the last never ends", () => {
    const steps = crisisSteps("PRODUCT", 2, D);
    expect(stepStates(steps, ms(5))).toEqual(["done", "now", "later", "later", "later"]);
    expect(stepStates(steps, ms(30))).toEqual(["done", "done", "now", "later", "later"]);
    expect(stepStates(steps, ms(70))).toEqual(["done", "done", "done", "now", "later"]);
    expect(stepStates(steps, ms(200))).toEqual(["done", "done", "done", "done", "now"]);
    expect(currentStep(steps, ms(30)).key).toBe("WORK");
  });

  test("Round 3 starts with the draft, which can end before its deadline", () => {
    expect(stepStates(crisisSteps("PRODUCT", 5, D), ms(5))[0]).toBe("now");
    expect(stepStates(crisisSteps("PRODUCT", 5, D, true), ms(5))).toEqual(["done", "now", "later", "later", "later"]);
  });

  test("the banner's headline", () => {
    expect(crisisHeadline("PRESSURE", null, null).name).toBe("Four crises are coming");
    expect(crisisHeadline("PRESSURE", 3, "WORK")).toEqual({ name: "Crisis 3 of 4", what: "Companies write their response plans. Firms write advice memos for their clients." });
    expect(crisisHeadline("SATURATION", 5, "DRAFT").what).toContain("The draft");
  });
});
