// "Your crises so far": one line per crisis of a PRIMUS event's Round 2 (and Round 3) about this team only. A
// company: its card, its plan's score and the price move it earned, and the stars it gave its firm. A firm: its
// clients, the fees, the stars it got and its bonus. Pure: lib/team/report-data.ts reads the rows.

export type ReportState = "later" | "now" | "judging" | "scored";

export interface CompanyReportRow {
  k: number;
  state: ReportState;
  /** The crisis card's title (Round 3: the problem statement's). */
  title: string | null;
  /** The plan's score out of 100, once released. */
  score: number | null;
  /** The price move the score gave, in basis points (Round 3: after the ranking within the statement). */
  moveBp: number | null;
  hired: boolean;
  rating: number | null;
}

export interface FirmReportRow {
  k: number;
  state: ReportState;
  clients: number;
  /** Cash fees received (released from escrow), in cents. */
  feesCents: number;
  /** Fee shares received. */
  feeShares: number;
  avgRating: number | null;
  /** The reputation bonus paid (can be negative), once the advice scores are released. */
  bonusCents: number | null;
}

export interface ReportEngagement {
  k: number;
  cash_cents: number;
  shares: number;
  escrow: "HELD" | "RELEASED" | "REFUNDED";
  rating: number | null;
  bonus_cents: number | null;
}

const KS = [1, 2, 3, 4, 5];

function stateOf(k: number, current: number | null, scored: boolean): ReportState {
  if (scored) return "scored";
  if (current === null || k > current) return "later";
  return k === current ? "now" : "judging";
}

/** A company's line per crisis. `current` is the crisis under way (5 in Round 3), null before the first. */
export function companyReport(
  current: number | null,
  cards: readonly { k: number; title: string }[],
  scores: readonly { k: number; score: number; tierBp: number | null }[],
  moves: readonly { k: number; tierBp: number }[],
  engagements: readonly ReportEngagement[],
  statementTitle: string | null = null,
): CompanyReportRow[] {
  return KS.filter((k) => k < 5 || current === 5).map((k) => {
    const s = scores.find((x) => x.k === k);
    const e = engagements.find((x) => x.k === k);
    return {
      k,
      state: stateOf(k, current, !!s),
      title: k === 5 ? statementTitle : (cards.find((c) => c.k === k)?.title ?? null),
      score: s?.score ?? null,
      moveBp: s ? (moves.find((m) => m.k === k)?.tierBp ?? s.tierBp) : null,
      hired: !!e,
      rating: e?.rating ?? null,
    };
  });
}

/** A firm's line per crisis. */
export function firmReport(current: number | null, engagements: readonly ReportEngagement[]): FirmReportRow[] {
  return KS.filter((k) => k < 5 || current === 5).map((k) => {
    const mine = engagements.filter((e) => e.k === k);
    const paid = mine.filter((e) => e.escrow === "RELEASED");
    const rated = mine.filter((e) => e.rating !== null);
    const bonuses = mine.filter((e) => e.bonus_cents !== null);
    return {
      k,
      state: stateOf(k, current, bonuses.length > 0),
      clients: mine.length,
      feesCents: paid.reduce((s, e) => s + e.cash_cents, 0),
      feeShares: paid.reduce((s, e) => s + e.shares, 0),
      avgRating: rated.length ? rated.reduce((s, e) => s + e.rating!, 0) / rated.length : null,
      bonusCents: bonuses.length ? bonuses.reduce((s, e) => s + e.bonus_cents!, 0) : null,
    };
  });
}

/** "+8%" / "−5%" from basis points. */
export function moveText(bp: number): string {
  const pct = Math.abs(bp) / 100;
  return `${bp < 0 ? "−" : "+"}${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}
