import { describe, expect, test } from "vitest";
import { TEAM_SECTIONS, sectionAllowed } from "./sections";

describe("team sections", () => {
  test("every track has home and the public sections; each has its own tools", () => {
    for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
      expect(TEAM_SECTIONS[track].map((s) => s.label)).toEqual(expect.arrayContaining(["Home", "Market", "Q&A", "Ledger", "Bulletins", "Rescue"]));
    }
    expect(sectionAllowed("FINANCE", "/trade")).toBe(true);
    expect(sectionAllowed("PRODUCT", "/trade")).toBe(false);
    expect(sectionAllowed("CONSULTING", "/calls")).toBe(true);
    expect(sectionAllowed("FINANCE", "/squad")).toBe(false);
  });
});
