import { describe, expect, test } from "vitest";
import { PHASE_CODES } from "@msim/engine";
import { focusSections, inFocus, opensIn, sectionOf, squadTabsFor, stageOf, STEPS, submissionsFor } from "./focus";
import { TEAM_SECTIONS } from "./sections";

const labels = (s: { label: string }[]) => s.map((x) => x.label);

describe("focus mode", () => {
  test("every phase has a stage and a plain-words step", () => {
    for (const p of PHASE_CODES) {
      expect(stageOf(p)).toBeTruthy();
      expect(STEPS[p].name.length).toBeGreaterThan(0);
    }
  });

  test("each round shows only its sections", () => {
    expect(labels(focusSections("PRODUCT", "SETUP"))).toEqual(["Home", "Bulletins", "Judging"]);
    expect(labels(focusSections("PRODUCT", "BUILD"))).toEqual(["Home", "Squad", "Chat", "Market", "Q&A", "Bulletins"]);
    expect(labels(focusSections("PRODUCT", "RESCUE_1"))).toEqual(["Home", "Squad", "Rescue", "Chat", "Market", "Bulletins"]);
    expect(labels(focusSections("CONSULTING", "ROUNDS_13_21"))).toEqual(["Home", "Squad", "Chat", "Calls", "Market", "Bulletins"]);
    expect(labels(focusSections("FINANCE", "IPO"))).toEqual(["Home", "Trade", "Chat", "Market", "Q&A", "Bulletins"]);
    expect(labels(focusSections("FINANCE", "CRISIS"))).toEqual(["Home", "Trade", "Rescue", "Chat", "Market", "Bulletins"]);
    // The results show everything.
    expect(focusSections("CONSULTING", "AWARDS")).toEqual([...TEAM_SECTIONS.CONSULTING]);
  });

  test("the section a 'do this now' task points to is never hidden", () => {
    expect(labels(focusSections("PRODUCT", "RESCUE_1", "/team/qa"))).toContain("Q&A");
    expect(inFocus("PRODUCT", "RESCUE_1", "/team/qa", "/team/qa")).toBe(true);
    expect(inFocus("PRODUCT", "RESCUE_1", "/team/qa")).toBe(false);
  });

  test("pages are matched by section, and a hidden page says when it opens", () => {
    expect(sectionOf("/team")).toBe("");
    expect(sectionOf("/team/market/AQS")).toBe("/market");
    expect(inFocus("FINANCE", "ROUNDS_1_4", "/team/trade/positions")).toBe(true);
    expect(inFocus("FINANCE", "ROUNDS_1_4", "/team/ledger")).toBe(false);
    expect(opensIn("FINANCE", "ROUNDS_1_4", "/team/rescue")).toBe("ROUND_2");
    expect(opensIn("FINANCE", "ROUNDS_1_4", "/team/ledger")).toBe("RESULTS");
    expect(opensIn("PRODUCT", "RESCUE_1", "/team/qa")).toBe("RESULTS");
  });

  test("the squad tabs follow the round", () => {
    expect(squadTabsFor("BUILD")).toEqual(["/team/squad", "/team/squad/problem", "/team/squad/pitch"]);
    expect(squadTabsFor("RESCUE_2")).toEqual(["/team/squad", "/team/squad/problem", "/team/squad/plan"]);
    expect(squadTabsFor("ROUNDS_13_21")).toContain("/team/squad/flash");
    expect(squadTabsFor("AWARDS")).toHaveLength(5);
    expect(submissionsFor("BUILD")).toEqual(["PITCH"]);
    expect(submissionsFor("RESCUE_1")).toEqual(["PLAN"]);
    expect(submissionsFor("ROUNDS_13_21")).toEqual(["PLAN", "FLASH"]);
    expect(submissionsFor("SETUP")).toEqual(["PITCH", "PLAN", "FLASH"]);
  });
});
