// A Consulting team's calls: BUY or SELL on each of its two covered companies, in three windows. Pure: when each
// window is open (as make_call decides it), what each call says now, and how it was judged (the calls table stores the
// baseline, the judged price, whether it was correct and the $2,500 it earned). Calls are private (PLAN Q5): only the
// consultant reads its own rows.

import { callEarnings, judgeCall, type CallDirection, type DeadlineCode, type SubmissionType } from "@msim/engine";
import { cents } from "@/lib/format";
import { deadlineState, type Deadlines, type PauseState } from "./rescue";

export type CallNo = 1 | 2 | 3;

export interface CallWindowSpec {
  no: CallNo;
  deadline: DeadlineCode;
  baseline: string;
  judgedAt: string;
  opens: string;
  judged: string;
}

/** The brief's table: due time, baseline and the price it is judged at. */
export const CALL_WINDOWS: readonly CallWindowSpec[] = [
  { no: 1, deadline: "CALL_1", baseline: "IPO price", judgedAt: "round 4 clearing price", opens: "at the squad draw", judged: "when round 4 clears" },
  { no: 2, deadline: "CALL_2", baseline: "price after the plan tier", judgedAt: "price after the flash tier", opens: "when the plan scores are released", judged: "when the flash tier is applied" },
  { no: 3, deadline: "CALL_3", baseline: "price after the flash tier", judgedAt: "closing price", opens: "when the flash scores are released", judged: "at the close" },
];

export interface CallsInput extends PauseState {
  nowMs: number;
  drawn: boolean;
  released: Record<SubmissionType, boolean>;
  marketClosed: boolean;
  deadlines: Deadlines;
}

export type WindowStage = "NOT_OPEN" | "OPEN" | "CLOSED";

/**
 * make_call's window: call 1 from the draw until 23:15 and before the pitch scores (the IPO prices) are released;
 * call 2 from the plan release until 03:40 and before the flash release; call 3 from the flash release until 04:30
 * and before the close. Each closes before the price it is judged at becomes known.
 */
export function windowStage(no: CallNo, i: CallsInput): WindowStage {
  const passed = deadlineState(i.deadlines[`CALL_${no}`], i.nowMs, i) === "PASSED";
  switch (no) {
    case 1:
      if (!i.drawn) return "NOT_OPEN";
      return passed || i.released.PITCH ? "CLOSED" : "OPEN";
    case 2:
      if (passed || i.released.FLASH) return "CLOSED";
      return i.released.PLAN ? "OPEN" : "NOT_OPEN";
    case 3:
      if (passed || i.marketClosed) return "CLOSED";
      return i.released.FLASH ? "OPEN" : "NOT_OPEN";
  }
}

export interface CallRow {
  id: string;
  company_id: string;
  call_no: number;
  direction: CallDirection | null;
  made_at: string | null;
  baseline_price: number | string | null;
  judged_price: number | string | null;
  correct: boolean | null;
  earnings_cents: number | string;
}

export type CallStage = WindowStage | "JUDGED";

export interface CallResult {
  baseline: number;
  judged: number;
  correct: boolean;
  earnings: number;
}

export interface CallCell {
  stage: CallStage;
  direction: CallDirection | null;
  madeAt: string | null;
  /** BUY and SELL can be sent now (the window is open and the call not judged). */
  editable: boolean;
  result: CallResult | null;
}

/** One company's call in one window. Judged once the database has stored the baseline and the judged price. */
export function callCell(row: CallRow | null, stage: WindowStage): CallCell {
  const direction = row?.direction ?? null;
  if (row && row.baseline_price !== null && row.judged_price !== null) {
    const baseline = cents(row.baseline_price);
    const judged = cents(row.judged_price);
    // What the database stored decides; the engine's rule fills in only a row stored without it.
    const correct = row.correct ?? judgeCall(direction, baseline, judged);
    return { stage: "JUDGED", direction, madeAt: row.made_at, editable: false, result: { baseline, judged, correct, earnings: row.correct === null ? callEarnings(correct) : cents(row.earnings_cents) } };
  }
  return { stage, direction, madeAt: row?.made_at ?? null, editable: stage === "OPEN" && row !== null, result: null };
}

export interface CallsSummary {
  judged: number;
  correct: number;
  earnings: number;
  /** Calls not judged yet (each could still earn $2,500). */
  pending: number;
}

export function callsSummary(cells: readonly CallCell[]): CallsSummary {
  let judged = 0;
  let correct = 0;
  let earnings = 0;
  for (const c of cells) {
    if (!c.result) continue;
    judged += 1;
    if (c.result.correct) correct += 1;
    earnings += c.result.earnings;
  }
  return { judged, correct, earnings, pending: cells.length - judged };
}

export interface CoveredCompany {
  id: string;
  ticker: string | null;
  name: string | null;
}

/**
 * The two covered companies in a stable order (ticker, then id). Before Reading a covered company is not public yet,
 * so it has no name or ticker here: "Covered company 1".
 */
export function coveredLabels(coverage: readonly { company_id: string }[], companies: readonly CoveredCompany[]): (CoveredCompany & { label: string })[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const rows = coverage.map((c) => byId.get(c.company_id) ?? { id: c.company_id, ticker: null, name: null });
  rows.sort((a, b) => (a.ticker ?? "￿").localeCompare(b.ticker ?? "￿") || a.id.localeCompare(b.id));
  return rows.map((c, i) => ({ ...c, label: c.ticker ?? `Covered company ${i + 1}` }));
}

/** The call a company has for a window (rows are unique per company and window). */
export function findCall(calls: readonly CallRow[], companyId: string, no: CallNo): CallRow | null {
  return calls.find((c) => c.company_id === companyId && c.call_no === no) ?? null;
}

/** The message after a call is sent. */
export function callSentText(direction: CallDirection, label: string, no: CallNo, due: string | null): string {
  return `Call ${no} on ${label}: ${direction}. You can change it until it closes${due ? ` at ${due}` : ""}.`;
}
