"use server";

// The crisis room's actions, each a game function run as the signed-in team: the firm's profile (save_firm_profile),
// offers (make_offer, respond_offer), the company's rating of its firm (rate_firm) and the Round 3 pick
// (pick_statement). The database checks the track, the window and the terms; its refusals are shown as they come.
// The advice memo and the solution go through the squad editor's actions (save_draft_for / submit_for).

import { rpc, type ActionResult } from "@/lib/rpc";
import { money } from "@/lib/format";
import { parseDollars, parseShares, termsText, type OfferMove } from "@/lib/team/crisis";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (message: string): ActionResult => ({ ok: false, code: "BAD_INPUT", message });

export async function saveFirmProfile(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const headline = String(form.get("headline") ?? "").trim();
  const rateCard = String(form.get("rate_card") ?? "").trim();
  const specialities = String(form.get("specialities") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const asking = parseDollars(form.get("asking"));
  if (headline.length > 140) return bad("The headline is at most 140 characters.");
  if (rateCard.length > 600) return bad("The rate card is at most 600 characters.");
  if (specialities.length > 8 || specialities.some((s) => s.length > 40)) return bad("At most 8 specialities, 40 characters each.");
  if (asking === null) return bad("Write the asking fee as an amount in dollars, e.g. 750 or 750.50.");
  const r = await rpc("save_firm_profile", { p_headline: headline, p_specialities: specialities, p_rate_card: rateCard, p_asking_cents: asking });
  return r.ok ? { ...r, message: "Your firm's profile is saved: every Product team sees it in the firm directory." } : r;
}

function terms(form: FormData): { cash: number; shares: number } | ActionResult {
  const cash = parseDollars(form.get("cash"));
  const shares = parseShares(form.get("shares"));
  if (cash === null) return bad("Write the cash as an amount in dollars, e.g. 500 or 500.25.");
  if (shares === null) return bad("Shares are a whole number.");
  if (cash === 0 && shares === 0) return bad("Offer some cash, some shares or both.");
  return { cash, shares };
}

export async function makeOffer(firmId: string, firmName: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(firmId)) return bad("Unknown firm.");
  const t = terms(form);
  if ("ok" in t) return t;
  const note = String(form.get("note") ?? "").trim().slice(0, 300);
  const r = await rpc("make_offer", { p_firm: firmId, p_cash: t.cash, p_shares: t.shares, p_note: note });
  return r.ok ? { ...r, message: `Offer sent to ${firmName.slice(0, 60)}: ${termsText(money(t.cash), t.shares)}. It is their turn to answer.` } : r;
}

export async function counterOffer(offerId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(offerId)) return bad("Unknown offer.");
  const t = terms(form);
  if ("ok" in t) return t;
  const r = await rpc("respond_offer", { p_offer: offerId, p_action: "COUNTER", p_cash: t.cash, p_shares: t.shares });
  return r.ok ? { ...r, message: `Counter sent: ${termsText(money(t.cash), t.shares)}. It is the other side's turn.` } : r;
}

const MOVE_DONE: Record<Exclude<OfferMove, "COUNTER">, string> = {
  ACCEPT: "Accepted: the cash is held in escrow until the due time and paid to the firm if its memo is submitted.",
  DECLINE: "Declined.",
  WITHDRAW: "Offer withdrawn.",
};

export async function answerOffer(offerId: string, move: Exclude<OfferMove, "COUNTER">): Promise<ActionResult> {
  if (!UUID.test(offerId)) return bad("Unknown offer.");
  if (!(move in MOVE_DONE)) return bad("Unknown answer.");
  const r = await rpc("respond_offer", { p_offer: offerId, p_action: move });
  return r.ok ? { ...r, message: MOVE_DONE[move] } : r;
}

export async function rateFirm(k: number, rating: number): Promise<ActionResult> {
  if (!Number.isInteger(k) || k < 1 || k > 5) return bad("Unknown sub-round.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad("Rate from 1 to 5.");
  const r = await rpc("rate_firm", { p_k: k, p_rating: rating });
  return r.ok ? { ...r, message: `You rated your firm ${rating} out of 5. You can change it until ratings close.` } : r;
}

export async function pickStatement(statementId: string, label: string): Promise<ActionResult> {
  if (!UUID.test(statementId)) return bad("Unknown statement.");
  const r = await rpc("pick_statement", { p_statement: statementId });
  return r.ok ? { ...r, message: `You picked ${label.slice(0, 80)}.` } : r;
}
