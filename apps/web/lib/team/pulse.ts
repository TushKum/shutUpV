// Market pulse: the headline of the last trading round, for every team's Home: the biggest riser, the biggest faller
// and the most-traded company. Only public numbers (each round's prices and volumes are already on the Market
// pages); nothing about any team. Pure, so it is unit-tested; pulse-data.ts reads the rows.

export interface PulseRow {
  ticker: string | null;
  name: string | null;
  before: number | null;
  after: number;
  /** Shares that changed hands in the round: buys + sells + shorts + covers. */
  volume: number;
}

export interface PulseItem {
  ticker: string;
  name: string | null;
  /** Price change in basis points (+123 = +1.23%). */
  changeBp: number;
  price: number;
  volume: number;
}

export interface Pulse {
  round: number;
  riser: PulseItem | null;
  faller: PulseItem | null;
  busiest: PulseItem | null;
  /** Companies whose price went up, down, or did not move. */
  up: number;
  down: number;
  flat: number;
  totalVolume: number;
  mood: "BULL" | "BEAR" | "CALM";
}

/** Ties go to the ticker that comes first in the alphabet, so every screen shows the same headline. */
export function marketPulse(round: number, rows: readonly PulseRow[]): Pulse {
  const items: PulseItem[] = rows
    .filter((r): r is PulseRow & { ticker: string; before: number } => r.ticker !== null && r.before !== null && r.before > 0)
    .map((r) => ({ ticker: r.ticker, name: r.name, changeBp: Math.round(((r.after - r.before) * 10_000) / r.before), price: r.after, volume: r.volume }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  const best = (score: (i: PulseItem) => number, ok: (i: PulseItem) => boolean) =>
    items.filter(ok).reduce<PulseItem | null>((top, i) => (top === null || score(i) > score(top) ? i : top), null);
  const up = items.filter((i) => i.changeBp > 0).length;
  const down = items.filter((i) => i.changeBp < 0).length;
  return {
    round,
    riser: best((i) => i.changeBp, (i) => i.changeBp > 0),
    faller: best((i) => -i.changeBp, (i) => i.changeBp < 0),
    busiest: best((i) => i.volume, (i) => i.volume > 0),
    up,
    down,
    flat: items.length - up - down,
    totalVolume: items.reduce((n, i) => n + i.volume, 0),
    mood: up > down ? "BULL" : down > up ? "BEAR" : "CALM",
  };
}

export const MOODS: Record<Pulse["mood"], { icon: string; label: string; line: string }> = {
  BULL: { icon: "📈", label: "Bull round", line: "More prices went up than down." },
  BEAR: { icon: "📉", label: "Bear round", line: "More prices went down than up." },
  CALM: { icon: "⚖️", label: "Calm round", line: "As many prices rose as fell." },
};
