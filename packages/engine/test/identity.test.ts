import { expect, test } from "vitest";
import { TEAM_CODE_RE, normalizePassword, normalizeTeamCode, teamCode, teamEmail } from "../src/identity";

test("team codes: T001–T150, another letter for rehearsals", () => {
  expect(teamCode(1)).toBe("T001");
  expect(teamCode(150)).toBe("T150");
  expect(teamCode(7, "X")).toBe("X007");
  expect(TEAM_CODE_RE.test("T001")).toBe(true);
  expect(TEAM_CODE_RE.test("t001")).toBe(false);
  expect(TEAM_CODE_RE.test("T01")).toBe(false);
  expect(() => teamCode(0)).toThrow();
  expect(() => teamCode(1, "XY")).toThrow();
});

test("codes typed on a phone are normalised", () => {
  expect(normalizeTeamCode(" t7 ")).toBe("T007");
  expect(normalizeTeamCode("t-41")).toBe("T041");
  expect(normalizeTeamCode("x 3")).toBe("X003");
  expect(normalizeTeamCode("T150")).toBe("T150");
});

test("synthetic login email", () => {
  expect(teamEmail("t7", "Teams.Example.org")).toBe("t007@teams.example.org");
  expect(() => teamEmail("hello", "x.org")).toThrow();
});

test("passwords are normalised to XXXX-XXXX-XXXX", () => {
  expect(normalizePassword("abcd efgh jkmn")).toBe("ABCD-EFGH-JKMN");
  expect(normalizePassword("ABCD-EFGH-JKMN")).toBe("ABCD-EFGH-JKMN");
  expect(normalizePassword("short")).toBe("short");
});
