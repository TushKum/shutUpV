import { describe, expect, test } from "vitest";
import { eveningMoments, nextMoment } from "./countdown";

const at = (hhmm: string) => `2026-11-20T${hhmm}:00.000Z`;

describe("the evening countdown", () => {
  const moments = eveningMoments(
    { PROBLEM_DRAW: at("15:45"), TWIST: at("16:45"), PRD_LOCK: at("17:30"), QA_CLOSE: at("18:45") },
    { BRIEFING: at("15:15"), REVEAL_1: at("18:00"), MARKET: at("21:15") },
  );
  test("the evening's moments in order; later ones are not on this screen", () => {
    expect(moments.map((m) => m.key)).toEqual(["BRIEFING", "PROBLEM_DRAW", "TWIST", "PRD_LOCK", "REVEAL_1"]);
    expect(moments[3]!.label).toBe("PRD form locks");
  });
  test("the next one still ahead; none after the last", () => {
    expect(nextMoment(moments, Date.parse(at("16:00")))?.key).toBe("TWIST");
    expect(nextMoment(moments, Date.parse(at("16:45")))?.key).toBe("PRD_LOCK");
    expect(nextMoment(moments, Date.parse(at("18:00")))).toBeNull();
  });
});
