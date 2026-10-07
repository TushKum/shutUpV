import { describe, expect, test } from "vitest";
import { PHASE_CODES } from "@msim/engine";
import { decideRankingsAccess } from "./rankings";

describe("rankings access", () => {
  test("acceptance 10: the rankings endpoint returns 403 to teams before AWARDS", () => {
    for (const phase of PHASE_CODES) {
      const d = decideRankingsAccess("TEAM", phase);
      if (phase === "AWARDS") expect(d).toEqual({ ok: true });
      else expect(d).toMatchObject({ ok: false, status: 403 });
    }
  });

  test("the display sees them only at AWARDS; organisers and the fairness officer from SETTLEMENT", () => {
    expect(decideRankingsAccess("DISPLAY", "APPEALS")).toMatchObject({ status: 403 });
    expect(decideRankingsAccess("DISPLAY", "AWARDS")).toEqual({ ok: true });
    for (const role of ["ORGANISER", "FAIRNESS"] as const) {
      expect(decideRankingsAccess(role, "CLOSE")).toMatchObject({ status: 403 });
      expect(decideRankingsAccess(role, "SETTLEMENT")).toEqual({ ok: true });
      expect(decideRankingsAccess(role, "APPEALS")).toEqual({ ok: true });
    }
  });

  test("signed out is 401; an unknown event is 404", () => {
    expect(decideRankingsAccess(null, "AWARDS")).toMatchObject({ status: 401 });
    expect(decideRankingsAccess("TEAM", null)).toMatchObject({ status: 404 });
    expect(decideRankingsAccess("TEAM", "NOT_A_PHASE")).toMatchObject({ status: 400 });
  });
});
