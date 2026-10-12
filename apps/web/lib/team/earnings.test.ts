import { describe, expect, test } from "vitest";
import { bonusesPaid, earnings, type EarningsInput } from "./earnings";
import type { CallCell } from "./calls";

const judged = (correct: boolean, direction: "BUY" | "SELL" | null = "BUY"): CallCell => ({
  stage: "JUDGED",
  direction,
  madeAt: null,
  editable: false,
  result: { baseline: 1050, judged: 1125, correct, earnings: correct ? 250_000 : 0 },
});
const open: CallCell = { stage: "OPEN", direction: "SELL", madeAt: null, editable: true, result: null };

const base = (o: Partial<EarningsInput> = {}): EarningsInput => ({
  fee: { stage: "OPEN", proposal: null, executed: null },
  feeShares: 0,
  marketPrice: 1050,
  closingPrice: null,
  marketClosed: false,
  deal: { bonus: "OPEN", stage: "OPEN" },
  plan: null,
  calls: [],
  ...o,
});

describe("a consultant's earnings", () => {
  test("before anything is agreed: the default fee is a projection, the rest is pending", () => {
    const e = earnings(base({ fee: { stage: "BEFORE_CRISIS", proposal: null, executed: null }, deal: { bonus: "OPEN", stage: "BEFORE_CRISIS" } }));
    expect(e.lines.map((l) => [l.key, l.amount, l.status])).toEqual([
      ["fee-cash", 2_250_000, "PROJECTION"],
      ["deal-bonus", null, "PENDING"],
      ["plan-bonus", null, "PENDING"],
    ]);
    expect(e).toMatchObject({ secured: 0, projected: 2_250_000, pending: 2, final: false });
    expect(e.lines[0]!.note).toMatch(/after the crisis, until 01:05/);
  });

  test("a proposal on the table is a projection, its shares at today's price", () => {
    const e = earnings(base({ fee: { stage: "OPEN", proposal: { cash: 2_000_000, shares: 1000, value: 3_050_000, version: 2, by: "CONSULTING", at: "" }, executed: null } }));
    expect(e.lines.slice(0, 2).map((l) => [l.label, l.amount, l.status])).toEqual([
      ["Proposed fee: cash", 2_000_000, "PROJECTION"],
      ["Proposed fee shares: 1,000 × current price", 1_050_000, "PROJECTION"],
    ]);
  });

  test("Northline at the close: $20,000 + 1,000 shares at $12.63, deal bonus, plan 88, four correct calls = $66,630", () => {
    const e = earnings(
      base({
        fee: { stage: "AGREED", proposal: null, executed: { cash: 2_000_000, shares: 1000, value: 3_050_000, at: "", isDefault: false } },
        feeShares: 1000,
        marketPrice: 1420,
        closingPrice: 1263,
        marketClosed: true,
        deal: { bonus: "YES", stage: "SIGNED" },
        plan: { final_score: 88, capped: false, late: false, missing: false, penalty: 0 },
        calls: [
          { label: "AQS", no: 1, cell: judged(true) },
          { label: "SNAP", no: 1, cell: judged(true) },
          { label: "AQS", no: 2, cell: judged(true) },
          { label: "SNAP", no: 2, cell: judged(true) },
          { label: "AQS", no: 3, cell: judged(false) },
          { label: "SNAP", no: 3, cell: judged(false, null) },
        ],
      }),
    );
    expect(e.lines.find((l) => l.key === "fee-shares")).toMatchObject({ amount: 1_263_000, status: "FINAL", label: "Fee shares: 1,000 × closing price" });
    expect(e.lines.find((l) => l.key === "plan-bonus")).toMatchObject({ amount: 1_900_000, status: "FINAL", label: "Plan bonus: plan score 88" });
    expect(e.lines.find((l) => l.key === "deal-bonus")).toMatchObject({ amount: 500_000, status: "FINAL" });
    expect(e.lines.filter((l) => l.key.startsWith("call-")).map((l) => l.amount)).toEqual([250_000, 250_000, 250_000, 250_000, 0, 0]);
    expect(e.lines.at(-1)!.note).toBe("No call made: counts as wrong, $0.");
    // Acceptance 4: Northline (with 4 correct calls) = $66,630.
    expect(e).toMatchObject({ secured: 6_663_000, projected: 6_663_000, pending: 0, final: true });
  });

  test("before the close, fee shares are a projection at the market price; a capped or missing plan is explained", () => {
    const e = earnings(
      base({
        fee: { stage: "DEFAULT", proposal: null, executed: { cash: 2_250_000, shares: 0, value: 2_250_000, at: "", isDefault: true } },
        deal: { bonus: "NO", stage: "CLOSED" },
        plan: { final_score: 50, capped: true, late: false, missing: false, penalty: 0 },
        calls: [{ label: "AQS", no: 1, cell: open }],
      }),
    );
    expect(e.lines.map((l) => [l.key, l.amount, l.status])).toEqual([
      ["fee-cash", 2_250_000, "FINAL"],
      ["deal-bonus", 0, "FINAL"],
      ["plan-bonus", 0, "FINAL"],
      ["call-1-AQS", null, "PENDING"],
    ]);
    expect(e.lines[0]!.label).toBe("Default fee (cash)");
    expect(e.lines[2]!.note).toMatch(/capped at 50/);
    expect(e).toMatchObject({ secured: 2_250_000, pending: 1, final: false });
    const shares = earnings(base({ fee: { stage: "AGREED", proposal: null, executed: { cash: 0, shares: 3000, value: 3_150_000, at: "", isDefault: false } }, feeShares: 3000, marketPrice: 893 }));
    expect(shares.lines[1]).toMatchObject({ amount: 2_679_000, status: "PROJECTION", label: "Fee shares: 3,000 × current price" });
    const missing = earnings(base({ plan: { final_score: 0, capped: false, late: false, missing: true, penalty: 0 } }));
    expect(missing.lines.find((l) => l.key === "plan-bonus")).toMatchObject({ amount: -1_000_000, note: expect.stringMatching(/no plan submitted on time/) });
  });

  test("after the fee deadline with nothing agreed, the default is what will be paid, not the proposal", () => {
    const proposal = { cash: 2_000_000, shares: 1000, value: 3_050_000, version: 2, by: "CONSULTING" as const, at: "" };
    const e = earnings(base({ fee: { stage: "DEFAULT_PENDING", proposal, executed: null }, times: { fee: "01:05" } }));
    expect(e.lines[0]).toMatchObject({ label: "Default fee (cash)", amount: 2_250_000, status: "PROJECTION", note: expect.stringContaining("by 01:05") });
    expect(e.lines.some((l) => l.key === "fee-shares")).toBe(false);
  });

  test("a call not made yet is not called missing until its window closes", () => {
    const cell = (stage: CallCell["stage"]): CallCell => ({ stage, direction: null, madeAt: null, editable: false, result: null });
    const e = earnings(base({ calls: [{ label: "AQS", no: 2, cell: cell("NOT_OPEN") }, { label: "SNAP", no: 2, cell: cell("CLOSED") }] }));
    expect(e.lines.slice(-2).map((l) => l.label)).toEqual(["Call 2 · AQS", "Call 2 · SNAP · no call"]);
  });

  test("what settlement paid in cash", () => {
    expect(
      bonusesPaid([
        { kind: "BONUS_PLAN", cash_delta_cents: 1_900_000 },
        { kind: "BONUS_DEAL", cash_delta_cents: 500_000 },
        { kind: "CALL_EARNINGS", cash_delta_cents: 1_000_000 },
        { kind: "FEE", cash_delta_cents: 2_000_000 },
      ]),
    ).toBe(3_400_000);
  });
});
