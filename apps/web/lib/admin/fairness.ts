// The fairness view's pure logic: the collusion flags explained (kind, company, teams, details), the log of the
// fairness officer's decisions (from the audit log, so a changed decision keeps its history), and the drill-down of
// one team (the company it built and the one it rescued, holdings, orders across rounds, result). Money stays
// integer cents and is only formatted here.

import { bp, count, money } from "@/lib/format";
import { companyLabel, type CompanyRef, type LedgerRefs, type TeamRef } from "./ledger";
import type { StaffRef } from "./ledger-corrections";

export type FlagStatus = "OPEN" | "CLEARED" | "DISQUALIFIED";
export type FlagKind = 1 | 2 | 3;

export interface FlagRow {
  id: string;
  kind: number;
  company_id: string | null;
  team_ids: string[];
  details: Record<string, unknown> | null;
  status: FlagStatus;
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
  created_at: string;
}

/** The three collusion flags, as the brief states them. */
export const FLAG_KINDS: Record<FlagKind, { title: string; rule: string }> = {
  1: {
    title: "Reciprocal buying",
    rule: "The same pair of teams each bought shares of the company the other built.",
  },
  2: {
    title: "Large position closing at a loss",
    rule: "A team holding at least 4,000 shares of one company whose closing price fell below the team's average cost.",
  },
  3: {
    title: "Teams rushing to the limit",
    rule: "Five or more teams reaching the 5,000-share limit on the same company in the same round.",
  },
};

export const FLAG_STATUS_LABELS: Record<FlagStatus, string> = { OPEN: "Open", CLEARED: "Cleared", DISQUALIFIED: "Disqualified" };

export interface FlagDetail {
  label: string;
  value: string;
}

export interface FlagTeam {
  id: string;
  code: string;
}

export interface FlagView {
  id: string;
  kind: number;
  title: string;
  rule: string;
  ticker: string;
  teams: FlagTeam[];
  details: FlagDetail[];
  status: FlagStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface FairnessRefs {
  teams: ReadonlyMap<string, TeamRef>;
  companies: ReadonlyMap<string, CompanyRef>;
  staff: ReadonlyMap<string, StaffRef>;
}

const isKind = (k: number): k is FlagKind => k === 1 || k === 2 || k === 3;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const cents = (v: unknown): string => {
  const n = num(v);
  return n !== null && Number.isSafeInteger(n) ? money(n) : "—";
};

export const staffName = (staff: ReadonlyMap<string, StaffRef>, userId: string | null | undefined): string | null =>
  userId ? (staff.get(userId)?.display_name ?? "Unknown staff member") : null;

/** "52.9%": a price as a share of another, to one decimal (display only). */
export function percentOf(part: number, whole: number): string {
  if (!whole) return "—";
  const tenths = Math.round((part * 1000) / whole);
  return `${(tenths / 10).toFixed(1)}%`;
}

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The details the settlement stored with a flag, in words. */
export function flagDetails(kind: number, details: Record<string, unknown> | null, teams: readonly FlagTeam[]): FlagDetail[] {
  const d = details ?? {};
  const out: FlagDetail[] = [];
  if (kind === 1) {
    // {<team code>: {company, bought}} for each of the two teams.
    for (const t of teams) {
      const e = record(d[t.code]);
      if (!e) continue;
      const bought = num(e.bought);
      out.push({ label: `${t.code} bought`, value: `${bought === null ? "?" : count(bought)} shares of ${typeof e.company === "string" ? e.company : "?"}` });
    }
  } else if (kind === 2) {
    const qty = num(d.qty);
    const cost = num(d.cost);
    const close = num(d.closing_price);
    if (qty !== null) out.push({ label: "Shares held", value: count(qty) });
    if (qty && cost !== null) out.push({ label: "Average cost", value: `${cents(Math.round(cost / qty))} (${cents(cost)} in all)` });
    if (close !== null) out.push({ label: "Closing price", value: cents(close) });
    if (qty !== null && cost !== null && close !== null) out.push({ label: "Loss at the close", value: cents(qty * close - cost) });
  } else if (kind === 3) {
    const round = num(d.round);
    const n = num(d.teams);
    if (round !== null) out.push({ label: "Round", value: String(round) });
    if (n !== null) out.push({ label: "Teams reaching 5,000 shares", value: count(n) });
  }
  return out;
}

export function flagView(f: FlagRow, refs: FairnessRefs): FlagView {
  const kind = isKind(f.kind) ? FLAG_KINDS[f.kind] : { title: `Flag ${f.kind}`, rule: "" };
  const teams = (f.team_ids ?? []).map((id) => {
    const t = refs.teams.get(id);
    return { id, code: t?.code ?? "?" };
  });
  const tickerDetail = typeof f.details?.ticker === "string" ? (f.details.ticker as string) : null;
  return {
    id: f.id,
    kind: f.kind,
    title: kind.title,
    rule: kind.rule,
    ticker: f.company_id ? (refs.companies.get(f.company_id)?.ticker ?? tickerDetail ?? companyLabel(refs.companies.get(f.company_id), refs.teams)) : "",
    teams,
    details: flagDetails(f.kind, f.details, teams),
    status: f.status,
    decidedBy: staffName(refs.staff, f.decided_by),
    decidedAt: f.decided_at,
    reason: f.reason,
  };
}

/** Flags in the order to work through them: open first, then by kind and when they were raised. */
export function flagViews(rows: readonly FlagRow[], refs: FairnessRefs): FlagView[] {
  const order = (s: FlagStatus) => (s === "OPEN" ? 0 : 1);
  return [...rows]
    .sort((a, b) => order(a.status) - order(b.status) || a.kind - b.kind || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((f) => flagView(f, refs));
}

export function flagSummary(rows: readonly { status: FlagStatus }[]): string {
  if (rows.length === 0) return "No flags.";
  const n = (s: FlagStatus) => rows.filter((r) => r.status === s).length;
  return `${rows.length} flag${rows.length === 1 ? "" : "s"}: ${n("OPEN")} open, ${n("CLEARED")} cleared, ${n("DISQUALIFIED")} disqualified.`;
}

/** A short name for a flag in the log: "Flag 2 · MLBT" or "Flag 1 · T001, T002". */
export function flagLabel(f: Pick<FlagView, "kind" | "ticker" | "teams">): string {
  return `Flag ${f.kind} · ${f.ticker || f.teams.map((t) => t.code).join(", ")}`;
}

// ───────────────────────────── Decisions log ─────────────────────────────

export interface FlagAuditRow {
  id: number | string;
  at: string;
  actor_user_id: string | null;
  action: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface DecisionLine {
  id: string;
  at: string;
  who: string;
  flag: string;
  decision: FlagStatus;
  reason: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Every decision on a flag, newest first: each change of a flag's status or reason in the audit log (who, when,
 * what, why), so a decision that was changed keeps its history.
 */
export function decisionLog(rows: readonly FlagAuditRow[], flags: ReadonlyMap<string, FlagView>, staff: ReadonlyMap<string, StaffRef>): DecisionLine[] {
  const out: DecisionLine[] = [];
  for (const r of rows) {
    if (r.action !== "update" || !r.after) continue;
    const status = str(r.after.status) as FlagStatus | null;
    if (status !== "CLEARED" && status !== "DISQUALIFIED") continue;
    const before = r.before ?? {};
    if (before.status === r.after.status && before.reason === r.after.reason && before.decided_at === r.after.decided_at) continue;
    const flag = r.entity_id ? flags.get(r.entity_id) : undefined;
    out.push({
      id: String(r.id),
      at: str(r.after.decided_at) ?? r.at,
      who: staffName(staff, r.actor_user_id ?? str(r.after.decided_by)) ?? "—",
      flag: flag ? flagLabel(flag) : "A flag",
      decision: status,
      reason: str(r.after.reason) ?? "",
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || Number(b.id) - Number(a.id));
}

// ───────────────────────────── Team drill-down ─────────────────────────────

export interface HoldingRow {
  company_id: string;
  qty: number;
  cost_cents: number | string;
}

export interface OrderRow {
  id: string;
  round_id: string;
  company_id: string;
  type: string;
  qty: number;
  status: string;
  entry_price: number;
  fill_price: number | null;
  created_at: string;
}

export interface ResultRow {
  r1_points: number;
  r2_points: number;
  r3_points: number;
  portfolio_cents: number | string;
  return_bp: number | string;
  total: number;
  rank: number | null;
  eligible: boolean;
}

const ticker = (refs: LedgerRefs, id: string) => companyLabel(refs.companies.get(id), refs.teams);

/** The team's holdings, by ticker, with the average cost. */
export function holdingLines(rows: readonly HoldingRow[], refs: LedgerRefs) {
  return rows
    .filter((h) => h.qty !== 0)
    .map((h) => {
      const cost = Number(h.cost_cents);
      return { key: h.company_id, ticker: ticker(refs, h.company_id), qty: count(h.qty), cost: money(h.cost_cents), average: money(Math.round(cost / h.qty)) };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Every order of the team, by round then the time it was placed. */
export function orderLines(rows: readonly OrderRow[], refs: LedgerRefs) {
  return [...rows]
    .map((o) => ({ o, round: refs.rounds.get(o.round_id) ?? 0 }))
    .sort((a, b) => a.round - b.round || a.o.created_at.localeCompare(b.o.created_at) || a.o.id.localeCompare(b.o.id))
    .map(({ o, round }) => ({
      id: o.id,
      round: round ? String(round) : "?",
      ticker: ticker(refs, o.company_id),
      type: o.type,
      qty: count(o.qty),
      status: o.status,
      entryPrice: money(o.entry_price),
      fillPrice: o.fill_price === null ? "" : money(o.fill_price),
      placedAt: o.created_at,
    }));
}

/** The settled result: the three rounds' points, total, portfolio, return and rank (none while disqualified). */
export function resultView(r: ResultRow | null) {
  if (!r) return null;
  const ret = Number(r.return_bp);
  return {
    r1: String(r.r1_points),
    r2: String(r.r2_points),
    r3: String(r.r3_points),
    total: String(r.total),
    portfolio: money(r.portfolio_cents),
    returnPct: Number.isSafeInteger(ret) ? bp(ret) : "—",
    rank: r.rank === null ? (r.eligible ? "—" : "Not ranked (disqualified)") : `${r.rank}`,
    eligible: r.eligible,
  };
}

// ───────────────────────────── Decision form ─────────────────────────────

export type Decision = "CLEARED" | "DISQUALIFIED";

/**
 * The decision form's fields for decide_flag. The reason is sent as typed: the game function trims it and refuses
 * one shorter than 5 characters, and that refusal is shown as it comes.
 */
export function flagDecisionFromForm(f: { decision: unknown; reason: unknown }): { ok: true; value: { status: Decision; reason: string } } | { ok: false; message: string } {
  const status = f.decision === "CLEARED" || f.decision === "DISQUALIFIED" ? f.decision : null;
  if (!status) return { ok: false, message: "Choose whether to clear the flag or disqualify the teams involved." };
  return { ok: true, value: { status, reason: typeof f.reason === "string" ? f.reason : "" } };
}
