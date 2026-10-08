import { describe, expect, test } from "vitest";
import { bp, clock, count, countdown, dateTime, money, relative } from "./format";

describe("format", () => {
  test("money from integer cents, including bigint strings", () => {
    expect(money(123456)).toBe("$1,234.56");
    expect(money("-5000000")).toBe("−$50,000.00");
    expect(money(0)).toBe("$0.00");
    expect(money(null)).toBe("—");
    expect(money("90071992547409930")).toBe("90071992547409930¢"); // beyond safe integers: shown raw, never rounded
  });

  test("counts and basis points", () => {
    expect(count(12500)).toBe("12,500");
    expect(count("3110")).toBe("3,110");
    expect(bp(2000)).toBe("+20%");
    expect(bp(-1000)).toBe("−10%");
    expect(bp(250)).toBe("+2.5%");
    expect(bp(-125)).toBe("−1.25%");
    expect(bp(0)).toBe("0%");
  });

  test("times are shown in Asia/Kolkata whatever the machine's zone", () => {
    expect(clock("2026-11-14T14:30:00Z")).toBe("20:00");
    expect(clock("2026-11-14T21:29:59Z", true)).toBe("02:59:59");
    expect(dateTime("2026-11-14T14:30:00Z")).toBe("14 Nov, 20:00");
    expect(clock(null)).toBe("—");
  });

  test("countdowns and relative times", () => {
    expect(countdown(245_900)).toBe("4:05");
    expect(countdown(3_723_000)).toBe("1:02:03");
    expect(countdown(-5_000)).toBe("0:00");
    const now = Date.parse("2026-11-14T14:30:00Z");
    expect(relative("2026-11-14T14:34:00Z", now)).toBe("in 4 min");
    expect(relative("2026-11-14T14:28:00Z", now)).toBe("2 min ago");
    expect(relative("2026-11-14T14:30:20Z", now)).toBe("now");
    expect(relative("2026-11-14T17:30:00Z", now)).toBe("in 3 h");
  });
});
