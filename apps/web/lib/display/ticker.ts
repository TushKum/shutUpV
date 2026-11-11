// The projector's news ticker: a scrolling strip of public news under the price board. Only what every screen may
// show: companies by ticker (never a team), the last round's biggest movers (as the verdicts screen shows top
// movers), the latest bulletins, how many rescue deals are signed, and the next deadline. No ranking of teams.

import { DEADLINE_LABELS, phaseReached, type DeadlineCode, type PhaseCode } from "@msim/engine";

export interface TickerMove {
  ticker: string;
  before: number;
  after: number;
}

export interface TickerInput {
  phase: PhaseCode;
  nowMs: number;
  lastRound: { number: number; moves: TickerMove[] } | null;
  bulletins: { kind: string; title: string }[];
  dealsSigned: number;
  squads: number;
  deadlines: { code: DeadlineCode; at: string }[];
  /** Formats an ISO time as the hall's clock (HH:MM, IST). */
  clock: (iso: string) => string;
}

export interface TickerItem {
  key: string;
  tag: string;
  text: string;
  tone: "up" | "down" | "news" | "info";
}

/** Not shown: the flash tier is an internal step, not something the hall acts on. */
const HIDDEN: ReadonlySet<DeadlineCode> = new Set(["FLASH_TIER"]);

const pct = (before: number, after: number) => {
  const bp = Math.round(((after - before) * 10_000) / before);
  const s = (Math.abs(bp) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${s}%`;
};

export function tickerItems(i: TickerInput, movers = 3): TickerItem[] {
  const out: TickerItem[] = [];
  if (i.lastRound && i.lastRound.moves.length) {
    const moved = i.lastRound.moves.filter((m) => m.before > 0 && m.after !== m.before);
    const up = moved.filter((m) => m.after > m.before).sort((a, b) => (b.after - b.before) / b.before - (a.after - a.before) / a.before || a.ticker.localeCompare(b.ticker));
    const down = moved.filter((m) => m.after < m.before).sort((a, b) => (a.after - a.before) / a.before - (b.after - b.before) / b.before || a.ticker.localeCompare(b.ticker));
    const r = `Round ${i.lastRound.number}`;
    if (up.length) out.push({ key: "up", tag: `${r} ▲`, text: up.slice(0, movers).map((m) => `${m.ticker} ${pct(m.before, m.after)}`).join("  ·  "), tone: "up" });
    if (down.length) out.push({ key: "down", tag: `${r} ▼`, text: down.slice(0, movers).map((m) => `${m.ticker} ${pct(m.before, m.after)}`).join("  ·  "), tone: "down" });
    if (!up.length && !down.length) out.push({ key: "flat", tag: r, text: "No price moved this round.", tone: "info" });
  }
  for (const [n, b] of i.bulletins.entries()) out.push({ key: `b${n}`, tag: b.kind, text: b.title, tone: "news" });
  if (phaseReached(i.phase, "CRISIS") && !phaseReached(i.phase, "CLOSE") && i.squads > 0) {
    out.push({ key: "deals", tag: "Rescue", text: `${i.dealsSigned} of ${i.squads} rescue deals signed`, tone: "info" });
  }
  const next = i.deadlines
    .filter((d) => !HIDDEN.has(d.code) && Date.parse(d.at) > i.nowMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (next) out.push({ key: "next", tag: "Next", text: `${DEADLINE_LABELS[next.code]} at ${i.clock(next.at)}`, tone: "info" });
  return out;
}
