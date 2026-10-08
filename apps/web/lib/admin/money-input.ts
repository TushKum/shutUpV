// Amounts typed by staff (a ledger correction's cash and share changes), converted exactly from the text: dollars
// become integer cents by reading the digits, never through a floating-point number ("12.34" → 1234, "-0.5" → -50).
// The game function checks the limits again; this only turns text into whole numbers or says why it cannot.

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

// A leading sign may be "+", "-" or the minus sign money() prints ("−"), so a copied amount parses.
const SIGN = "[+\\-−]?";
// Digits, optionally grouped in thousands with commas ("1,234,567").
const WHOLE = "(?:\\d+|\\d{1,3}(?:,\\d{3})+)";
const DOLLARS = new RegExp(`^(${SIGN})\\$?(${WHOLE})?(?:\\.(\\d+))?$`);
const SHARES = new RegExp(`^(${SIGN})(${WHOLE})$`);

// 13 integer digits keep cents below 2^53, so every step below is exact integer arithmetic.
const MAX_DOLLAR_DIGITS = 13;
const MAX_SHARE_DIGITS = 9;

const negative = (sign: string) => sign === "-" || sign === "−";
const noNegativeZero = (n: number) => (n === 0 ? 0 : n);

/**
 * Dollars to integer cents: "12.34" → 1234, "-0.5" → -50, "$1,000" → 100000, "−3" → -300.
 * An empty field is null (no change). More than 2 decimals, or anything that is not an amount, is refused.
 */
export function parseDollars(input: string): Parsed<number | null> {
  const text = input.trim().replace(/\s+/g, "");
  if (text === "") return { ok: true, value: null };
  const m = DOLLARS.exec(text);
  if (!m || (m[2] === undefined && m[3] === undefined)) return { ok: false, message: `“${input.trim()}” is not an amount in dollars (for example 1234.56 or -0.50)` };
  const [, sign, whole = "0", fraction = ""] = m;
  if (fraction.length > 2) return { ok: false, message: `“${input.trim()}” has more than 2 decimals; amounts are in whole cents` };
  const digits = whole.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_DOLLAR_DIGITS) return { ok: false, message: `“${input.trim()}” is too large` };
  const cents = Number(digits) * 100 + Number(fraction.padEnd(2, "0"));
  return { ok: true, value: noNegativeZero(negative(sign!) ? -cents : cents) };
}

/** A whole number of shares: "100" → 100, "-2,000" → -2000. Empty is null (no change); decimals are refused. */
export function parseShares(input: string): Parsed<number | null> {
  const text = input.trim().replace(/\s+/g, "");
  if (text === "") return { ok: true, value: null };
  const m = SHARES.exec(text);
  if (!m) {
    return /^[+\-−]?[\d,]*\.\d*$/.test(text)
      ? { ok: false, message: `“${input.trim()}” is not a whole number of shares` }
      : { ok: false, message: `“${input.trim()}” is not a number of shares (for example 500 or -500)` };
  }
  const digits = m[2]!.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_SHARE_DIGITS) return { ok: false, message: `“${input.trim()}” is too large` };
  const n = Number(digits);
  return { ok: true, value: noNegativeZero(negative(m[1]!) ? -n : n) };
}
