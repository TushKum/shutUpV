"use server";

// The rescue's actions. Each runs one game function as the signed-in team: propose_fee and confirm_fee (Product and
// Consulting), edit_deal (Consulting the price, the fund the amount) and sign_deal (all three). The database checks
// the caller, the window, the deadline and every limit again; its refusals are shown as they come. Amounts typed in
// dollars become integer cents from the text, never through floating point.

import { RULES } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";
import { parseDollars, parseShares } from "@/lib/admin/money-input";
import { cents, money } from "@/lib/format";
import { dealTermsText, feeTermsText } from "@/lib/team/rescue";

const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);

export async function proposeFee(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const c = parseDollars(String(form.get("cash") ?? ""));
  if (!c.ok) return { ok: false, code: "BAD_TERMS", message: `Cash: ${c.message}.` };
  const s = parseShares(String(form.get("shares") ?? ""));
  if (!s.ok) return { ok: false, code: "BAD_TERMS", message: `Shares: ${s.message}.` };
  const cash = c.value ?? 0;
  const shares = s.value ?? 0;
  if (cash === 0 && shares === 0) return { ok: false, code: "BAD_TERMS", message: "Enter the cash, the shares, or both." };
  if (cash < 0 || shares < 0) return { ok: false, code: "BAD_TERMS", message: "Cash and shares must be whole, non-negative amounts." };
  if (shares > RULES.FEE_MAX_SHARES) return { ok: false, code: "TOO_MANY_SHARES", message: "At most 3,000 shares can be part of the fee." };
  const r = await rpc("propose_fee", { p_cash: cash, p_shares: shares });
  if (!r.ok) return r;
  const fee = r.data?.fee as Record<string, unknown> | undefined;
  const version = num(fee?.version);
  const value = fee?.value_cents === undefined ? null : cents(fee.value_cents as string | number);
  return {
    ...r,
    message: `Proposed ${feeTermsText({ cash, shares, value: value ?? 0 })}${version !== null ? ` as version ${version}` : ""}. Both teams must now confirm it; any earlier confirmation was reset.`,
  };
}

export async function confirmFee(version: number): Promise<ActionResult> {
  if (!Number.isSafeInteger(version)) return { ok: false, code: "BAD_VERSION", message: "Reload the page and try again." };
  const r = await rpc("confirm_fee", { p_version: version });
  if (!r.ok) {
    return r.code === "VERSION_CONFLICT" ? { ...r, message: "Not confirmed: the proposal changed since this page showed it. Review the new terms, then confirm." } : r;
  }
  const fee = r.data?.fee as Record<string, unknown> | undefined;
  if (fee?.executed_at) {
    const terms = { cash: cents(fee.cash_cents as string | number), shares: num(fee.shares) ?? 0, value: cents(fee.value_cents as string | number) };
    return { ...r, message: `Both teams confirmed: the fee of ${feeTermsText(terms)} has been paid to the Consulting team.` };
  }
  return { ...r, message: `You confirmed version ${version}. The fee is paid when the other team confirms the same version.` };
}

export async function setDealPrice(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseDollars(String(form.get("price") ?? ""));
  if (!p.ok) return { ok: false, code: "BAD_TERMS", message: `Price: ${p.message}.` };
  if (p.value === null || p.value <= 0) return { ok: false, code: "BAD_TERMS", message: "Enter a price per share above $0." };
  return dealEdited(await rpc("edit_deal", { p_price: p.value }));
}

export async function setDealAmount(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const a = parseDollars(String(form.get("amount") ?? ""));
  if (!a.ok) return { ok: false, code: "BAD_TERMS", message: `Amount: ${a.message}.` };
  if (a.value === null || a.value <= 0) return { ok: false, code: "BAD_TERMS", message: "Enter the amount the fund invests." };
  return dealEdited(await rpc("edit_deal", { p_amount: a.value }));
}

function dealTerms(deal: Record<string, unknown> | undefined) {
  return {
    shares: num(deal?.shares),
    price: num(deal?.price_cents),
    cashMoved: deal?.cash_moved_cents === null || deal?.cash_moved_cents === undefined ? null : cents(deal.cash_moved_cents as string | number),
  };
}

function dealEdited(r: ActionResult): ActionResult {
  if (!r.ok) return r;
  const deal = r.data?.deal as Record<string, unknown> | undefined;
  const t = dealTerms(deal);
  const version = num(deal?.version);
  const terms = t.shares !== null ? `The terms are now ${dealTermsText(t)}` : "The terms are not complete yet";
  return { ...r, message: `${terms}${version !== null ? ` (version ${version})` : ""}. Every signature was reset: all three teams must sign again.` };
}

export async function signDeal(version: number): Promise<ActionResult> {
  if (!Number.isSafeInteger(version)) return { ok: false, code: "BAD_VERSION", message: "Reload the page and try again." };
  const r = await rpc("sign_deal", { p_version: version });
  if (!r.ok) {
    return r.code === "VERSION_CONFLICT" ? { ...r, message: "Not signed: the terms changed since this page showed them. Review the new terms, then sign." } : r;
  }
  const deal = r.data?.deal as Record<string, unknown> | undefined;
  if (deal?.executed_at) {
    const t = dealTerms(deal);
    return {
      ...r,
      message: `Signed by all three teams: ${t.shares?.toLocaleString("en-US")} shares moved from the Product team's retained shares into the fund's squad lot, and ${money(t.cashMoved)} was paid to the company.`,
    };
  }
  return { ...r, message: `You signed version ${version}. The deal executes when all three teams have signed it.` };
}
