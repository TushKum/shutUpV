import { describe, expect, test } from "vitest";
import { PASSWORD_ALPHABET } from "@msim/engine";
import { derivePassword } from "../lib/credentials";
import { parseCsv } from "../lib/csv";
import { buildSeedPlan, staffFromCsv, teamRowsFromCsv, toSeedPayload } from "../lib/seed-plan";

const SECRET = "test-secret-0123456789";
const base = {
  slug: "primus-2026",
  name: "PRIMUS",
  rehearsal: false,
  clockSpeed: 1,
  startsAt: new Date("2026-11-20T14:30:00Z"),
  teamCount: 50,
  cardSecret: SECRET,
  emailDomain: "teams.example.org",
};

describe("csv", () => {
  test("quotes, escaped quotes, embedded commas and newlines", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n"multi\nline",z\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["multi\nline", "z"],
    ]);
  });
  test("skips blank lines and a BOM", () => {
    expect(parseCsv("﻿a\n\n b \n")).toEqual([["a"], [" b "]]);
  });
});

describe("derived passwords", () => {
  test("are stable, formatted and use the unambiguous alphabet", () => {
    const p = derivePassword(SECRET, "primus-2026", "T001");
    expect(p).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(p).toBe(derivePassword(SECRET, "primus-2026", "T001"));
    for (const ch of p.replace(/-/g, "")) expect(PASSWORD_ALPHABET).toContain(ch);
  });
  test("differ by team, event and secret", () => {
    const p = derivePassword(SECRET, "primus-2026", "T001");
    expect(derivePassword(SECRET, "primus-2026", "T002")).not.toBe(p);
    expect(derivePassword(SECRET, "rehearsal", "T001")).not.toBe(p);
    expect(derivePassword(`${SECRET}x`, "primus-2026", "T001")).not.toBe(p);
  });
  test("refuse a short secret", () => {
    expect(() => derivePassword("short", "e", "T001")).toThrow(/at least 16/);
  });
});

describe("seed plan", () => {
  test("50 teams with codes T001–T050, 3 backups and unique logins", () => {
    const plan = buildSeedPlan(base);
    expect(plan.teams).toHaveLength(53); // and 3 backups, B001–B003
    expect(plan.teams[0]!.code).toBe("T001");
    expect(plan.teams[49]!.code).toBe("T050");
    expect(plan.teams[50]!).toMatchObject({ code: "B001", backup: true });
    expect(new Set(plan.teams.map((t) => t.email)).size).toBe(53);
    expect(new Set(plan.teams.map((t) => t.password)).size).toBe(53);
    expect(plan.teams.find((t) => t.code === "T007")!.email).toBe("t007@teams.example.org");
  });

  test("every team starts Round 3 with $100,000", () => {
    expect(buildSeedPlan(base).starting_cash_cents).toBe(10_000_000);
  });

  test("the schedule: 13 phases and 9 rounds with durations, the twist and freeze offsets; no clock times", () => {
    const plan = buildSeedPlan(base);
    expect(plan.schedule.phases).toHaveLength(13);
    expect(plan.schedule.rounds).toHaveLength(9);
    expect(plan.schedule.phases.find((p) => p.code === "AWARDS")!.duration_seconds).toBeNull();
    expect(plan.schedule.twist_offset_seconds).toBe(3600);
    expect(JSON.stringify(plan.schedule)).not.toMatch(/_at"/);
  });

  test("the live event must have 50 teams coded T; a rehearsal can be smaller and uses another letter", () => {
    expect(() => buildSeedPlan({ ...base, teamCount: 10 })).toThrow(/exactly 50/);
    expect(() => buildSeedPlan({ ...base, codeLetter: "X" })).toThrow(/start with T/);
    const plan = buildSeedPlan({ ...base, slug: "rehearsal-1", rehearsal: true, clockSpeed: 10, teamCount: 4 });
    expect(plan.teams.map((t) => t.code)).toEqual(["X001", "X002", "X003", "X004"]);
    expect(plan.event.clock_speed).toBe(10);
    expect(() => buildSeedPlan({ ...base, rehearsal: true, teamCount: 4, codeLetter: "T" })).toThrow(/another letter/);
    expect(() => buildSeedPlan({ ...base, rehearsal: true, teamCount: 2 })).toThrow(/between 3 and 150/);
  });

  test("team names and members come from the CSV in order; the rest get placeholders", () => {
    const rows = teamRowsFromCsv(
      "team_name,member1_name,member1_roll,member2_name,member2_roll,member3_name,member3_roll\n" +
        "Team Alpha,Asha Rao,R100,Ben Ali,R101,Chen Li,R102\n" +
        "Team Beta,Dev Shah,R103,Esha Iyer,R104,Farah Khan,R105\n",
    );
    const plan = buildSeedPlan({ ...base, teamRows: rows });
    const t1 = plan.teams.find((t) => t.code === "T001")!;
    expect(t1.name).toBe("Team Alpha");
    expect(t1.members).toEqual([
      { full_name: "Asha Rao", roll_number: "R100" },
      { full_name: "Ben Ali", roll_number: "R101" },
      { full_name: "Chen Li", roll_number: "R102" },
    ]);
    expect(plan.teams.find((t) => t.code === "T002")!.name).toBe("Team Beta");
    expect(plan.teams.find((t) => t.code === "T003")!.name).toBe("Team T003");
  });

  test("a team has 3 or 4 members; the old track column is refused", () => {
    expect(() => teamRowsFromCsv("team_name,member1_name,member2_name\nX,A,B\n")).toThrow(/3 or 4 members/);
    expect(() => teamRowsFromCsv("track,team_name\nfinance,X\n")).toThrow(/no track column/);
  });

  test("an organiser cannot also be a team member", () => {
    const rows = teamRowsFromCsv("team_name,member1_name,member1_roll,member2_name,member3_name\nDelta,Asha Rao,R100,B,C\n");
    const staff = staffFromCsv("email,role,name,roll_number\nasha@college.edu,ORGANISER,Asha Rao,R100\n");
    expect(() => buildSeedPlan({ ...base, teamRows: rows, staff })).toThrow(/organisers cannot belong to a team/);
  });

  test("a roll number cannot be in two teams", () => {
    const rows = teamRowsFromCsv(
      "team_name,member1_name,member1_roll,member2_name,member3_name\nA,X,R1,P,Q\nB,Y,R1,S,T\n",
    );
    expect(() => buildSeedPlan({ ...base, teamRows: rows })).toThrow(/one team only/);
  });

  test("bad staff values are rejected with the row number", () => {
    expect(() => staffFromCsv("email,role,name\na@b.co,BOSS,A\n")).toThrow(/row 2/);
  });

  test("payload needs an auth user for every login, and carries the twist", () => {
    const plan = buildSeedPlan({ ...base, slug: "rh", rehearsal: true, teamCount: 3, twist: { title: "T", body: "B" } });
    expect(() => toSeedPayload(plan, new Map())).toThrow(/no auth user/);
    const ids = new Map(plan.teams.map((t, i) => [t.email, `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`]));
    const payload = toSeedPayload(plan, ids);
    expect(payload.teams).toHaveLength(3);
    expect(payload.teams[0]).not.toHaveProperty("password");
    expect(payload.twist).toEqual({ title: "T", body: "B" });
  });
});
