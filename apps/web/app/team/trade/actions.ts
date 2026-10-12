"use server";

// The fund's game actions: place, edit and cancel an order, and place an IPO bid. Each is one game function run as the
// signed-in team; the database checks the caller, the phase, the round or deadline, every limit and the rate limit,
// and its refusal is shown as it comes. Only the shape of the input is checked here (a company id, an order type, a
// whole number of shares), because the functions take typed arguments.

import { ORDER_MESSAGES, ORDER_TYPES, type OrderType } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";
import { CLIENT_REF_RE, parseShares } from "@/lib/team/trade";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (n: number) => n.toLocaleString("en-US");

function sharesOf(form: FormData): number | null {
  const qty = parseShares(String(form.get("qty") ?? ""));
  return qty === null || qty > 100_000 ? null : qty;
}

const badQuantity: ActionResult = { ok: false, code: "BAD_QUANTITY", message: ORDER_MESSAGES.BAD_QUANTITY };

interface PlacedOrder {
  type?: OrderType;
  qty?: number;
  status?: string;
}

export async function placeOrder(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const company = String(form.get("company") ?? "");
  const type = String(form.get("type") ?? "") as OrderType;
  const ticker = String(form.get("ticker") ?? "").slice(0, 8);
  const ref = String(form.get("client_ref") ?? "");
  if (!UUID.test(company)) return { ok: false, code: "NO_COMPANY", message: "Choose the company to trade." };
  if (!ORDER_TYPES.includes(type)) return { ok: false, code: "NO_TYPE", message: "Choose BUY, SELL, SHORT or COVER." };
  const qty = sharesOf(form);
  if (qty === null || qty < 1) return badQuantity;
  const r = await rpc("place_order", { p_company: company, p_type: type, p_qty: qty, p_client_ref: CLIENT_REF_RE.test(ref) ? ref : null });
  if (!r.ok) return r;
  const order = (r.data?.order ?? {}) as PlacedOrder;
  const what = `${order.type ?? type} ${count(order.qty ?? qty)} ${ticker}`.trim();
  if (r.data?.duplicate === true) {
    return { ...r, message: `Already placed: ${what} (the same order was sent twice; no second order was made).` };
  }
  return { ...r, message: `Order placed: ${what}. It fills at this round's clearing price; you can edit or cancel it until the round closes.` };
}

export async function editOrder(orderId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(orderId)) return { ok: false, code: "NOT_EDITABLE", message: "That order can no longer be changed." };
  const qty = sharesOf(form);
  if (qty === null || qty < 1) return badQuantity;
  const r = await rpc("edit_order", { p_order: orderId, p_qty: qty });
  return r.ok ? { ...r, message: `Order changed to ${count(qty)} shares.` } : r;
}

export async function cancelOrder(orderId: string): Promise<ActionResult> {
  if (!UUID.test(orderId)) return { ok: false, code: "NOT_EDITABLE", message: "That order can no longer be changed." };
  const r = await rpc("cancel_order", { p_order: orderId });
  return r.ok ? { ...r, message: "Order cancelled." } : r;
}

export async function placeIpoBid(companyId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(companyId)) return { ok: false, code: "NOT_LISTED", message: "That company has no IPO price." };
  const qty = parseShares(String(form.get("qty") ?? ""));
  if (qty === null || qty > 4000) return { ok: false, code: "BAD_QUANTITY", message: "Request 0 to 4,000 shares per company." };
  const r = await rpc("place_ipo_bid", { p_company: companyId, p_qty: qty });
  if (!r.ok) return r;
  return { ...r, message: qty === 0 ? "Bid withdrawn." : `Bid saved: ${count(qty)} shares.` };
}
