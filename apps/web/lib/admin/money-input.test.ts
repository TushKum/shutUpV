import { describe, expect, test } from "vitest";
import { parseDollars, parseShares } from "./money-input";

const cents = (s: string) => {
  const r = parseDollars(s);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const refused = (s: string) => {
  const r = parseDollars(s);
  if (r.ok) throw new Error(`accepted ${s} as ${r.value}`);
  return r.message;
};

describe("parseDollars: exact dollars → integer cents", () => {
  test("the examples", () => {
    expect(cents("12.34")).toBe(1234);
    expect(cents("-0.5")).toBe(-50);
  });

  test("whole dollars, one or two decimals, signs", () => {
    expect(cents("12")).toBe(1200);
    expect(cents("12.3")).toBe(1230);
    expect(cents("12.30")).toBe(1230);
    expect(cents("0.01")).toBe(1);
    expect(cents("-0.01")).toBe(-1);
    expect(cents("+5")).toBe(500);
    expect(cents(".5")).toBe(50);
    expect(cents("-.05")).toBe(-5);
    expect(cents("007.10")).toBe(710);
  });

  test("never floating point: values that a float would get wrong", () => {
    // 0.29 × 100 = 28.999999999999996 and 1.005 × 100 = 100.49999999999999 in floating point.
    expect(cents("0.29")).toBe(29);
    expect(cents("4.35")).toBe(435);
    expect(cents("1234567.89")).toBe(123456789);
    expect(cents("9999999999999.99")).toBe(999999999999999);
    expect(Number.isSafeInteger(cents("9999999999999.99"))).toBe(true);
  });

  test("a dollar sign, thousands separators, the minus sign money() prints, spaces", () => {
    expect(cents("$1,000")).toBe(100000);
    expect(cents("-$1,234.56")).toBe(-123456);
    expect(cents("−$22,500.00")).toBe(-2250000);
    expect(cents("  25 000 ")).toBe(2500000);
    expect(cents("1,234,567")).toBe(123456700);
  });

  test("an empty field is no change; zero is zero (never −0)", () => {
    expect(cents("")).toBeNull();
    expect(cents("   ")).toBeNull();
    expect(Object.is(cents("-0"), 0)).toBe(true);
    expect(Object.is(cents("-0.00"), 0)).toBe(true);
  });

  test("more than 2 decimals is refused", () => {
    expect(refused("12.345")).toBe("“12.345” has more than 2 decimals; amounts are in whole cents");
    expect(refused("0.001")).toMatch(/more than 2 decimals/);
    expect(refused("-1.000")).toMatch(/more than 2 decimals/);
  });

  test("anything that is not an amount is refused", () => {
    for (const s of ["abc", "12.", ".", "$", "-", "1,23", "12,34.5", "1.2.3", "--5", "5-", "1e3", "0x10", "12 dollars", "Infinity", "NaN"]) {
      expect(refused(s)).toMatch(/is not an amount in dollars/);
    }
  });

  test("an absurdly large amount is refused rather than rounded", () => {
    expect(refused("99999999999999")).toBe("“99999999999999” is too large");
    expect(refused("123456789012345678901234567890")).toMatch(/too large/);
  });
});

describe("parseShares: whole numbers of shares", () => {
  const shares = (s: string) => {
    const r = parseShares(s);
    if (!r.ok) throw new Error(r.message);
    return r.value;
  };
  test("signed whole numbers, with or without separators", () => {
    expect(shares("100")).toBe(100);
    expect(shares("-500")).toBe(-500);
    expect(shares("+2,000")).toBe(2000);
    expect(shares("−3,000")).toBe(-3000);
    expect(shares("")).toBeNull();
    expect(Object.is(shares("-0"), 0)).toBe(true);
  });
  test("decimals and anything else are refused", () => {
    expect(parseShares("10.5")).toEqual({ ok: false, message: "“10.5” is not a whole number of shares" });
    expect(parseShares("10.")).toEqual({ ok: false, message: "“10.” is not a whole number of shares" });
    expect(parseShares("ten")).toEqual({ ok: false, message: "“ten” is not a number of shares (for example 500 or -500)" });
    expect(parseShares("$10")).toMatchObject({ ok: false });
    expect(parseShares("1234567890")).toEqual({ ok: false, message: "“1234567890” is too large" });
  });
});
