import { describe, expect, test } from "vitest";
import { areaOf, canAccess, homeFor, safeNext } from "./routes";

describe("route access by role", () => {
  test("each role has a home", () => {
    expect(homeFor("TEAM")).toBe("/team");
    expect(homeFor("ORGANISER")).toBe("/admin");
    expect(homeFor("FAIRNESS")).toBe("/admin");
    expect(homeFor("DISPLAY")).toBe("/display");
  });

  test("teams cannot open the control panel or the projector view", () => {
    expect(canAccess("/team/orders", "TEAM")).toBe(true);
    expect(canAccess("/admin", "TEAM")).toBe(false);
    expect(canAccess("/admin/judge", "TEAM")).toBe(false);
    expect(canAccess("/display", "TEAM")).toBe(false);
  });

  test("the display account sees only the display", () => {
    expect(canAccess("/display", "DISPLAY")).toBe(true);
    expect(canAccess("/admin", "DISPLAY")).toBe(false);
    expect(canAccess("/team", "DISPLAY")).toBe(false);
  });

  test("organisers and the fairness officer use the control panel and may open the display, not the team portal", () => {
    for (const role of ["ORGANISER", "FAIRNESS"] as const) {
      expect(canAccess("/admin/fairness", role)).toBe(true);
      expect(canAccess("/display", role)).toBe(true);
      expect(canAccess("/team", role)).toBe(false);
    }
  });

  test("area matching is by path segment", () => {
    expect(areaOf("/teams")).toBeNull();
    expect(areaOf("/administrator")).toBeNull();
    expect(areaOf("/team")).toBe("/team");
  });

  test("next= after login: same-site paths of the role's own area only", () => {
    expect(safeNext("/team/orders", "TEAM")).toBe("/team/orders");
    expect(safeNext("/admin", "TEAM")).toBe("/team");
    expect(safeNext("//evil.example.com", "TEAM")).toBe("/team");
    expect(safeNext("https://evil.example.com/team", "TEAM")).toBe("/team");
    expect(safeNext("/\\evil.example.com", "TEAM")).toBe("/team");
    expect(safeNext(undefined, "ORGANISER")).toBe("/admin");
  });
});
