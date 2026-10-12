// What a Consulting team earns, line by line: the advisor's fee (cash, and fee shares valued at the current price, at
// the closing price after the close), the $5,000 deal bonus (deal fully signed by 02:45), the plan bonus
// ($500 × (plan score − 50), once the plan score is released) and the $2,500 of each correct call. Pure. A line is
// FINAL when nothing can change it, a PROJECTION when it is an estimate (a fee share at today's price, a fee not agreed
// yet), and PENDING when it is not known yet. Consultant bonuses are paid as cash at settlement. No ranking.

import { DEFAULT_FEE, RULES, mul, planBonus } from "@msim/engine";
import { money } from "@/lib/format";
import type { CallCell } from "./calls";
import type { DealView, FeeView } from "./rescue";

export type LineStatus = "FINAL" | "PROJECTION" | "PENDING";

export interface EarningsLine {
  key: string;
  label: string;
  /** Integer cents; null when not known yet. */
  amount: number | null;
  status: LineStatus;
  note: string;
}

export interface PlanScore {
  final_score: number;
  capped: boolean;
  late: boolean;
  missing: boolean;
  penalty: number;
}

export interface EarningsInput {
  fee: Pick<FeeView, "stage" | "proposal" | "executed">;
  /** The FEE lot this team holds (fee shares). */
  feeShares: number;
  marketPrice: number | null;
  closingPrice: number | null;
  marketClosed: boolean;
  deal: Pick<DealView, "bonus" | "stage">;
  plan: PlanScore | null;
  calls: { label: string; no: number; cell: CallCell }[];
  /** The event's fee deadline and deal-bonus cut-off, as shown ("01:05", "02:45"). */
  times?: { fee?: string | null; bonus?: string | null };
}

export interface Earnings {
  lines: EarningsLine[];
  /** Σ FINAL lines. */
  secured: number;
  /** Σ FINAL and PROJECTION lines. */
  projected: number;
  /** Lines not known yet. */
  pending: number;
  /** Every line is final: the consultant's final value (cash + fee shares × closing price). */
  final: boolean;
}

export function earnings(i: EarningsInput): Earnings {
  const lines: EarningsLine[] = [];
  const feeAt = i.times?.fee ?? "01:05";
  const bonusAt = i.times?.bonus ?? "02:45";
  const price = i.marketClosed && i.closingPrice !== null ? i.closingPrice : i.marketPrice;
  const priceName = i.marketClosed && i.closingPrice !== null ? "closing price" : "current price";

  // The fee: what was paid, or what is on the table.
  if (i.fee.executed) {
    const e = i.fee.executed;
    lines.push({
      key: "fee-cash",
      label: e.isDefault ? "Default fee (cash)" : "Agreed fee: cash",
      amount: e.cash,
      status: "FINAL",
      note: e.isDefault ? `No fee was confirmed by both teams by ${feeAt}, so the default $22,500 cash was paid.` : "Paid to your team when both teams confirmed the fee.",
    });
  } else if (i.fee.stage === "DEFAULT_PENDING") {
    lines.push({
      key: "fee-cash",
      label: "Default fee (cash)",
      amount: DEFAULT_FEE.cash,
      status: "PROJECTION",
      note: `No fee was confirmed by both teams by ${feeAt}: the default $22,500 cash is being paid.`,
    });
  } else if (i.fee.proposal) {
    const p = i.fee.proposal;
    lines.push({
      key: "fee-cash",
      label: "Proposed fee: cash",
      amount: p.cash,
      status: "PROJECTION",
      note: `Not agreed yet: both teams must confirm the same terms by ${feeAt}, otherwise the default $22,500 cash is paid instead.`,
    });
  } else {
    lines.push({
      key: "fee-cash",
      label: "Fee (default if none is agreed)",
      amount: DEFAULT_FEE.cash,
      status: "PROJECTION",
      note:
        i.fee.stage === "BEFORE_CRISIS"
          ? `The fee is agreed with the Product team after the crisis, until ${feeAt}. If none is agreed, the default is $22,500 cash.`
          : `No fee proposed yet. If none is agreed by ${feeAt}, the default $22,500 cash is paid.`,
    });
  }
  const shares = i.fee.executed ? i.feeShares : i.fee.stage === "DEFAULT_PENDING" ? 0 : (i.fee.proposal?.shares ?? 0);
  if (shares > 0) {
    const value = price === null ? null : mul(shares, price);
    lines.push({
      key: "fee-shares",
      label: `${i.fee.executed ? "Fee shares" : "Proposed fee shares"}: ${shares.toLocaleString("en-US")} × ${priceName}`,
      amount: value,
      status: i.fee.executed && i.marketClosed && i.closingPrice !== null ? "FINAL" : "PROJECTION",
      note:
        price === null
          ? "Valued at the company's price once it has one."
          : i.marketClosed && i.closingPrice !== null
            ? `Valued at the closing price ${money(price)}.`
            : `Valued at today's market price ${money(price)}; the final value uses the closing price.`,
    });
  }

  // The deal bonus.
  lines.push({
    key: "deal-bonus",
    label: "Deal bonus",
    amount: i.deal.bonus === "YES" ? RULES.DEAL_BONUS : i.deal.bonus === "NO" ? 0 : null,
    status: i.deal.bonus === "OPEN" ? "PENDING" : "FINAL",
    note:
      i.deal.bonus === "YES"
        ? `$5,000: the deal was fully signed by ${bonusAt}.`
        : i.deal.bonus === "NO"
          ? `$0: the deal was not fully signed by ${bonusAt}.`
          : `$5,000 if all three teams sign the deal by ${bonusAt}.`,
  });

  // The plan bonus.
  if (i.plan) {
    const why = i.plan.missing ? " (no plan submitted on time)" : i.plan.capped ? " (capped at 50: no deal fully signed at 03:00)" : i.plan.penalty ? ` (after a ${i.plan.penalty}-point penalty)` : "";
    lines.push({
      key: "plan-bonus",
      label: `Plan bonus: plan score ${i.plan.final_score}`,
      amount: planBonus(i.plan.final_score),
      status: "FINAL",
      note: `$500 × (${i.plan.final_score} − 50), between −$10,000 and +$25,000${why}.`,
    });
  } else {
    lines.push({
      key: "plan-bonus",
      label: "Plan bonus",
      amount: null,
      status: "PENDING",
      note: "$500 × (plan score − 50), between −$10,000 and +$25,000, once your squad's plan score is released at the verdicts.",
    });
  }

  // The calls.
  for (const c of i.calls) {
    const r = c.cell.result;
    lines.push({
      key: `call-${c.no}-${c.label}`,
      label: `Call ${c.no} · ${c.label}${c.cell.direction ? ` · ${c.cell.direction}` : r || c.cell.stage === "CLOSED" ? " · no call" : ""}`,
      amount: r ? r.earnings : null,
      status: r ? "FINAL" : "PENDING",
      note: r ? (r.correct ? "Correct: $2,500." : c.cell.direction ? "Wrong: $0." : "No call made: counts as wrong, $0.") : "$2,500 if correct, once judged.",
    });
  }

  let secured = 0;
  let projected = 0;
  let pending = 0;
  for (const l of lines) {
    if (l.amount === null) pending += 1;
    else if (l.status === "FINAL") {
      secured += l.amount;
      projected += l.amount;
    } else projected += l.amount;
  }
  return { lines, secured, projected, pending, final: lines.every((l) => l.status === "FINAL") };
}

/** What settlement pays as cash (the bonuses and call earnings), for the "paid" note. */
export function bonusesPaid(rows: readonly { kind: string; cash_delta_cents: number }[]): number {
  return rows.filter((r) => r.kind === "BONUS_PLAN" || r.kind === "BONUS_DEAL" || r.kind === "CALL_EARNINGS").reduce((s, r) => s + r.cash_delta_cents, 0);
}
