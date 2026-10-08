import { describe, expect, test } from "vitest";
import { ago, cronState, describeOffset, parseHealth, seenAgo, teamScreens, type HealthTeam, type PingRow } from "./health";

const NOW = new Date("2026-11-14T18:00:00Z").getTime();
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

describe("admin_health", () => {
  test("parses the summary, counts arriving as numbers or strings", () => {
    const h = parseHealth({
      server_time: "2026-11-14T18:00:00+00:00",
      cron: { last_start: at(1), last_end: at(1), runs_last_10min: 300, failed_last_10min: "2", last_error: "boom" },
      tick_errors_last_hour: 3,
      screens: [
        { area: "admin", role: "ORGANISER", connected: 2, realtime_ok: 2 },
        { area: "team", role: "TEAM", connected: "140", realtime_ok: "137" },
      ],
    });
    expect(h).toEqual({
      serverTime: "2026-11-14T18:00:00+00:00",
      cron: { lastStart: at(1), lastEnd: at(1), runsLast10Min: 300, failedLast10Min: 2, lastError: "boom" },
      tickErrorsLastHour: 3,
      screens: [
        { area: "admin", role: "ORGANISER", connected: 2, realtimeOk: 2 },
        { area: "team", role: "TEAM", connected: 140, realtimeOk: 137 },
      ],
    });
  });

  test("no pg_cron, nothing connected", () => {
    expect(parseHealth({ server_time: "x", cron: null, tick_errors_last_hour: 0, screens: [] })).toMatchObject({ cron: null, screens: [] });
    expect(parseHealth(undefined)).toMatchObject({ cron: null, tickErrorsLastHour: 0, screens: [] });
  });

  test("the heartbeat's state", () => {
    const cron = { lastStart: at(1), lastEnd: at(1), runsLast10Min: 300, failedLast10Min: 0, lastError: null };
    expect(cronState(cron, NOW)).toEqual({ tone: "green", label: "Running every 2 seconds." });
    expect(cronState({ ...cron, failedLast10Min: 1 }, NOW)).toEqual({ tone: "amber", label: "1 failed run in the last 10 minutes." });
    expect(cronState({ ...cron, failedLast10Min: 4 }, NOW).label).toBe("4 failed runs in the last 10 minutes.");
    expect(cronState({ ...cron, lastStart: at(95) }, NOW)).toEqual({ tone: "red", label: "No heartbeat for 1 min." });
    expect(cronState({ ...cron, lastStart: null }, NOW).tone).toBe("red");
    expect(cronState(null, NOW)).toEqual({ tone: "red", label: "pg_cron is not installed: only an open organiser console ticks the game." });
  });

  test("ages", () => {
    expect([ago(0), ago(8_999), ago(61_000), ago(7_300_000), ago(-5)]).toEqual(["0 s", "8 s", "1 min", "2 h", "0 s"]);
    expect(seenAgo(at(12), NOW)).toBe("12 s ago");
    expect(seenAgo(null, NOW)).toBe("never");
  });
});

describe("team screens", () => {
  const teams: HealthTeam[] = [
    { id: "p1", code: "P01", track: "PRODUCT" },
    { id: "c1", code: "C01", track: "CONSULTING" },
    { id: "f1", code: "F01", track: "FINANCE" },
    { id: "f2", code: "F02", track: "FINANCE" },
  ];
  const ping = (client: string, team: string | null, secondsAgo: number, realtime = "SUBSCRIBED"): PingRow => ({
    client_id: client,
    team_id: team,
    role: team ? "TEAM" : "ORGANISER",
    area: team ? "team" : "admin",
    realtime,
    first_seen: at(600),
    last_seen: at(secondsAgo),
  });

  test("connected screens (seen in the last 60 s) and the teams with none, with when they were last seen", () => {
    const { connected, silent } = teamScreens(
      teams,
      [
        ping("a", "f1", 5),
        ping("b", "f1", 30, "CHANNEL_ERROR"), // a second screen of F01 (phone)
        ping("c", "p1", 61), // stale: P01 has no screen now
        ping("d", "p1", 300),
        ping("e", null, 1), // an organiser's console is not a team screen
        ping("f", "other-event-team", 1),
      ],
      NOW,
    );
    expect(connected.map((c) => [c.clientId, c.code, c.realtime])).toEqual([
      ["a", "F01", "SUBSCRIBED"],
      ["b", "F01", "CHANNEL_ERROR"],
    ]);
    expect(silent).toEqual([
      { code: "C01", track: "CONSULTING", lastSeen: null },
      { code: "F02", track: "FINANCE", lastSeen: null },
      { code: "P01", track: "PRODUCT", lastSeen: at(61) },
    ]);
  });

  test("exactly 60 s ago still counts as connected", () => {
    expect(teamScreens(teams, [ping("a", "c1", 60)], NOW).connected).toHaveLength(1);
  });
});

describe("clock offset", () => {
  test("describes how far this browser's clock is from the server's", () => {
    expect(describeOffset(40)).toEqual({ tone: "green", label: "In step with the server (within 0.1 s)." });
    expect(describeOffset(-99)).toMatchObject({ tone: "green" });
    expect(describeOffset(1500)).toEqual({ tone: "green", label: "This browser's clock is 1.5 s behind the server." });
    expect(describeOffset(-2500)).toEqual({ tone: "amber", label: "This browser's clock is 2.5 s ahead of the server." });
    expect(describeOffset(125_400).label).toBe("This browser's clock is 125 s behind the server.");
  });
});
