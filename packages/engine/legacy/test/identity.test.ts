import { expect, test } from "vitest";
import { TEAM_CODE_RE, normalizePassword, normalizeTeamCode, teamCode, teamEmail, trackOfCode } from "../src/identity";

test("team codes", () => {
  expect(teamCode("PRODUCT", 1)).toBe("P01");
  expect(teamCode("CONSULTING", 50)).toBe("C50");
  expect(teamCode("FINANCE", 7, "X")).toBe("XF07");
  expect(TEAM_CODE_RE.test("P01")).toBe(true);
  expect(TEAM_CODE_RE.test("p01")).toBe(false);
  expect(trackOfCode("XF07")).toBe("FINANCE");
  expect(trackOfCode("C12")).toBe("CONSULTING");
});

test("codes typed on a phone are normalised", () => {
  expect(normalizeTeamCode(" p7 ")).toBe("P07");
  expect(normalizeTeamCode("f-41")).toBe("F41");
  expect(normalizeTeamCode("xc 3")).toBe("XC03");
});

test("synthetic login email", () => {
  expect(teamEmail("p7", "Teams.Example.org")).toBe("p07@teams.example.org");
  expect(() => teamEmail("hello", "x.org")).toThrow();
});

test("passwords are normalised to XXXX-XXXX-XXXX", () => {
  expect(normalizePassword("abcd efgh jkmn")).toBe("ABCD-EFGH-JKMN");
  expect(normalizePassword("ABCD-EFGH-JKMN")).toBe("ABCD-EFGH-JKMN");
  expect(normalizePassword("short")).toBe("short");
});
