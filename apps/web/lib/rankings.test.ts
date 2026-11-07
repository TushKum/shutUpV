import { describe, expect, test } from "vitest";
import { PHASE_CODES, phaseReached } from "@msim/engine";
import { decideRankingsAccess } from "./rankings";

describe("rankings access", () => {
  test("acceptance 13: after the 03:30 freeze and before AWARDS, teams get 403", () => {
    for (const phase of PHASE_CODES) {
      expect(decideRankingsAccess("TEAM", phase, false)).toEqual({ ok: true });
      const frozen = decideRankingsAccess("TEAM", phase, true);
      if (phaseReached(phase, "AWARDS")) expect(frozen).toEqual({ ok: true });
      else expect(frozen).toMatchObject({ ok: false, status: 403 });
    }
  });

  test("the display follows teams; organisers and the fairness officer always see it", () => {
    expect(decideRankingsAccess("DISPLAY", "SETTLEMENT", true)).toMatchObject({ status: 403 });
    expect(decideRankingsAccess("DISPLAY", "AWARDS", true)).toEqual({ ok: true });
    for (const role of ["ORGANISER", "FAIRNESS"] as const) expect(decideRankingsAccess(role, "MARKET", true)).toEqual({ ok: true });
  });

  test("signed out is 401; an unknown event is 404; an unknown phase 400", () => {
    expect(decideRankingsAccess(null, "AWARDS", false)).toMatchObject({ status: 401 });
    expect(decideRankingsAccess("TEAM", null, false)).toMatchObject({ status: 404 });
    expect(decideRankingsAccess("TEAM", "NOT_A_PHASE", false)).toMatchObject({ status: 400 });
  });
});
