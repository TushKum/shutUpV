// Sectors on screen: each sector gets one colour everywhere (header badge, sector race, boards), and the sector race
// says how each sector's companies have done since their IPO, on average. Pure: the pages read the rows.

export interface SectorStyle {
  /** Text colour on black. */
  text: string;
  /** Border colour. */
  border: string;
  /** A solid chip: background and text. */
  chip: string;
  icon: string;
}

const KNOWN: Record<string, SectorStyle> = {
  luxury: { text: "text-[#d9a7ff]", border: "border-[#b06cff]", chip: "bg-[#b06cff] text-black", icon: "💎" },
  fmcg: { text: "text-[#7fe0a0]", border: "border-[#2ee07f]", chip: "bg-[#2ee07f] text-black", icon: "🛒" },
  energy: { text: "text-[#ffd25c]", border: "border-[#ffb000]", chip: "bg-[#ffb000] text-black", icon: "⚡" },
  aviation: { text: "text-[#8fd6ff]", border: "border-[#4fb8ff]", chip: "bg-[#4fb8ff] text-black", icon: "✈️" },
  fintech: { text: "text-[#ff9fb5]", border: "border-[#ff5c86]", chip: "bg-[#ff5c86] text-black", icon: "🏦" },
};
const OTHERS: SectorStyle[] = [
  { text: "text-[#9fe8e0]", border: "border-[#3fd0c0]", chip: "bg-[#3fd0c0] text-black", icon: "◆" },
  { text: "text-[#ffb98a]", border: "border-[#ff8a3d]", chip: "bg-[#ff8a3d] text-black", icon: "◆" },
];

const norm = (s: string) => s.trim().toLowerCase();

/** The sector's colours and icon: fixed for the known sectors, a stable pick for any other. */
export function sectorStyle(sector: string): SectorStyle {
  const k = norm(sector);
  if (KNOWN[k]) return KNOWN[k]!;
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return OTHERS[h % OTHERS.length]!;
}

export interface RaceCompany {
  ticker: string;
  sector: string;
  /** Integer cents. */
  ipo: number | null;
  price: number | null;
}

export interface SectorStanding {
  sector: string;
  companies: number;
  /** Average change from the IPO price, in basis points (half-up). */
  avgBp: number;
  best: { ticker: string; bp: number } | null;
}

const changeBp = (ipo: number, price: number) => Math.round(((price - ipo) * 10_000) / ipo);

/**
 * Each sector's average change since the IPO price (companies with both prices), best first; ties by name. Null
 * when there are fewer than two sectors (nothing to race).
 */
export function sectorRace(rows: readonly RaceCompany[]): SectorStanding[] | null {
  const by = new Map<string, { label: string; moves: { ticker: string; bp: number }[] }>();
  for (const r of rows) {
    if (!r.sector.trim() || r.ipo === null || r.price === null || r.ipo <= 0) continue;
    const k = norm(r.sector);
    const g = by.get(k) ?? { label: r.sector.trim(), moves: [] };
    g.moves.push({ ticker: r.ticker, bp: changeBp(r.ipo, r.price) });
    by.set(k, g);
  }
  if (by.size < 2) return null;
  return [...by.values()]
    .map((g) => ({
      sector: g.label,
      companies: g.moves.length,
      avgBp: Math.round(g.moves.reduce((s, m) => s + m.bp, 0) / g.moves.length),
      best: [...g.moves].sort((a, b) => b.bp - a.bp || a.ticker.localeCompare(b.ticker))[0] ?? null,
    }))
    .sort((a, b) => b.avgBp - a.avgBp || a.sector.localeCompare(b.sector));
}

/** "+4.25%" / "−1.10%". */
export const pctText = (bp: number) => `${bp >= 0 ? "+" : "−"}${(Math.abs(bp) / 100).toFixed(2)}%`;
