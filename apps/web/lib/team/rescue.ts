// The rescue after the 00:30 crisis, as the squad's three teams see it: what happens at the crisis, the advisor's fee
// (proposed and confirmed by the Product and Consulting teams, or the default $22,500 cash at 01:05) and the rescue
// deal (Consulting proposes the price, the fund sets the amount, all three teams sign). Pure: the pages read the rows
// through RLS and these functions say what each team may do now and preview the terms with the engine's rules, so the
// page agrees with the database. The database decides: propose_fee, confirm_fee, edit_deal and sign_deal check the
// caller, the window, the deadline and every rule again.

import {
  RULES,
  dealBonusEarned,
  dealPriceBand,
  dealShares,
  dealSignedInTime,
  mul,
  phaseReached,
  validateFee,
  type DeadlineCode,
  type PhaseCode,
  type Track,
} from "@msim/engine";
import { parseDollars, parseShares } from "@/lib/admin/money-input";
import { cents, money } from "@/lib/format";

// ───────────── Deadlines (the server clock; a pause freezes a deadline after it began) ─────────────

export interface PauseState {
  paused: boolean;
  pausedAt: string | null;
}

export type DeadlineState = "NONE" | "OPEN" | "PAUSED" | "PASSED";

/** app.deadline_passed: passed by the server clock, never while the event is paused before it. No deadline: NONE. */
export function deadlineState(at: string | null | undefined, nowMs: number, p: PauseState): DeadlineState {
  if (!at) return "NONE";
  if (p.paused && p.pausedAt !== null && Date.parse(at) > Date.parse(p.pausedAt)) return "PAUSED";
  return nowMs > Date.parse(at) ? "PASSED" : "OPEN";
}

/** What a due time shows: a settled matter (a fee paid, a deal signed, a call window closed) shows no countdown. */
export function dueState(at: string | null | undefined, nowMs: number, p: PauseState, settled: boolean): DeadlineState | "CLOSED" {
  if (!at) return "NONE";
  return settled ? "CLOSED" : deadlineState(at, nowMs, p);
}

export type Deadlines = Partial<Record<DeadlineCode, string>>;

// ───────────── The squad's three teams ─────────────

export interface SquadIds {
  product_team_id: string;
  consulting_team_id: string;
  finance_team_id: string;
}

export function roleOf(s: SquadIds, teamId: string | null | undefined): Track | null {
  if (!teamId) return null;
  if (teamId === s.product_team_id) return "PRODUCT";
  if (teamId === s.consulting_team_id) return "CONSULTING";
  if (teamId === s.finance_team_id) return "FINANCE";
  return null;
}

const TEAM_NAMES: Record<Track, string> = { PRODUCT: "the Product team", CONSULTING: "the Consulting team", FINANCE: "the fund (Finance)" };

/** "your team", or the partner's role ("the Product team"); teams never see each other's codes. */
export function teamLabel(track: Track | null, mine: Track): string {
  if (!track) return "—";
  return track === mine ? "your team" : TEAM_NAMES[track];
}

export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ───────────── The crisis ─────────────

export interface TimelineItem {
  code: DeadlineCode;
  at: string;
  text: string;
}

/** What the rescue asks of the squad after the crisis, in the order of the night, at the event's own times. */
export function rescueTimeline(deadlines: Deadlines): TimelineItem[] {
  const items: [DeadlineCode, string][] = [
    ["FEE", "The Product and Consulting teams both confirm the same terms, or the default fee of $22,500 cash is paid."],
    ["DEAL_BONUS", "Rescue deal fully signed by all three teams: the Consulting team earns a $5,000 deal bonus."],
    ["DEAL", "Hard deadline for the deal and the rescue plan: without a fully signed deal, the plan score is capped at 50."],
  ];
  return items.flatMap(([code, text]) => (deadlines[code] ? [{ code, at: deadlines[code]!, text }] : []));
}

export interface CrisisMove {
  market_before: number | null;
  market_after: number;
  ai_before: number | null;
  ai_after: number | null;
}

// ───────────── The advisor's fee ─────────────

export interface FeeRow {
  cash_cents: number | string;
  shares: number;
  value_cents: number | string;
  version: number;
  product_confirmed_at: string | null;
  consulting_confirmed_at: string | null;
  executed_at: string | null;
  is_default: boolean;
  updated_at: string;
  updated_by_team: string | null;
}

export type FeeStage = "BEFORE_CRISIS" | "OPEN" | "DEFAULT_PENDING" | "AGREED" | "DEFAULT";

export interface FeeInput extends PauseState {
  phase: PhaseCode;
  crisisApplied: boolean;
  nowMs: number;
  /** The FEE deadline (01:05). */
  deadline: string | null;
  track: Track;
  squad: SquadIds;
  fee: FeeRow | null;
}

export interface FeeTermsView {
  cash: number;
  shares: number;
  value: number;
}

export interface FeeView {
  stage: FeeStage;
  /** The terms on the table (version > 1 and a value): what both teams confirm. */
  proposal: (FeeTermsView & { version: number; by: Track | null; at: string }) | null;
  confirmed: { PRODUCT: string | null; CONSULTING: string | null };
  /** What was paid (agreed or default). */
  executed: (FeeTermsView & { at: string; isDefault: boolean }) | null;
  /** Product and Consulting agree the fee; the fund only sees it. */
  party: boolean;
  canPropose: boolean;
  canConfirm: boolean;
  mine: string | null;
  /** The party that has not confirmed the current proposal yet (when the other one has). */
  waitingFor: Track | null;
}

/** fee_window_open: from the crisis until 01:05 (frozen while paused), and only until a fee has been paid. */
export function feeView(i: FeeInput): FeeView {
  const f = i.fee;
  const party = i.track === "PRODUCT" || i.track === "CONSULTING";
  const confirmed = { PRODUCT: f?.product_confirmed_at ?? null, CONSULTING: f?.consulting_confirmed_at ?? null };
  const value = f ? cents(f.value_cents) : 0;
  const proposal = f && value > 0 && !f.executed_at ? { cash: cents(f.cash_cents), shares: f.shares, value, version: f.version, by: roleOf(i.squad, f.updated_by_team), at: f.updated_at } : null;
  const executed = f?.executed_at ? { cash: cents(f.cash_cents), shares: f.shares, value, at: f.executed_at, isDefault: f.is_default } : null;
  let stage: FeeStage;
  if (executed) stage = executed.isDefault ? "DEFAULT" : "AGREED";
  else if (!i.crisisApplied || !phaseReached(i.phase, "CRISIS")) stage = "BEFORE_CRISIS";
  else if (deadlineState(i.deadline, i.nowMs, i) === "PASSED") stage = "DEFAULT_PENDING";
  else stage = "OPEN";
  const open = stage === "OPEN" && party;
  const mine = party ? confirmed[i.track as "PRODUCT" | "CONSULTING"] : null;
  let waitingFor: Track | null = null;
  if (proposal && stage === "OPEN") {
    if (confirmed.PRODUCT && !confirmed.CONSULTING) waitingFor = "CONSULTING";
    else if (confirmed.CONSULTING && !confirmed.PRODUCT) waitingFor = "PRODUCT";
  }
  return {
    stage,
    proposal,
    confirmed,
    executed,
    party,
    canPropose: open,
    canConfirm: open && proposal !== null && mine === null,
    mine,
    waitingFor,
  };
}

export type Preview<T> = { state: "EMPTY" } | { state: "INVALID"; message: string; value: number | null } | ({ state: "OK"; warning: string | null } & T);

/**
 * The fee form's live check (engine validateFee) and the total value: cash + shares × IPO price. An empty field is
 * 0. The company's cash and retained shares are known only to the Product team (`null` for Consulting): the database
 * checks them when the fee is proposed and again when it is paid.
 */
export function feePreview(
  draft: { cash: string; shares: string },
  ctx: { ipoPrice: number; companyCash: number | null; retained: number | null },
): Preview<FeeTermsView> {
  if (draft.cash.trim() === "" && draft.shares.trim() === "") return { state: "EMPTY" };
  const c = parseDollars(draft.cash);
  if (!c.ok) return { state: "INVALID", message: `Cash: ${c.message}.`, value: null };
  const s = parseShares(draft.shares);
  if (!s.ok) return { state: "INVALID", message: `Shares: ${s.message}.`, value: null };
  const cash = c.value ?? 0;
  const shares = s.value ?? 0;
  const value = cash >= 0 && shares >= 0 ? cash + mul(shares, ctx.ipoPrice) : null;
  const check = validateFee(
    { cash, shares },
    { ipoPrice: ctx.ipoPrice, companyCash: ctx.companyCash ?? Number.MAX_SAFE_INTEGER, retainedShares: ctx.retained ?? Number.MAX_SAFE_INTEGER },
  );
  if (!check.ok) {
    const detail = check.code === "NOT_ENOUGH_CASH" ? ` It has ${money(ctx.companyCash)}.` : check.code === "NOT_ENOUGH_SHARES" ? ` It holds ${(ctx.retained ?? 0).toLocaleString("en-US")} shares.` : "";
    return { state: "INVALID", message: `${check.message}${detail}`, value };
  }
  return { state: "OK", cash, shares, value: check.value, warning: null };
}

// ───────────── The rescue deal ─────────────

export interface DealRow {
  amount_cents: number | string | null;
  price_cents: number | null;
  shares: number | null;
  cash_moved_cents: number | string | null;
  version: number;
  signed_product_at: string | null;
  signed_consulting_at: string | null;
  signed_finance_at: string | null;
  executed_at: string | null;
  updated_at: string;
  updated_by_team: string | null;
}

export type DealStage = "BEFORE_CRISIS" | "OPEN" | "SIGNED" | "CLOSED";
/** The consultant's $5,000 bonus (fully signed by 02:45) and the plan cap (not fully signed at 03:00). */
export type Outcome = "YES" | "NO" | "OPEN";

export interface DealInput extends PauseState {
  phase: PhaseCode;
  crisisApplied: boolean;
  nowMs: number;
  deadlines: Deadlines;
  track: Track;
  squad: SquadIds;
  deal: DealRow | null;
  postCrisis: number | null;
}

export interface DealView {
  stage: DealStage;
  band: { min: number; max: number } | null;
  amount: number | null;
  price: number | null;
  shares: number | null;
  cashMoved: number | null;
  version: number;
  /** Both the amount and the price are set: the terms can be signed. */
  complete: boolean;
  signatures: Record<Track, string | null>;
  mine: string | null;
  editedBy: Track | null;
  editedAt: string | null;
  canEditPrice: boolean;
  canEditAmount: boolean;
  canSign: boolean;
  /** The teams that have not signed the current terms. */
  unsigned: Track[];
  bonus: Outcome;
  /** YES: the plan score is capped at 50 (no fully signed deal at 03:00). */
  capped: Outcome;
  executedAt: string | null;
}

/** deal_window_open: from the crisis until 03:00 (frozen while paused), and only through Rescue 2. */
export function dealView(i: DealInput): DealView {
  const d = i.deal;
  const amount = d?.amount_cents === null || d?.amount_cents === undefined ? null : cents(d.amount_cents);
  const price = d?.price_cents ?? null;
  const executedAt = d?.executed_at ?? null;
  const signatures: Record<Track, string | null> = {
    PRODUCT: d?.signed_product_at ?? null,
    CONSULTING: d?.signed_consulting_at ?? null,
    FINANCE: d?.signed_finance_at ?? null,
  };
  const crisis = i.crisisApplied && phaseReached(i.phase, "CRISIS");
  const deal = deadlineState(i.deadlines.DEAL, i.nowMs, i);
  const windowOpen = crisis && !phaseReached(i.phase, "PLANS_PUBLISHED") && deal !== "PASSED";
  const stage: DealStage = executedAt ? "SIGNED" : !crisis ? "BEFORE_CRISIS" : windowOpen ? "OPEN" : "CLOSED";
  const open = stage === "OPEN";
  const complete = amount !== null && price !== null;
  const terms = complete && price! > 0 ? dealShares({ amount: amount!, price: price! }) : null;
  const bonusAt = i.deadlines.DEAL_BONUS ? new Date(i.deadlines.DEAL_BONUS) : null;
  const dealAt = i.deadlines.DEAL ? new Date(i.deadlines.DEAL) : null;
  const signedAt = executedAt ? new Date(executedAt) : null;
  const bonus: Outcome = signedAt
    ? bonusAt && dealBonusEarned(signedAt, bonusAt)
      ? "YES"
      : "NO"
    : stage === "CLOSED" || deadlineState(i.deadlines.DEAL_BONUS, i.nowMs, i) === "PASSED"
      ? "NO"
      : "OPEN";
  const capped: Outcome = signedAt ? (dealAt && dealSignedInTime(signedAt, dealAt) ? "NO" : "YES") : stage === "CLOSED" ? "YES" : "OPEN";
  return {
    stage,
    band: i.postCrisis ? dealPriceBand(i.postCrisis) : null,
    amount,
    price,
    shares: d?.shares ?? terms?.shares ?? null,
    cashMoved: d?.cash_moved_cents !== null && d?.cash_moved_cents !== undefined ? cents(d.cash_moved_cents) : (terms?.cashMoved ?? null),
    version: d?.version ?? 1,
    complete,
    signatures,
    mine: signatures[i.track],
    editedBy: d ? roleOf(i.squad, d.updated_by_team) : null,
    editedAt: d?.updated_by_team ? d.updated_at : null,
    canEditPrice: open && i.track === "CONSULTING",
    canEditAmount: open && i.track === "FINANCE",
    canSign: open && complete && signatures[i.track] === null,
    unsigned: (["PRODUCT", "CONSULTING", "FINANCE"] as const).filter((t) => signatures[t] === null),
    bonus,
    capped,
    executedAt,
  };
}

export interface DealTermsPreview {
  amount: number | null;
  price: number | null;
  shares: number | null;
  cashMoved: number | null;
}

/**
 * The deal form's live check: Consulting types the price (50%–100% of the post-crisis price), the fund the amount
 * ($40,000–$80,000); the other term is the one on the table. With both, the shares (floor(amount ÷ price)) and the
 * cash moved (shares × price), as the engine computes them. `fundAvailable` (the fund's own screen) warns when the
 * fund could not pay at signing; the database checks again when the third team signs.
 */
export function dealPreview(
  input: { track: "CONSULTING" | "FINANCE"; text: string; amount: number | null; price: number | null; postCrisis: number; fundAvailable?: number | null },
): Preview<DealTermsPreview> {
  if (input.text.trim() === "") return { state: "EMPTY" };
  const p = parseDollars(input.text);
  const what = input.track === "CONSULTING" ? "Price" : "Amount";
  if (!p.ok) return { state: "INVALID", message: `${what}: ${p.message}.`, value: null };
  if (p.value === null || p.value <= 0) return { state: "INVALID", message: `${what}: enter an amount above $0.`, value: null };
  const band = dealPriceBand(input.postCrisis);
  let amount = input.amount;
  let price = input.price;
  if (input.track === "CONSULTING") {
    price = p.value;
    if (price < band.min || price > band.max) {
      return { state: "INVALID", message: `The price must be 50%–100% of the post-crisis price ${money(input.postCrisis)}: ${money(band.min)} to ${money(band.max)}.`, value: null };
    }
  } else {
    amount = p.value;
    if (amount < RULES.DEAL_MIN || amount > RULES.DEAL_MAX) {
      return { state: "INVALID", message: "The rescue amount must be $40,000 to $80,000.", value: null };
    }
  }
  if (amount === null || price === null) return { state: "OK", amount, price, shares: null, cashMoved: null, warning: null };
  const { shares, cashMoved } = dealShares({ amount, price });
  if (shares < 1) return { state: "INVALID", message: "The deal must transfer at least one share.", value: null };
  const warning =
    input.track === "FINANCE" && input.fundAvailable !== null && input.fundAvailable !== undefined && cashMoved > input.fundAvailable
      ? `Your available cash is ${money(input.fundAvailable)} (cash less collateral and the reserves of pending orders): the deal could not be paid at signing.`
      : null;
  return { state: "OK", amount, price, shares, cashMoved, warning };
}

/** Guidance shown with the signing buttons: whether the squad's balances can carry the terms on the table. */
export function dealBalanceWarning(v: Pick<DealView, "shares" | "cashMoved" | "complete">, ctx: { track: Track; fundAvailable: number | null; retained: number | null }): string | null {
  if (!v.complete || v.shares === null || v.cashMoved === null) return null;
  if (ctx.track === "FINANCE" && ctx.fundAvailable !== null && v.cashMoved > ctx.fundAvailable) {
    return `Your available cash is ${money(ctx.fundAvailable)}, less than the ${money(v.cashMoved)} this deal moves: the last signature would be refused and every signature reset.`;
  }
  if (ctx.track === "PRODUCT" && ctx.retained !== null && v.shares > ctx.retained) {
    return `Your company holds ${ctx.retained.toLocaleString("en-US")} retained shares, fewer than the ${v.shares.toLocaleString("en-US")} this deal moves: the last signature would be refused.`;
  }
  return null;
}

/** Integer cents as the text a dollar field starts with: 750 → "7.50", 6000000 → "60000.00" (integer arithmetic only). */
export function dollarsText(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Messages after a fee or deal action, naming exactly what happened. */
export function feeTermsText(t: { cash: number; shares: number; value: number }): string {
  const parts = [t.cash > 0 || t.shares === 0 ? `${money(t.cash)} cash` : null, t.shares > 0 ? `${t.shares.toLocaleString("en-US")} shares` : null].filter(Boolean);
  return `${parts.join(" + ")} (value ${money(t.value)})`;
}

export function dealTermsText(t: { shares: number | null; price: number | null; cashMoved: number | null }): string {
  if (t.shares === null || t.price === null || t.cashMoved === null) return "incomplete terms";
  return `${t.shares.toLocaleString("en-US")} shares at ${money(t.price)} (${money(t.cashMoved)})`;
}
