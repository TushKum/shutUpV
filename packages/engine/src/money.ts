// Money and price arithmetic. Everything is an integer number of cents (or shares, or basis points).
// Division and rounding go through BigInt, so results are exact: no floating point ever decides a cent.
//
// Rounding rule (brief): "round half-up to the cent after every multiplication". Ties round away from
// zero, which is what Postgres round(numeric) does; every value that is rounded in this game is
// non-negative, where half-up and half-away-from-zero agree.

export type Cents = number;

export function assertInt(n: number, what = "value"): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${what} must be a whole number, got ${n}`);
}

function big(n: number | bigint, what: string): bigint {
  if (typeof n === "bigint") return n;
  assertInt(n, what);
  return BigInt(n);
}

function toNumber(b: bigint): number {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new Error(`result ${b} is outside the safe integer range`);
  return n;
}

/** round(num ÷ den), ties away from zero. */
export function divRoundHalfUp(num: number | bigint, den: number | bigint): number {
  const n = big(num, "numerator");
  const d = big(den, "denominator");
  if (d === 0n) throw new Error("division by zero");
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return toNumber(neg ? -q : q);
}

/** floor(num ÷ den) for non-negative inputs. */
export function floorDiv(num: number | bigint, den: number | bigint): number {
  const n = big(num, "numerator");
  const d = big(den, "denominator");
  if (n < 0n || d <= 0n) throw new Error("floorDiv expects num ≥ 0 and den > 0");
  return toNumber(n / d);
}

/** amount × num ÷ den, rounded half-up at once (e.g. mulRate(price, 85, 100) is ×0.85). */
export function mulRate(amount: number, num: number, den: number): number {
  return divRoundHalfUp(big(amount, "amount") * big(num, "rate numerator"), big(den, "rate denominator"));
}

/** qty × price, exactly (integer × integer). */
export function mul(a: number, b: number): number {
  return toNumber(big(a, "a") * big(b, "b"));
}

/** (a + b) ÷ 2, rounded half-up. */
export function avgHalfUp(a: number, b: number): number {
  return divRoundHalfUp(big(a, "a") + big(b, "b"), 2n);
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Whole dollars to cents, e.g. dollars(500_000) → 50_000_000. */
export function dollars(d: number): Cents {
  assertInt(d, "dollars");
  return d * 100;
}

/** "$1,234.56" (or "−$1,234.56"). */
export function formatCents(cents: number): string {
  assertInt(cents, "cents");
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}
