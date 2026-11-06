import { describe, expect, test } from "vitest";
import {
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
  { id: "p1", code: "NP01", name: "Team 1" },
  { id: "c1", code: "NC01", name: "Team 2" },
  { id: "f1", code: "NF01", name: "Team 3" },
  { id: "f2", code: "NF02", name: "Team 4" },
  { id: "f3", code: "NF03", name: "Team 5" },
];
const COMPANIES: CompanyRef[] = [
  { id: "co1", ticker: "ENAA", founder_team_id: "p1" },
  { id: "co2", ticker: "ENBB", founder_team_id: "c1" },
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
  created_at: "2026-11-21T04:31:00Z",
  ...over,
});

// The rows generate_flags writes at settlement.
const F1 = flag({ id: "a", kind: 1, team_ids: ["p1", "c1"], details: { NP01: { company: "ENBB", bought: 1500 }, NC01: { company: "ENAA", bought: 200 } } });
const F2 = flag({ id: "b", kind: 2, company_id: "co1", team_ids: ["f1"], details: { qty: 4000, cost: 5_200_000, closing_price: 1200, ticker: "ENAA" } });
const F3 = flag({
  id: "c",
  kind: 3,
  company_id: "co2",
  team_ids: ["f1", "f2", "f3", "p1", "NX"],
  details: { round: 3, teams: 5, ticker: "ENBB" },
  status: "DISQUALIFIED",
  decided_by: "u-fair",
  decided_at: "2026-11-21T04:40:00Z",
  reason: "Coordinated",
});

describe("flags explained", () => {
  test("kind 1: the pair of teams and what each bought of the other's company", () => {
    const [v] = flagViews([F1], refs);
    expect(v).toMatchObject({ title: "Reciprocal buying", ticker: "", teams: [{ id: "p1", code: "NP01" }, { id: "c1", code: "NC01" }] });
    expect(v!.details).toEqual([
      { label: "NP01 bought", value: "1,500 shares of ENBB" },
      { label: "NC01 bought", value: "200 shares of ENAA" },
    ]);
  });

  test("kind 2: shares held, average cost, closing price and the loss", () => {
    const [v] = flagViews([F2], refs);
    expect(v).toMatchObject({ title: "Large position closing at a loss", ticker: "ENAA" });
    expect(v!.details).toEqual([
      { label: "Shares held", value: "4,000" },
      { label: "Average cost", value: "$13.00 ($52,000.00 in all)" },
      { label: "Closing price", value: "$12.00" },
      { label: "Loss at the close", value: "−$4,000.00" },
    ]);
  });

  test("kind 3: the round and how many teams reached the limit", () => {
    expect(flagDetails(3, F3.details, [])).toEqual([
      { label: "Round", value: "3" },
      { label: "Teams reaching 5,000 shares", value: "5" },
    ]);
    const [v] = flagViews([F3], refs);
    expect(v).toMatchObject({ ticker: "ENBB", status: "DISQUALIFIED", decidedBy: "Fairness officer", reason: "Coordinated" });
    expect(v!.teams.at(-1)).toEqual({ id: "NX", code: "?" });
  });

  test("open flags first, then by kind; the summary counts each status", () => {
    const views = flagViews([F3, F2, F1], refs);
    expect(views.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(flagSummary([F1, F2, F3])).toBe("3 flags: 2 open, 0 cleared, 1 disqualified.");
    expect(flagSummary([])).toBe("No flags.");
  });

  test("odd stored details do not break the view", () => {
    const [v] = flagViews([flag({ kind: 9, team_ids: ["zz"], details: null })], refs);
    expect(v).toMatchObject({ title: "Flag 9", teams: [{ id: "zz", code: "?" }], details: [] });
    expect(flagDetails(1, { NP01: "nonsense" }, [{ id: "p1", code: "NP01" }])).toEqual([]);
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
      { id: "3", at: "2026-10-08T23:40:00Z", who: "Fairness officer", flag: "Flag 3 · ENBB", decision: "DISQUALIFIED", reason: "Fee agreed to move money" },
      { id: "4", at: "2026-10-08T23:35:00Z", who: "Fairness officer", flag: "Flag 2 · ENAA", decision: "CLEARED", reason: "Same news, same trades" },
      { id: "2", at: "2026-10-08T23:32:00Z", who: "Fairness officer", flag: "Flag 3 · ENBB", decision: "CLEARED", reason: "Looks fine" },
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

  test("holdings by ticker with the average cost; empty positions are left out", () => {
    expect(
      holdingLines(
        [
          { company_id: "co2", qty: 1000, cost_cents: "1085000" },
          { company_id: "co1", qty: 0, cost_cents: 0 },
          { company_id: "co1", qty: 3, cost_cents: 3001 },
        ],
        r,
      ),
    ).toEqual([
      { key: "co1", ticker: "ENAA", qty: "3", cost: "$30.01", average: "$10.00" },
      { key: "co2", ticker: "ENBB", qty: "1,000", cost: "$10,850.00", average: "$10.85" },
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
      ["x", "1", "ENBB", "FILLED", "$10.50", "$10.60"],
      ["y", "1", "ENBB", "CANCELLED", "$10.50", ""],
      ["z", "2", "ENBB", "FILLED", "$10.50", "$10.60"],
    ]);
  });

  test("the result: points per round, total, portfolio, return and rank; a disqualified team has no rank", () => {
    expect(resultView({ r1_points: 78, r2_points: 71, r3_points: 77, portfolio_cents: "11078000", return_bp: "1078", total: 226, rank: 1, eligible: true })).toEqual({
      r1: "78",
      r2: "71",
      r3: "77",
      total: "226",
      portfolio: "$110,780.00",
      returnPct: "+10.78%",
      rank: "1",
      eligible: true,
    });
    expect(resultView({ r1_points: 0, r2_points: 0, r3_points: 0, portfolio_cents: 0, return_bp: -10000, total: 0, rank: null, eligible: false })!.rank).toBe(
      "Not ranked (disqualified)",
    );
    expect(resultView(null)).toBeNull();
  });
});
