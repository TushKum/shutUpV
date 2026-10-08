import { describe, expect, test } from "vitest";
import {
  correctionEntryLines,
  correctionFromForm,
  correctionOptions,
  correctionViews,
  readCorrectionForm,
  type CorrectionForm,
  type CorrectionRow,
  type StaffRef,
} from "./ledger-corrections";
import type { CompanyRef, TeamRef } from "./ledger";

const TEAMS: TeamRef[] = [
  { id: "f2", code: "MF02", track: "FINANCE", name: "Finance 2" },
  { id: "p1", code: "MP01", track: "PRODUCT", name: "Product 1" },
  { id: "c1", code: "MC01", track: "CONSULTING", name: "Consulting 1" },
  { id: "f1", code: "MF01", track: "FINANCE", name: "Finance 1" },
];
const COMPANIES: (CompanyRef & { squad_id: string | null })[] = [
  { id: "co2", ticker: "EMB", product_team_id: "p2", squad_id: "s2" },
  { id: "co1", ticker: "EMA", product_team_id: "p1", squad_id: "s1" },
  { id: "co9", ticker: null, product_team_id: "p1", squad_id: null },
];
const teams = new Map(TEAMS.map((t) => [t.id, t]));
const companies = new Map(COMPANIES.map((c) => [c.id, c]));

const form = (rows: Partial<Record<"team" | "company" | "lot" | "cash" | "shares", string>>[], reason = "Refund a fee charged twice"): CorrectionForm => ({
  reason,
  team: rows.map((r) => r.team ?? ""),
  company: rows.map((r) => r.company ?? ""),
  lot: rows.map((r) => r.lot ?? ""),
  cash: rows.map((r) => r.cash ?? ""),
  shares: rows.map((r) => r.shares ?? ""),
});

describe("the request form → request_correction's entries", () => {
  test("dollars become exact integer cents; empty fields and blank rows are left out", () => {
    const r = correctionFromForm(
      form([
        { team: "f1", cash: "12.34" },
        {},
        { team: "f2", company: "co1", lot: "EXCHANGE", cash: "-0.5", shares: "-100" },
        { team: "c1", company: "co2", cash: "$1,000" },
      ]),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        reason: "Refund a fee charged twice",
        entries: [
          { team_id: "f1", cash_delta_cents: 1234 },
          { team_id: "f2", company_id: "co1", lot: "EXCHANGE", cash_delta_cents: -50, share_delta: -100 },
          { team_id: "c1", company_id: "co2", cash_delta_cents: 100000 },
        ],
      },
    });
  });

  test("the reason is trimmed and needs 10 characters", () => {
    expect(correctionFromForm(form([{ team: "f1", cash: "1" }], "   too short   "))).toEqual({ ok: false, message: "Give a reason of at least 10 characters." });
    expect(correctionFromForm(form([{ team: "f1", cash: "1" }], "  ten chars!  "))).toMatchObject({ ok: true, value: { reason: "ten chars!" } });
  });

  test("each refusal names the entry", () => {
    expect(correctionFromForm(form([{ team: "f1", cash: "1.234" }]))).toEqual({
      ok: false,
      message: "Entry 1: cash change “1.234” has more than 2 decimals; amounts are in whole cents.",
    });
    expect(correctionFromForm(form([{ team: "f1", cash: "1" }, { cash: "5" }]))).toEqual({ ok: false, message: "Entry 2: choose a team." });
    expect(correctionFromForm(form([{ team: "f1", cash: "abc" }])).ok).toBe(false);
    expect(correctionFromForm(form([{ team: "f1", company: "co1", lot: "SQUAD", shares: "2.5" }]))).toEqual({
      ok: false,
      message: "Entry 1: share change “2.5” is not a whole number of shares.",
    });
    expect(correctionFromForm(form([{ team: "f1", cash: "0", shares: "" }]))).toEqual({ ok: false, message: "Entry 1: enter a cash change or a share change." });
    expect(correctionFromForm(form([{ team: "f1", lot: "EXCHANGE", shares: "10" }]))).toEqual({
      ok: false,
      message: "Entry 1: a share change needs a company and a lot.",
    });
    expect(correctionFromForm(form([{ team: "f1", company: "co1", shares: "10" }]))).toMatchObject({ ok: false });
    expect(correctionFromForm(form([{ team: "f1", company: "co1", lot: "BOGUS", shares: "10" }]))).toEqual({ ok: false, message: "Entry 1: unknown lot BOGUS." });
  });

  test("at least one entry, at most 50", () => {
    expect(correctionFromForm(form([{}, {}]))).toEqual({ ok: false, message: "Add at least one entry: a team and a cash or share change." });
    expect(correctionFromForm(form(Array.from({ length: 51 }, () => ({ team: "f1", cash: "1" }))))).toEqual({
      ok: false,
      message: "A correction has at most 50 entries.",
    });
  });

  test("reads the rows from FormData in their order", () => {
    const fd = new FormData();
    fd.set("reason", "A reason long enough");
    for (const [team, company, lot, cash, shares] of [
      ["f1", "", "", "3", ""],
      ["f2", "co1", "EXCHANGE", "", "10"],
    ]) {
      fd.append("entry_team", team!);
      fd.append("entry_company", company!);
      fd.append("entry_lot", lot!);
      fd.append("entry_cash", cash!);
      fd.append("entry_shares", shares!);
    }
    expect(readCorrectionForm(fd)).toEqual({
      reason: "A reason long enough",
      team: ["f1", "f2"],
      company: ["", "co1"],
      lot: ["", "EXCHANGE"],
      cash: ["3", ""],
      shares: ["", "10"],
    });
    expect(readCorrectionForm(new FormData())).toEqual({ reason: "", team: [], company: [], lot: [], cash: [], shares: [] });
  });
});

describe("stored corrections", () => {
  const staff = new Map<string, StaffRef>([
    ["u-lead", { user_id: "u-lead", display_name: "Event lead", role: "ORGANISER" }],
    ["u-second", { user_id: "u-second", display_name: "Exchange desk", role: "ORGANISER" }],
    ["u-fair", { user_id: "u-fair", display_name: "Fairness officer", role: "FAIRNESS" }],
  ]);
  const base: Omit<CorrectionRow, "id" | "status" | "requested_at"> = {
    requested_by: "u-lead",
    reason: "Refund a fee charged twice",
    entries: [{ team_id: "f1", cash_delta_cents: 1234 }],
    decided_by: null,
    decided_at: null,
    decision_note: null,
    applied_txn_id: null,
  };
  const ROWS: CorrectionRow[] = [
    { ...base, id: "a", status: "PENDING", requested_at: "2026-10-08T18:10:00Z" },
    { ...base, id: "b", status: "PENDING", requested_at: "2026-10-08T18:00:00Z", requested_by: "u-second" },
    {
      ...base,
      id: "c",
      status: "APPROVED",
      requested_at: "2026-10-08T17:00:00Z",
      decided_by: "u-second",
      decided_at: "2026-10-08T17:05:00Z",
      applied_txn_id: "a97837aa-c323-4ae9-afe6-441e845c05a1",
    },
    { ...base, id: "d", status: "REJECTED", requested_at: "2026-10-08T17:10:00Z", decided_by: "u-fair", decided_at: "2026-10-08T17:20:00Z", decision_note: "Wrong team" },
  ];

  test("entry lines: team code, ticker, lot, signed cash and shares", () => {
    expect(
      correctionEntryLines(
        [
          { team_id: "f1", cash_delta_cents: 1234 },
          { team_id: "f2", company_id: "co1", lot: "EXCHANGE", cash_delta_cents: "-50", share_delta: -100 },
          { team_id: "zz", company_id: "co9" },
          "garbage",
        ],
        teams,
        companies,
      ),
    ).toEqual([
      { party: "MF01", ticker: "", lot: "", cash: "+$12.34", cashSign: 1, shares: "" },
      { party: "MF02", ticker: "EMA", lot: "EXCHANGE", cash: "−$0.50", cashSign: -1, shares: "−100" },
      { party: "?", ticker: "MP01’s company", lot: "", cash: "", cashSign: 0, shares: "" },
      { party: "?", ticker: "", lot: "", cash: "", cashSign: 0, shares: "" },
    ]);
    expect(correctionEntryLines(null, teams, companies)).toEqual([]);
  });

  test("the requester cannot decide their own; another organiser or the fairness officer can", () => {
    const lead = correctionViews(ROWS, { teams, companies, staff, viewer: { userId: "u-lead", role: "ORGANISER" } });
    expect(lead.pending.map((v) => [v.id, v.requestedBy, v.canDecide, v.whyNot])).toEqual([
      ["b", "Exchange desk", true, null],
      ["a", "Event lead", false, "You requested this correction. A second organiser or the fairness officer must approve or reject it."],
    ]);
    const fair = correctionViews(ROWS, { teams, companies, staff, viewer: { userId: "u-fair", role: "FAIRNESS" } });
    expect(fair.pending.every((v) => v.canDecide)).toBe(true);
    const display = correctionViews(ROWS, { teams, companies, staff, viewer: { userId: "u-x", role: "DISPLAY" } });
    expect(display.pending[0]).toMatchObject({ canDecide: false, whyNot: "Only an organiser or the fairness officer can decide a correction." });
  });

  test("the history: newest decision first, who decided, the note and the applied transaction", () => {
    const { decided } = correctionViews(ROWS, { teams, companies, staff, viewer: { userId: "u-lead", role: "ORGANISER" } });
    expect(decided.map((v) => [v.id, v.status, v.decidedBy, v.note, v.txn, v.canDecide, v.whyNot])).toEqual([
      ["d", "REJECTED", "Fairness officer", "Wrong team", null, false, null],
      ["c", "APPROVED", "Exchange desk", null, "a97837aa", false, null],
    ]);
    expect(decided[1]!.entries).toEqual([{ party: "MF01", ticker: "", lot: "", cash: "+$12.34", cashSign: 1, shares: "" }]);
  });

  test("an account that is gone is still shown", () => {
    const { pending } = correctionViews([{ ...ROWS[0]!, requested_by: "u-gone" }], { teams, companies, staff, viewer: { userId: "u-lead", role: "ORGANISER" } });
    expect(pending[0]!.requestedBy).toBe("Unknown staff member");
  });
});

describe("form options", () => {
  test("teams by track and code; only companies of a squad, by ticker", () => {
    const o = correctionOptions(TEAMS, COMPANIES);
    expect(o.tracks).toEqual([
      { track: "PRODUCT", teams: [{ id: "p1", code: "MP01" }] },
      { track: "CONSULTING", teams: [{ id: "c1", code: "MC01" }] },
      { track: "FINANCE", teams: [{ id: "f1", code: "MF01" }, { id: "f2", code: "MF02" }] },
    ]);
    expect(o.companies).toEqual([
      { id: "co1", label: "EMA" },
      { id: "co2", label: "EMB" },
    ]);
    expect(o.lots).toEqual(["RETAINED", "SQUAD", "EXCHANGE", "SHORT", "FEE"]);
  });
});
