// The projector's news ticker: a scrolling strip of public news under the price board. Only what every screen may
// show: companies by ticker (never a team), the last round's biggest movers, the latest bulletins (rumours above all)
// and the next deadline. No ranking of teams. Changes are basis points rounded half-up, never floating point.

import { DEADLINE_LABELS, divRoundHalfUp, type DeadlineCode } from "@msim/engine";
import { BULLETIN_KIND_LABELS, type BulletinKind } from "@/lib/admin/content-bulletins";
import { bp } from "@/lib/format";

export interface TickerMove {
  ticker: string;
  before: number;
  after: number;
}

export interface TickerInput {
  nowMs: number;
  lastRound: { number: number; moves: TickerMove[] } | null;
  bulletins: { kind: string; title: string }[];
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

const changeOf = (m: TickerMove) => divRoundHalfUp((m.after - m.before) * 10_000, m.before);
const byTicker = (a: TickerMove, b: TickerMove) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);

export function tickerItems(i: TickerInput, movers = 3): TickerItem[] {
  const out: TickerItem[] = [];
  if (i.lastRound && i.lastRound.moves.length) {
    const moved = i.lastRound.moves.filter((m) => m.before > 0 && m.after !== m.before).map((m) => ({ ...m, bp: changeOf(m) }));
    const up = moved.filter((m) => m.after > m.before).sort((a, b) => b.bp - a.bp || byTicker(a, b));
    const down = moved.filter((m) => m.after < m.before).sort((a, b) => a.bp - b.bp || byTicker(a, b));
    const r = `Round ${i.lastRound.number}`;
    if (up.length) out.push({ key: "up", tag: `${r} ▲`, text: up.slice(0, movers).map((m) => `${m.ticker} ${bp(m.bp)}`).join("  ·  "), tone: "up" });
    if (down.length) out.push({ key: "down", tag: `${r} ▼`, text: down.slice(0, movers).map((m) => `${m.ticker} ${bp(m.bp)}`).join("  ·  "), tone: "down" });
    if (!up.length && !down.length) out.push({ key: "flat", tag: r, text: "No price moved this round.", tone: "info" });
  }
  for (const [n, b] of i.bulletins.entries()) {
    const tag = b.kind in BULLETIN_KIND_LABELS ? BULLETIN_KIND_LABELS[b.kind as BulletinKind] : b.kind;
    out.push({ key: `b${n}`, tag, text: b.kind === "RUMOUR" ? `${b.title} (unconfirmed)` : b.title, tone: "news" });
  }
  const next = i.deadlines.filter((d) => Date.parse(d.at) > i.nowMs).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (next) out.push({ key: "next", tag: "Next", text: `${DEADLINE_LABELS[next.code]} at ${i.clock(next.at)}`, tone: "info" });
  return out;
}
