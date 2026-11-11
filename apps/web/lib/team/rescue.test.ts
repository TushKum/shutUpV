import { describe, expect, test } from "vitest";
import {
  dealBalanceWarning,
  dealPreview,
  dealTermsText,
  dealView,
  deadlineState,
  dollarsText,
  dueState,
  feePreview,
  feeTermsText,
  feeView,
  rescueTimeline,
  roleOf,
  teamLabel,
  upperFirst,
  type DealInput,
  type DealRow,
  type FeeInput,
  type FeeRow,
} from "./rescue";

const T = (iso: string) => Date.parse(iso);
const running = { paused: false, pausedAt: null };
const squad = { product_team_id: "p", consulting_team_id: "c", finance_team_id: "f" };
// IST = UTC+5:30: 00:30 IST is 19:00Z the evening before, 01:05 IST 19:35Z, 02:45 IST 21:15Z, 03:00 IST 21:30Z.
const FEE_AT = "2026-10-10T19:35:00.000Z";
const BONUS_AT = "2026-10-10T21:15:00.000Z";
const DEAL_AT = "2026-10-10T21:30:00.000Z";
const deadlines = { FEE: FEE_AT, DEAL_BONUS: BONUS_AT, DEAL: DEAL_AT, PLAN: DEAL_AT };

describe("deadlines and teams", () => {
  test("a deadline passes strictly after its time; a pause freezes a deadline after it began", () => {
    expect(deadlineState(FEE_AT, T(FEE_AT), running)).toBe("OPEN");
    expect(deadlineState(FEE_AT, T(FEE_AT) + 1, running)).toBe("PASSED");
    expect(deadlineState(FEE_AT, T(FEE_AT) + 60_000, { paused: true, pausedAt: "2026-10-10T19:30:00.000Z" })).toBe("PAUSED");
    expect(deadlineState(FEE_AT, T(FEE_AT) + 60_000, { paused: true, pausedAt: "2026-10-10T19:40:00.000Z" })).toBe("PASSED");
    expect(deadlineState(null, 0, running)).toBe("NONE");
  });

  test("a settled matter shows no countdown, before or after its time", () => {
    expect(dueState(FEE_AT, T(FEE_AT) - 60_000, running, false)).toBe("OPEN");
    expect(dueState(FEE_AT, T(FEE_AT) - 60_000, running, true)).toBe("CLOSED");
    expect(dueState(FEE_AT, T(FEE_AT) + 60_000, running, true)).toBe("CLOSED");
    expect(dueState(FEE_AT, T(FEE_AT) + 60_000, running, false)).toBe("PASSED");
    expect(dueState(null, 0, running, true)).toBe("NONE");
  });

  test("teams are named by their role, never by code", () => {
    expect(roleOf(squad, "c")).toBe("CONSULTING");
    expect(roleOf(squad, "x")).toBeNull();
    expect(teamLabel("CONSULTING", "CONSULTING")).toBe("your team");
    expect(teamLabel("PRODUCT", "CONSULTING")).toBe("the Product team");
    expect(teamLabel(null, "PRODUCT")).toBe("—");
    expect(upperFirst(teamLabel("FINANCE", "PRODUCT"))).toBe("The fund (Finance)");
  });

  test("the rescue timeline lists the fee, the deal bonus and the deal deadline at the event's own times", () => {
    expect(rescueTimeline(deadlines).map((t) => [t.code, t.at])).toEqual([
      ["FEE", FEE_AT],
      ["DEAL_BONUS", BONUS_AT],
      ["DEAL", DEAL_AT],
    ]);
    expect(rescueTimeline({ FEE: FEE_AT }).map((t) => t.code)).toEqual(["FEE"]);
  });
});

const feeRow = (o: Partial<FeeRow> = {}): FeeRow => ({
  cash_cents: "0",
  shares: 0,
  value_cents: "0",
  version: 1,
  product_confirmed_at: null,
  consulting_confirmed_at: null,
  executed_at: null,
  is_default: false,
  updated_at: "2026-10-10T19:01:00.000Z",
  updated_by_team: null,
  ...o,
});
const feeIn = (o: Partial<FeeInput> = {}): FeeInput => ({
  ...running,
  phase: "CRISIS",
  crisisApplied: true,
  nowMs: T("2026-10-10T19:10:00.000Z"),
  deadline: FEE_AT,
  track: "PRODUCT",
  squad,
  fee: feeRow(),
  ...o,
});

describe("the advisor's fee (fee_window_open, confirm_fee)", () => {
  test("before the crisis nobody can propose; after it, Product and Consulting can, the fund only sees it", () => {
    expect(feeView(feeIn({ phase: "ROUNDS_1_4", crisisApplied: false })).stage).toBe("BEFORE_CRISIS");
    expect(feeView(feeIn({ phase: "ROUNDS_1_4", crisisApplied: false })).canPropose).toBe(false);
    const p = feeView(feeIn());
    expect(p).toMatchObject({ stage: "OPEN", party: true, canPropose: true, canConfirm: false, proposal: null });
    expect(feeView(feeIn({ track: "CONSULTING" })).canPropose).toBe(true);
    expect(feeView(feeIn({ track: "FINANCE" }))).toMatchObject({ stage: "OPEN", party: false, canPropose: false, canConfirm: false });
  });

  test("a proposal (AquaSense: $20,000 + 1,000 shares = $30,500) is confirmed by each team once; the other is waited for", () => {
    const fee = feeRow({ cash_cents: "2000000", shares: 1000, value_cents: "3050000", version: 2, updated_by_team: "c" });
    const v = feeView(feeIn({ fee }));
    expect(v.proposal).toMatchObject({ cash: 2_000_000, shares: 1000, value: 3_050_000, version: 2, by: "CONSULTING" });
    expect(v.canConfirm).toBe(true);
    expect(v.waitingFor).toBeNull();
    const half = feeRow({ ...fee, product_confirmed_at: "2026-10-10T19:12:00.000Z" });
    expect(feeView(feeIn({ fee: half }))).toMatchObject({ canConfirm: false, mine: "2026-10-10T19:12:00.000Z", waitingFor: "CONSULTING" });
    expect(feeView(feeIn({ fee: half, track: "CONSULTING" }))).toMatchObject({ canConfirm: true, mine: null, waitingFor: "CONSULTING" });
  });

  test("after 01:05 with nothing paid the default is due; once paid, agreed or default is shown", () => {
    const late = feeIn({ nowMs: T(FEE_AT) + 1000 });
    expect(feeView(late)).toMatchObject({ stage: "DEFAULT_PENDING", canPropose: false, canConfirm: false });
    // Paused before 01:05: the deadline has not passed.
    expect(feeView({ ...late, paused: true, pausedAt: "2026-10-10T19:30:00.000Z" }).stage).toBe("OPEN");
    const agreed = feeView(feeIn({ fee: feeRow({ cash_cents: "2000000", shares: 1000, value_cents: "3050000", executed_at: "2026-10-10T19:20:00.000Z" }) }));
    expect(agreed).toMatchObject({ stage: "AGREED", proposal: null, canPropose: false, executed: { cash: 2_000_000, shares: 1000, value: 3_050_000, isDefault: false } });
    const dflt = feeView(feeIn({ nowMs: T(FEE_AT) + 5000, fee: feeRow({ cash_cents: "2250000", value_cents: "2250000", is_default: true, executed_at: FEE_AT }) }));
    expect(dflt).toMatchObject({ stage: "DEFAULT", executed: { cash: 2_250_000, shares: 0, isDefault: true } });
  });

  test("the live check: value = cash + shares × IPO price, the engine's limits, in exact cents", () => {
    const ctx = { ipoPrice: 1050, companyCash: 5_000_000, retained: 60_000 };
    expect(feePreview({ cash: "", shares: "" }, ctx)).toEqual({ state: "EMPTY" });
    expect(feePreview({ cash: "20,000", shares: "1000" }, ctx)).toEqual({ state: "OK", cash: 2_000_000, shares: 1000, value: 3_050_000, warning: null });
    expect(feePreview({ cash: "$22500.00", shares: "" }, ctx)).toMatchObject({ state: "OK", value: 2_250_000 });
    expect(feePreview({ cash: "", shares: "3000" }, ctx)).toMatchObject({ state: "OK", cash: 0, value: 3_150_000 });
    expect(feePreview({ cash: "30000", shares: "1000" }, ctx)).toEqual({ state: "INVALID", message: "The fee must be worth $10,000 to $35,000 (shares at the IPO price).", value: 4_050_000 });
    expect(feePreview({ cash: "9999.99", shares: "" }, ctx)).toMatchObject({ state: "INVALID", value: 999_999 });
    expect(feePreview({ cash: "", shares: "3001" }, ctx)).toMatchObject({ state: "INVALID", message: "At most 3,000 shares can be part of the fee." });
    expect(feePreview({ cash: "10000.005", shares: "" }, ctx)).toMatchObject({ state: "INVALID", message: expect.stringMatching(/^Cash: .*more than 2 decimals/) });
    expect(feePreview({ cash: "", shares: "10.5" }, ctx)).toMatchObject({ state: "INVALID", message: expect.stringMatching(/^Shares: .*whole number/) });
    expect(feePreview({ cash: "-100", shares: "1000" }, ctx)).toMatchObject({ state: "INVALID", message: "Cash and shares must be whole, non-negative amounts.", value: null });
  });

  test("the Product team's own cash and shares are checked; for Consulting the database checks them", () => {
    expect(feePreview({ cash: "30000", shares: "" }, { ipoPrice: 1050, companyCash: 2_500_000, retained: 60_000 })).toMatchObject({
      state: "INVALID",
      message: "The company does not have that much cash. It has $25,000.00.",
    });
    expect(feePreview({ cash: "", shares: "2000" }, { ipoPrice: 1050, companyCash: 0, retained: 1500 })).toMatchObject({
      state: "INVALID",
      message: "The company does not hold that many shares. It holds 1,500 shares.",
    });
    expect(feePreview({ cash: "30000", shares: "" }, { ipoPrice: 1050, companyCash: null, retained: null })).toMatchObject({ state: "OK", value: 3_000_000 });
  });

  test("terms are named exactly", () => {
    expect(feeTermsText({ cash: 2_000_000, shares: 1000, value: 3_050_000 })).toBe("$20,000.00 cash + 1,000 shares (value $30,500.00)");
    expect(feeTermsText({ cash: 0, shares: 3000, value: 3_150_000 })).toBe("3,000 shares (value $31,500.00)");
    expect(feeTermsText({ cash: 2_250_000, shares: 0, value: 2_250_000 })).toBe("$22,500.00 cash (value $22,500.00)");
  });
});

const dealRow = (o: Partial<DealRow> = {}): DealRow => ({
  amount_cents: null,
  price_cents: null,
  shares: null,
  cash_moved_cents: null,
  version: 1,
  signed_product_at: null,
  signed_consulting_at: null,
  signed_finance_at: null,
  executed_at: null,
  updated_at: "2026-10-10T19:00:00.000Z",
  updated_by_team: null,
  ...o,
});
const dealIn = (o: Partial<DealInput> = {}): DealInput => ({
  ...running,
  phase: "RESCUE_2",
  crisisApplied: true,
  nowMs: T("2026-10-10T20:40:00.000Z"),
  deadlines,
  track: "CONSULTING",
  squad,
  deal: dealRow(),
  postCrisis: 956,
  ...o,
});

describe("the rescue deal (deal_window_open, edit_deal, sign_deal)", () => {
  test("AquaSense: band $4.78–$9.56; Consulting sets the price, the fund the amount, everyone signs complete terms", () => {
    const empty = dealView(dealIn());
    expect(empty).toMatchObject({ stage: "OPEN", band: { min: 478, max: 956 }, complete: false, canEditPrice: true, canEditAmount: false, canSign: false });
    expect(dealView(dealIn({ track: "FINANCE" }))).toMatchObject({ canEditPrice: false, canEditAmount: true });
    expect(dealView(dealIn({ track: "PRODUCT" }))).toMatchObject({ canEditPrice: false, canEditAmount: false, canSign: false });
    const deal = dealRow({ amount_cents: "6000000", price_cents: 750, shares: 8000, cash_moved_cents: "6000000", version: 3, updated_by_team: "c", updated_at: "2026-10-10T20:30:00.000Z" });
    const v = dealView(dealIn({ track: "PRODUCT", deal }));
    expect(v).toMatchObject({ amount: 6_000_000, price: 750, shares: 8000, cashMoved: 6_000_000, version: 3, complete: true, canSign: true, editedBy: "CONSULTING" });
    expect(v.unsigned).toEqual(["PRODUCT", "CONSULTING", "FINANCE"]);
    const signed = dealView(dealIn({ track: "PRODUCT", deal: { ...deal, signed_product_at: "2026-10-10T20:31:00.000Z" } }));
    expect(signed).toMatchObject({ canSign: false, mine: "2026-10-10T20:31:00.000Z", unsigned: ["CONSULTING", "FINANCE"] });
  });

  test("the bonus is earned when fully signed by 02:45; the plan is capped when not fully signed at 03:00", () => {
    const at = (iso: string) => dealRow({ amount_cents: "6000000", price_cents: 750, executed_at: iso });
    expect(dealView(dealIn({ deal: at(BONUS_AT) }))).toMatchObject({ stage: "SIGNED", bonus: "YES", capped: "NO", canSign: false, canEditPrice: false });
    expect(dealView(dealIn({ deal: at("2026-10-10T21:20:00.000Z") }))).toMatchObject({ bonus: "NO", capped: "NO" });
    // Not signed yet: the bonus is still possible before 02:45, lost after; the cap is decided at 03:00.
    expect(dealView(dealIn())).toMatchObject({ bonus: "OPEN", capped: "OPEN" });
    expect(dealView(dealIn({ nowMs: T(BONUS_AT) + 1 }))).toMatchObject({ stage: "OPEN", bonus: "NO", capped: "OPEN" });
    expect(dealView(dealIn({ nowMs: T(DEAL_AT) + 1 }))).toMatchObject({ stage: "CLOSED", bonus: "NO", capped: "YES", canSign: false });
    // Plans published early: the window closes whatever the clock says.
    expect(dealView(dealIn({ phase: "PLANS_PUBLISHED" }))).toMatchObject({ stage: "CLOSED", capped: "YES" });
    expect(dealView(dealIn({ phase: "ROUNDS_1_4", crisisApplied: false }))).toMatchObject({ stage: "BEFORE_CRISIS", bonus: "OPEN", capped: "OPEN", band: { min: 478 } });
  });

  test("the price preview: inside the band, with the shares and the cash moved once the amount is known", () => {
    const base = { track: "CONSULTING" as const, amount: null, price: null, postCrisis: 956 };
    expect(dealPreview({ ...base, text: "" })).toEqual({ state: "EMPTY" });
    expect(dealPreview({ ...base, text: "7.50" })).toEqual({ state: "OK", amount: null, price: 750, shares: null, cashMoved: null, warning: null });
    expect(dealPreview({ ...base, text: "4.77" })).toMatchObject({ state: "INVALID", message: "The price must be 50%–100% of the post-crisis price $9.56: $4.78 to $9.56." });
    expect(dealPreview({ ...base, text: "9.57" })).toMatchObject({ state: "INVALID" });
    expect(dealPreview({ ...base, text: "0" })).toMatchObject({ state: "INVALID", message: "Price: enter an amount above $0." });
    expect(dealPreview({ ...base, text: "7.505" })).toMatchObject({ state: "INVALID", message: expect.stringMatching(/^Price: /) });
    expect(dealPreview({ ...base, amount: 6_000_000, text: "7.50" })).toEqual({ state: "OK", amount: 6_000_000, price: 750, shares: 8000, cashMoved: 6_000_000, warning: null });
    // floor(amount ÷ price); cash moved = shares × price.
    expect(dealPreview({ ...base, amount: 6_500_000, text: "6.50" })).toMatchObject({ shares: 10_000, cashMoved: 6_500_000 });
    expect(dealPreview({ ...base, amount: 4_200_000, text: "7.00", postCrisis: 900 })).toMatchObject({ shares: 6000, cashMoved: 4_200_000 });
    expect(dealPreview({ ...base, amount: 4_000_000, text: "6.99", postCrisis: 900 })).toMatchObject({ shares: 5722, cashMoved: 3_999_678 });
  });

  test("the amount preview: $40,000–$80,000, and a warning when the fund could not pay", () => {
    const base = { track: "FINANCE" as const, amount: null, price: 750, postCrisis: 956 };
    expect(dealPreview({ ...base, text: "39,999.99" })).toMatchObject({ state: "INVALID", message: "The rescue amount must be $40,000 to $80,000." });
    expect(dealPreview({ ...base, text: "80000.01" })).toMatchObject({ state: "INVALID" });
    expect(dealPreview({ ...base, text: "60000", fundAvailable: 10_000_000 })).toMatchObject({ state: "OK", shares: 8000, cashMoved: 6_000_000, warning: null });
    expect(dealPreview({ ...base, text: "60000", fundAvailable: 5_000_000 })).toMatchObject({ state: "OK", warning: expect.stringContaining("$50,000.00") });
    expect(dealPreview({ ...base, price: null, text: "60000" })).toMatchObject({ state: "OK", amount: 6_000_000, shares: null });
  });

  test("balance warnings by the signing buttons, and the terms named exactly", () => {
    const v = { complete: true, shares: 8000, cashMoved: 6_000_000 };
    expect(dealBalanceWarning(v, { track: "FINANCE", fundAvailable: 6_000_000, retained: null })).toBeNull();
    expect(dealBalanceWarning(v, { track: "FINANCE", fundAvailable: 5_999_999, retained: null })).toMatch(/would be refused/);
    expect(dealBalanceWarning(v, { track: "PRODUCT", fundAvailable: null, retained: 7999 })).toMatch(/7,999 retained shares/);
    expect(dealBalanceWarning(v, { track: "CONSULTING", fundAvailable: null, retained: null })).toBeNull();
    expect(dealBalanceWarning({ ...v, complete: false }, { track: "FINANCE", fundAvailable: 0, retained: null })).toBeNull();
    expect(dealTermsText({ shares: 8000, price: 750, cashMoved: 6_000_000 })).toBe("8,000 shares at $7.50 ($60,000.00)");
    expect(dealTermsText({ shares: null, price: 750, cashMoved: null })).toBe("incomplete terms");
    expect([dollarsText(750), dollarsText(6_000_000), dollarsText(5), dollarsText(0)]).toEqual(["7.50", "60000.00", "0.05", "0.00"]);
  });
});
