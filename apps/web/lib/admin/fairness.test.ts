import { describe, expect, test } from "vitest";
import {
  callLines,
  decisionLog,
  flagDecisionFromForm,
  flagDetails,
  flagSummary,
  flagViews,
  holdingLines,
  orderLines,
  percentOf,
  resultView,
  type FlagAuditRow,
  type FlagRow,
  type FlagView,
} from "./fairness";
import { ledgerRefs, type CompanyRef, type TeamRef } from "./ledger";
import type { StaffRef } from "./ledger-corrections";

const TEAMS: TeamRef[] = [
  { id: "p1", code: "NP01", track: "PRODUCT", name: "Product 1" },
  { id: "c1", code: "NC01", track: "CONSULTING", name: "Consulting 1" },
  { id: "f1", code: "NF01", track: "FINANCE", name: "Finance 1" },
  { id: "f2", code: "NF02", track: "FINANCE", name: "Finance 2" },
  { id: "f3", code: "NF03", track: "FINANCE", name: "Finance 3" },
];
const COMPANIES: CompanyRef[] = [
  { id: "co1", ticker: "ENA", product_team_id: "p1" },
  { id: "co2", ticker: "ENB", product_team_id: "p2" },
];
const STAFF = new Map<string, StaffRef>([["u-fair", { user_id: "u-fair", display_name: "Fairness officer", role: "FAIRNESS" }]]);
const refs = { teams: new Map(TEAMS.map((t) => [t.id, t])), companies: new Map(COMPANIES.map((c) => [c.id, c])), staff: STAFF };

const flag = (over: Partial<FlagRow>): FlagRow => ({
  id: "x",
  kind: 1,
  company_id: null,
  team_ids: [],
  details: {},
  status: "OPEN",
  decided_by: null,
  decided_at: null,
  reason: null,
  created_at: "2026-10-08T23:31:00Z",
  ...over,
});

// The rows generate_flags writes at settlement.
const F1 = flag({
  id: "a",
  kind: 1,
  company_id: "co1",
  team_ids: ["p1", "f1", "f2", "f3"],
  details: { plan_score: 45, funds_at_cap: 3, ticker: "ENA" },
});
const F2 = flag({ id: "b", kind: 2, team_ids: ["f1", "f2"], details: { cosine: 0.97, orders: [6, 7] } });
const F3 = flag({
  id: "c",
  kind: 3,
  company_id: "co2",
  team_ids: ["p1", "c1", "f1"],
  details: { plan_score: 40, fee_value: 3400000, deal_price: 450, post_crisis_price: 850, ticker: "ENB" },
  status: "DISQUALIFIED",
  decided_by: "u-fair",
  decided_at: "2026-10-08T23:40:00Z",
  reason: "Fee agreed to move money",
});

describe("flags explained", () => {
  test("kind 1: the company, its Product team and the funds at the cap; plan score and how many funds", () => {
    const [v] = flagViews([F1], refs);
    expect(v).toEqual({
      id: "a",
      kind: 1,
      title: "Funds at the cap of a weak company",
      rule: "A company whose plan scored below 50 where 3 or more funds hold the 4,000-share long cap.",
      ticker: "ENA",
      teams: [
        { id: "p1", code: "NP01", track: "Product" },
        { id: "f1", code: "NF01", track: "Finance" },
        { id: "f2", code: "NF02", track: "Finance" },
        { id: "f3", code: "NF03", track: "Finance" },
      ],
      details: [
        { label: "Plan score", value: "45" },
        { label: "Funds at the 4,000-share cap", value: "3" },
      ],
      status: "OPEN",
      decidedBy: null,
      decidedAt: null,
      reason: null,
    });
  });

  test("kind 2: the pair of funds, the cosine and each fund's filled orders; no company", () => {
    const [v] = flagViews([F2], refs);
    expect(v).toMatchObject({ title: "Funds trading alike", ticker: "", teams: [{ code: "NF01" }, { code: "NF02" }] });
    expect(v!.details).toEqual([
      { label: "Cosine similarity", value: "0.970" },
      { label: "Filled orders", value: "NF01: 6 · NF02: 7" },
    ]);
  });

  test("kind 3: the squad's three teams; fee value and deal price against the post-crisis price", () => {
    const [v] = flagViews([F3], refs);
    expect(v).toMatchObject({ title: "Generous rescue terms", ticker: "ENB", status: "DISQUALIFIED", decidedBy: "Fairness officer", reason: "Fee agreed to move money" });
    expect(v!.details).toEqual([
      { label: "Plan score", value: "40" },
      { label: "Fee value", value: "$34,000.00 (≥ $33,000)" },
      { label: "Deal price", value: "$4.50, 52.9% of the post-crisis price $8.50 (≤ 55%)" },
    ]);
    expect(flagDetails(3, { plan_score: 30, fee_value: 3300000, deal_price: null, post_crisis_price: 850 }, [])).toEqual([
      { label: "Plan score", value: "30" },
      { label: "Fee value", value: "$33,000.00 (≥ $33,000)" },
      { label: "Deal price", value: "No deal" },
    ]);
    expect(flagDetails(3, { plan_score: 49, fee_value: null, deal_price: 468, post_crisis_price: 850 }, [])[1]).toEqual({ label: "Fee value", value: "No fee" });
    // Exactly 55% is cheap; just above is not marked.
    expect(flagDetails(3, { deal_price: 440, post_crisis_price: 800 }, [])[1]!.value).toBe("$4.40, 55.0% of the post-crisis price $8.00 (≤ 55%)");
    expect(flagDetails(3, { deal_price: 441, post_crisis_price: 800 }, [])[1]!.value).toBe("$4.41, 55.1% of the post-crisis price $8.00");
  });

  test("open flags first, then by kind; the summary counts each status", () => {
    const views = flagViews([F3, F2, F1], refs);
    expect(views.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(flagSummary([F1, F2, F3])).toBe("3 flags: 2 open, 0 cleared, 1 disqualified.");
    expect(flagSummary([])).toBe("No flags.");
    expect(flagSummary([F3])).toBe("1 flag: 0 open, 0 cleared, 1 disqualified.");
  });

  test("odd stored details do not break the view", () => {
    const [v] = flagViews([flag({ kind: 9, team_ids: ["zz"], details: null })], refs);
    expect(v).toMatchObject({ title: "Flag 9", teams: [{ id: "zz", code: "?", track: "" }], details: [] });
    expect(percentOf(1, 0)).toBe("—");
  });
});

describe("the decision form", () => {
  test("clear or disqualify; the reason goes to the game function as typed", () => {
    expect(flagDecisionFromForm({ decision: "CLEARED", reason: "Coincidence" })).toEqual({ ok: true, value: { status: "CLEARED", reason: "Coincidence" } });
    expect(flagDecisionFromForm({ decision: "DISQUALIFIED", reason: "ab" })).toEqual({ ok: true, value: { status: "DISQUALIFIED", reason: "ab" } });
    expect(flagDecisionFromForm({ decision: "OPEN", reason: "Reopen it" })).toEqual({
      ok: false,
      message: "Choose whether to clear the flag or disqualify the teams involved.",
    });
    expect(flagDecisionFromForm({ decision: null, reason: null }).ok).toBe(false);
    expect(flagDecisionFromForm({ decision: "CLEARED", reason: null })).toEqual({ ok: true, value: { status: "CLEARED", reason: "" } });
  });
});

describe("the decisions log", () => {
  const views = new Map<string, FlagView>(flagViews([F1, F2, F3], refs).map((v) => [v.id, v]));
  const row = (id: number, entity: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, action = "update"): FlagAuditRow => ({
    id,
    at: `2026-10-08T23:${String(30 + id).padStart(2, "0")}:00Z`,
    actor_user_id: "u-fair",
    action,
    entity_id: entity,
    before,
    after,
  });

  test("every change of a decision, newest first, with who, the flag, the decision and the reason", () => {
    const log = decisionLog(
      [
        row(1, "a", null, { status: "OPEN" }, "insert"),
        row(2, "c", { status: "OPEN" }, { status: "CLEARED", reason: "Looks fine", decided_at: "2026-10-08T23:32:00Z", decided_by: "u-fair" }),
        row(3, "c", { status: "CLEARED", reason: "Looks fine" }, { status: "DISQUALIFIED", reason: "Fee agreed to move money", decided_at: "2026-10-08T23:40:00Z" }),
        row(4, "b", { status: "OPEN" }, { status: "CLEARED", reason: "Same news, same trades", decided_at: "2026-10-08T23:35:00Z" }),
        row(5, "c", { status: "DISQUALIFIED", reason: "x", decided_at: "t" }, { status: "DISQUALIFIED", reason: "x", decided_at: "t" }),
        row(6, "a", { status: "OPEN" }, { status: "OPEN", details: {} }),
      ],
      views,
      STAFF,
    );
    expect(log).toEqual([
      { id: "3", at: "2026-10-08T23:40:00Z", who: "Fairness officer", flag: "Flag 3 · ENB", decision: "DISQUALIFIED", reason: "Fee agreed to move money" },
      { id: "4", at: "2026-10-08T23:35:00Z", who: "Fairness officer", flag: "Flag 2 · NF01, NF02", decision: "CLEARED", reason: "Same news, same trades" },
      { id: "2", at: "2026-10-08T23:32:00Z", who: "Fairness officer", flag: "Flag 3 · ENB", decision: "CLEARED", reason: "Looks fine" },
    ]);
  });

  test("an unknown flag or actor is still logged", () => {
    const log = decisionLog([{ ...row(7, "gone", { status: "OPEN" }, { status: "CLEARED", reason: "ok ok" }), actor_user_id: "u-x" }], views, STAFF);
    expect(log).toEqual([{ id: "7", at: "2026-10-08T23:37:00Z", who: "Unknown staff member", flag: "A flag", decision: "CLEARED", reason: "ok ok" }]);
  });
});

describe("team drill-down", () => {
  const r = ledgerRefs(TEAMS, COMPANIES, [
    { id: "r1", number: 1 },
    { id: "r2", number: 2 },
  ]);

  test("holdings by ticker then lot; empty lots are left out", () => {
    expect(
      holdingLines(
        [
          { company_id: "co2", lot: "EXCHANGE", qty: 4000, cost_cents: "4200000" },
          { company_id: "co1", lot: "SHORT", qty: 500, cost_cents: 525000 },
          { company_id: "co1", lot: "SQUAD", qty: 5000, cost_cents: 5000000 },
          { company_id: "co1", lot: "EXCHANGE", qty: 0, cost_cents: 0 },
        ],
        r,
      ),
    ).toEqual([
      { key: "co1|SQUAD", ticker: "ENA", lot: "SQUAD", qty: "5,000", cost: "$50,000.00" },
      { key: "co1|SHORT", ticker: "ENA", lot: "SHORT", qty: "500", cost: "$5,250.00" },
      { key: "co2|EXCHANGE", ticker: "ENB", lot: "EXCHANGE", qty: "4,000", cost: "$42,000.00" },
    ]);
  });

  test("orders by round, then the time they were placed", () => {
    const o = (id: string, round_id: string, created_at: string, over = {}) => ({
      id,
      round_id,
      company_id: "co2",
      type: "BUY",
      qty: 100,
      status: "FILLED",
      entry_price: 1050,
      fill_price: 1060,
      created_at,
      ...over,
    });
    const lines = orderLines(
      [o("z", "r2", "2026-10-08T18:20:00Z"), o("y", "r1", "2026-10-08T18:05:00Z", { status: "CANCELLED", fill_price: null }), o("x", "r1", "2026-10-08T18:01:00Z")],
      r,
    );
    expect(lines.map((l) => [l.id, l.round, l.ticker, l.status, l.entryPrice, l.fillPrice])).toEqual([
      ["x", "1", "ENB", "FILLED", "$10.50", "$10.60"],
      ["y", "1", "ENB", "CANCELLED", "$10.50", ""],
      ["z", "2", "ENB", "FILLED", "$10.50", "$10.60"],
    ]);
  });

  test("consultant calls by window: made or missing, judged or not", () => {
    expect(
      callLines(
        [
          { company_id: "co2", call_no: 2, direction: null, made_at: null, baseline_price: null, judged_price: null, correct: null, earnings_cents: 0 },
          { company_id: "co1", call_no: 1, direction: "BUY", made_at: "t", baseline_price: 1050, judged_price: 1100, correct: true, earnings_cents: "250000" },
          { company_id: "co2", call_no: 1, direction: "SELL", made_at: "t", baseline_price: 1050, judged_price: 1100, correct: false, earnings_cents: 0 },
        ],
        r,
      ).map((c) => [c.callNo, c.ticker, c.direction, c.baseline, c.judged, c.outcome, c.earnings]),
    ).toEqual([
      [1, "ENA", "BUY", "$10.50", "$11.00", "Correct", "$2,500.00"],
      [1, "ENB", "SELL", "$10.50", "$11.00", "Wrong", "$0.00"],
      [2, "ENB", "No call", "", "", "Not judged yet", "$0.00"],
    ]);
  });

  test("the result: value, return and rank; a disqualified team has no rank", () => {
    expect(resultView(null)).toBeNull();
    expect(
      resultView({ track: "FINANCE", final_value_cents: "51234500", start_value_cents: 50000000, return_bp: "247", rank: 2, eligible: true }),
    ).toEqual({ final: "$512,345.00", start: "$500,000.00", returnPct: "+2.47%", rank: "2", eligible: true });
    expect(resultView({ track: "PRODUCT", final_value_cents: 0, start_value_cents: 0, return_bp: null, rank: null, eligible: false })).toMatchObject({
      returnPct: "—",
      rank: "Not ranked (disqualified)",
    });
  });
});
