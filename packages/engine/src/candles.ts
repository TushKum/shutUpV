// Candlesticks: the patterns traders read (detected on any series of open/high/low/close candles), and the scripted
// price paths of the Round 1 practice market (deterministic per event and ticker, with the same patterns planted in
// them; most of them follow through, as the textbooks say, but not all).

/** One candle in cents. */
export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export type PatternBias = "bullish" | "bearish" | "neutral";
export type PatternName =
  | "Hammer"
  | "Shooting star"
  | "Bullish engulfing"
  | "Bearish engulfing"
  | "Doji"
  | "Three white soldiers"
  | "Three black crows"
  | "Breakout up"
  | "Breakdown";

export interface Pattern {
  /** The candle the pattern completes on. */
  index: number;
  name: PatternName;
  bias: PatternBias;
  /** One sentence for the tooltip: what it usually means. */
  hint: string;
}

export const PATTERN_HINTS: Record<PatternName, { bias: PatternBias; hint: string }> = {
  Hammer: { bias: "bullish", hint: "Sellers pushed it down, buyers pushed it back: after a fall, often a turn up." },
  "Shooting star": { bias: "bearish", hint: "Buyers pushed it up, sellers pushed it back: after a rise, often a turn down." },
  "Bullish engulfing": { bias: "bullish", hint: "A green body swallows the red one before it: buyers have taken over." },
  "Bearish engulfing": { bias: "bearish", hint: "A red body swallows the green one before it: sellers have taken over." },
  Doji: { bias: "neutral", hint: "Opened and closed at about the same price: indecision, watch the next candle." },
  "Three white soldiers": { bias: "bullish", hint: "Three strong green candles in a row: a steady uptrend." },
  "Three black crows": { bias: "bearish", hint: "Three strong red candles in a row: a steady downtrend." },
  "Breakout up": { bias: "bullish", hint: "Closed above the recent range: the move often carries on." },
  Breakdown: { bias: "bearish", hint: "Closed below the recent range: the fall often carries on." },
};

const body = (c: Ohlc) => Math.abs(c.close - c.open);
const range = (c: Ohlc) => c.high - c.low;
const upper = (c: Ohlc) => c.high - Math.max(c.open, c.close);
const lower = (c: Ohlc) => Math.min(c.open, c.close) - c.low;
const green = (c: Ohlc) => c.close > c.open;
const red = (c: Ohlc) => c.close < c.open;

/** Did the closes fall (or rise) over the `n` candles before `i`? */
function trendBefore(cs: readonly Ohlc[], i: number, n = 3): "down" | "up" | null {
  if (i < n) return null;
  const first = cs[i - n]!.close;
  const last = cs[i - 1]!.close;
  const moves = cs.slice(i - n + 1, i).map((c, k) => c.close - cs[i - n + k]!.close);
  if (last < first && moves.filter((m) => m < 0).length >= n - 2) return "down";
  if (last > first && moves.filter((m) => m > 0).length >= n - 2) return "up";
  return null;
}

/** The pattern the candle at `i` completes, or null (one per candle: the strongest signal wins). */
export function patternAt(cs: readonly Ohlc[], i: number): PatternName | null {
  const c = cs[i];
  if (!c) return null;
  const r = range(c);
  if (r <= 0) return null;
  const b = body(c);
  const prev = cs[i - 1];
  const trend = trendBefore(cs, i);

  // Engulfing: after a move the other way, a clearly bigger body swallowing the one before.
  const big = (x: Ohlc) => body(x) >= x.close * 0.004;
  if (prev && red(prev) && green(c) && c.open <= prev.close && c.close >= prev.open && b >= 1.5 * body(prev) && big(c) && trendBefore(cs, i - 1) === "down") return "Bullish engulfing";
  if (prev && green(prev) && red(c) && c.open >= prev.close && c.close <= prev.open && b >= 1.5 * body(prev) && big(c) && trendBefore(cs, i - 1) === "up") return "Bearish engulfing";
  if (trend === "down" && lower(c) >= 2 * Math.max(b, 1) && upper(c) <= Math.max(b, r * 0.15)) return "Hammer";
  if (trend === "up" && upper(c) >= 2 * Math.max(b, 1) && lower(c) <= Math.max(b, r * 0.15)) return "Shooting star";

  // A breakout: a solid candle closing beyond the last eight candles' range, when that range was tight (sideways).
  if (i >= 8 && b >= r * 0.5) {
    const box = cs.slice(i - 8, i);
    const hi = Math.max(...box.map((x) => x.high));
    const lo = Math.min(...box.map((x) => x.low));
    const tight = hi - lo <= c.open * 0.015;
    if (tight && green(c) && c.close > hi) return "Breakout up";
    if (tight && red(c) && c.close < lo) return "Breakdown";
  }
  if (i >= 2) {
    const three = cs.slice(i - 2, i + 1);
    const strong = (x: Ohlc) => range(x) > 0 && body(x) >= range(x) * 0.55;
    if (three.every((x) => green(x) && strong(x)) && three[1]!.close > three[0]!.close && three[2]!.close > three[1]!.close) return "Three white soldiers";
    if (three.every((x) => red(x) && strong(x)) && three[1]!.close < three[0]!.close && three[2]!.close < three[1]!.close) return "Three black crows";
  }

  if (b <= r * 0.1) return "Doji";
  return null;
}

/** Every pattern in the series, in order. */
export function detectPatterns(cs: readonly Ohlc[]): Pattern[] {
  const out: Pattern[] = [];
  for (let i = 0; i < cs.length; i++) {
    const name = patternAt(cs, i);
    if (name) out.push({ index: i, name, ...PATTERN_HINTS[name] });
  }
  return out;
}

// ───────────────────────────── The practice market ─────────────────────────────

export const PRACTICE = {
  /** Seconds between price ticks. */
  tickSeconds: 5,
  /** Ticks per candle (a 30-second candle). */
  candleTicks: 6,
  /** Candles scripted (90 minutes: room for a late or extended Round 1). */
  candles: 180,
  /** Practice money per fund, in cents. */
  startCents: 10_000_000,
  /** The most practice profit that becomes real cash, in cents. */
  edgeCapCents: 5_000_000,
  /** Position limits per company, in shares. */
  maxLong: 4000,
  maxShort: 2000,
  /** Collateral held against a short, as a share of its value. */
  shortCollateral: 1.5,
} as const;

/** A small deterministic generator (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A scripted candle and the pattern planted on it, if any. */
export interface ScriptedCandle extends Ohlc {
  planted: PatternName | null;
}

/**
 * The practice path for one ticker: `n` candles of trends, ranges and reversals, with patterns planted where a
 * trader would look for them. About 70% of planted signals follow through (the next segment goes their way).
 */
export function practiceCandles(seed: string, n: number = PRACTICE.candles): ScriptedCandle[] {
  const rnd = seededRandom(seed);
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const out: ScriptedCandle[] = [];
  let price = Math.round(between(1200, 4500));
  const floor = 200;

  const push = (open: number, close: number, hiExtra: number, loExtra: number, planted: PatternName | null) => {
    const o = Math.max(floor, Math.round(open));
    const c = Math.max(floor, Math.round(close));
    const high = Math.max(o, c) + Math.max(1, Math.round(hiExtra));
    const low = Math.max(floor - 50, Math.min(o, c) - Math.max(1, Math.round(loExtra)));
    out.push({ open: o, close: c, high, low, planted });
    price = c;
  };
  /** An ordinary candle drifting by `drift` (a fraction), with noise and small wicks. */
  const plain = (drift: number) => {
    const move = price * (drift + between(-0.0025, 0.0025));
    const b = Math.abs(move);
    push(price, price + move, between(0.15, 0.6) * b + price * 0.0015, between(0.15, 0.6) * b + price * 0.0015, null);
  };

  let direction: 1 | -1 = rnd() < 0.5 ? 1 : -1;
  let afterSignal = false;
  let nextRange = false;
  while (out.length < n) {
    const kind = rnd();
    // Right after a signal the market moves (a trend), so reading the signal pays; a trend that fades without a
    // signal goes sideways (a range) until it breaks out.
    if (!nextRange && (afterSignal || kind < 0.6)) {
      afterSignal = false;
      // A trend of 5 to 10 candles, ending in a reversal signal.
      const len = Math.floor(between(5, 11));
      const drift = direction * between(0.004, 0.009);
      for (let k = 0; k < len && out.length < n; k++) plain(drift);
      if (out.length >= n) break;
      if (rnd() < 0.3) {
        nextRange = true;
        continue;
      }
      const signal = rnd();
      const p = price;
      if (direction < 0) {
        if (signal < 0.4) push(p, p * (1 + between(0.0005, 0.002)), p * 0.0008, p * between(0.012, 0.02), "Hammer");
        else if (signal < 0.75) {
          plain(-0.004);
          const q = price;
          push(q * (1 - 0.0008), q * (1 + between(0.009, 0.015)), q * 0.001, q * 0.001, "Bullish engulfing");
        } else push(p, p * (1 + between(-0.0004, 0.0004)), p * 0.006, p * 0.006, "Doji");
      } else {
        if (signal < 0.4) push(p, p * (1 - between(0.0005, 0.002)), p * between(0.012, 0.02), p * 0.0008, "Shooting star");
        else if (signal < 0.75) {
          plain(0.004);
          const q = price;
          push(q * (1 + 0.0008), q * (1 - between(0.009, 0.015)), q * 0.001, q * 0.001, "Bearish engulfing");
        } else push(p, p * (1 + between(-0.0004, 0.0004)), p * 0.006, p * 0.006, "Doji");
      }
      if (rnd() < 0.75) direction = direction > 0 ? -1 : 1; // the signal follows through
      afterSignal = true;
    } else {
      // A tight range of 8 to 11 candles, then a breakout one way.
      nextRange = false;
      const len = Math.floor(between(8, 12));
      const mid = price;
      for (let k = 0; k < len && out.length < n; k++) {
        const target = mid * (1 + between(-0.0025, 0.0025));
        push(price, target, mid * 0.002, mid * 0.002, null);
      }
      if (out.length >= n) break;
      const up = rnd() < 0.5;
      const box = out.slice(-8);
      const edge = up ? Math.max(...box.map((x) => x.high)) : Math.min(...box.map((x) => x.low));
      const close = up ? edge * (1 + between(0.006, 0.012)) : edge * (1 - between(0.006, 0.012));
      push(price, close, price * 0.001, price * 0.001, up ? "Breakout up" : "Breakdown");
      direction = (rnd() < 0.75) === up ? 1 : -1;
      afterSignal = true;
    }
  }
  return out.slice(0, n);
}

/**
 * The ticks inside one candle: `PRACTICE.candleTicks` prices from the open to the close, touching the high and the
 * low (the low first on a candle that ends up, so a hammer is seen falling and then recovering).
 */
export function candleTicks(c: Ohlc, ticks: number = PRACTICE.candleTicks): number[] {
  const lowFirst = c.close >= c.open;
  const [a, b] = lowFirst ? [c.low, c.high] : [c.high, c.low];
  const path = [c.open, (c.open + a) / 2, a, (a + b) / 2, b, c.close];
  if (ticks !== 6) {
    // Resample the six-point path to `ticks` points (the first open, the last close).
    return Array.from({ length: ticks }, (_, i) => {
      const t = (i / (ticks - 1)) * 5;
      const k = Math.min(4, Math.floor(t));
      return Math.round(path[k]! + (path[k + 1]! - path[k]!) * (t - k));
    });
  }
  return path.map((v) => Math.round(v));
}

/** Rebuilds candles from ticks (`per` ticks each; a last partial candle is included: the one forming now). */
export function candlesFromTicks(ticks: readonly number[], per: number = PRACTICE.candleTicks): Ohlc[] {
  const out: Ohlc[] = [];
  for (let i = 0; i < ticks.length; i += per) {
    const part = ticks.slice(i, i + per);
    out.push({ open: part[0]!, close: part[part.length - 1]!, high: Math.max(...part), low: Math.min(...part) });
  }
  return out;
}

/** What a fund's practice profit is worth in the real market: profit only, capped. */
export function practiceEdge(equityCents: number): number {
  return Math.max(0, Math.min(PRACTICE.edgeCapCents, equityCents - PRACTICE.startCents));
}
