// Ledger corrections (two people): the request form turned into request_correction's entries, and the stored
// corrections turned into lines for the pending list and the history. Amounts are converted from the typed text by
// exact string parsing (money-input.ts), never through floating point. The game functions check everything again
// (the lot fits the team, the limits, the second person) and their refusals are shown as they come.

import { LOT_TYPES, type LotType } from "@msim/engine";
import { parseDollars, parseShares } from "./money-input";
import { bigCents, companyLabel, signedCount, signedMoney, shortTxn, type CompanyRef, type TeamRef } from "./ledger";

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** One entry as request_correction stores it; the exchange takes the other side. */
export interface CorrectionEntry {
  team_id: string;
  company_id?: string;
  lot?: LotType;
  cash_delta_cents?: number;
  share_delta?: number;
}

export const MIN_REASON = 10;
export const MAX_ENTRIES = 50;

/** The request form's fields: the reason, and one value per entry row for each column (in the rows' order). */
export interface CorrectionForm {
  reason: string;
  team: string[];
  company: string[];
  lot: string[];
  cash: string[];
  shares: string[];
}

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** Reads the request form (every entry row has the five fields, so the lists line up). */
export function readCorrectionForm(form: FormData): CorrectionForm {
  const all = (name: string) => form.getAll(name).map(text);
  return {
    reason: text(form.get("reason")),
    team: all("entry_team"),
    company: all("entry_company"),
    lot: all("entry_lot"),
    cash: all("entry_cash"),
    shares: all("entry_shares"),
  };
}

const isLot = (v: string): v is LotType => (LOT_TYPES as readonly string[]).includes(v);

/**
 * The reason and entries for request_correction. Blank rows are skipped. Each entry needs a team and a cash or share
 * change; a share change needs a company and a lot. Dollars become integer cents exactly ("12.34" → 1234, "-0.5" →
 * -50); more than 2 decimals is refused.
 */
export function correctionFromForm(f: CorrectionForm): Parsed<{ reason: string; entries: CorrectionEntry[] }> {
  const reason = f.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, message: `Give a reason of at least ${MIN_REASON} characters.` };
  const rows = Math.max(f.team.length, f.company.length, f.lot.length, f.cash.length, f.shares.length);
  const entries: CorrectionEntry[] = [];
  for (let i = 0; i < rows; i++) {
    const team = (f.team[i] ?? "").trim();
    const company = (f.company[i] ?? "").trim();
    const lot = (f.lot[i] ?? "").trim();
    const cashText = f.cash[i] ?? "";
    const sharesText = f.shares[i] ?? "";
    if (!team && !company && !lot && !cashText.trim() && !sharesText.trim()) continue;
    const at = `Entry ${i + 1}`;
    if (!team) return { ok: false, message: `${at}: choose a team.` };
    const cash = parseDollars(cashText);
    if (!cash.ok) return { ok: false, message: `${at}: cash change ${cash.message}.` };
    const shares = parseShares(sharesText);
    if (!shares.ok) return { ok: false, message: `${at}: share change ${shares.message}.` };
    if (!cash.value && !shares.value) return { ok: false, message: `${at}: enter a cash change or a share change.` };
    if (lot && !isLot(lot)) return { ok: false, message: `${at}: unknown lot ${lot}.` };
    if (shares.value && (!company || !lot)) return { ok: false, message: `${at}: a share change needs a company and a lot.` };
    const e: CorrectionEntry = { team_id: team };
    if (company) e.company_id = company;
    if (lot) e.lot = lot as LotType;
    if (cash.value) e.cash_delta_cents = cash.value;
    if (shares.value) e.share_delta = shares.value;
    entries.push(e);
  }
  if (entries.length === 0) return { ok: false, message: "Add at least one entry: a team and a cash or share change." };
  if (entries.length > MAX_ENTRIES) return { ok: false, message: `A correction has at most ${MAX_ENTRIES} entries.` };
  return { ok: true, value: { reason, entries } };
}

// ───────────────────────────── Stored corrections ─────────────────────────────

export interface CorrectionRow {
  id: string;
  requested_by: string;
  requested_at: string;
  reason: string;
  entries: unknown;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_txn_id: string | null;
}

export interface StaffRef {
  user_id: string;
  display_name: string;
  role: string;
}

export interface CorrectionEntryLine {
  party: string;
  ticker: string;
  lot: string;
  cash: string;
  cashSign: -1 | 0 | 1;
  shares: string;
}

export interface CorrectionView {
  id: string;
  status: CorrectionRow["status"];
  reason: string;
  requestedBy: string;
  requestedAt: string;
  entries: CorrectionEntryLine[];
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  txn: string | null;
  /** Whether the viewer may approve or reject it; otherwise `whyNot` says why. */
  canDecide: boolean;
  whyNot: string | null;
}

const field = (o: Record<string, unknown>, k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);

function wholeOrZero(v: unknown): bigint {
  try {
    return v === undefined || v === null ? 0n : bigCents(v as number | string);
  } catch {
    return 0n;
  }
}

/** The stored entries (jsonb, written only through request_correction) as lines. */
export function correctionEntryLines(
  entries: unknown,
  teams: ReadonlyMap<string, TeamRef>,
  companies: ReadonlyMap<string, CompanyRef>,
): CorrectionEntryLine[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((raw) => {
    const e = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const teamId = field(e, "team_id");
    const companyId = field(e, "company_id");
    const cash = wholeOrZero(e.cash_delta_cents);
    const shares = Number(wholeOrZero(e.share_delta));
    return {
      party: teamId ? (teams.get(teamId)?.code ?? "?") : "?",
      ticker: companyId ? companyLabel(companies.get(companyId), teams) : "",
      lot: field(e, "lot") ?? "",
      cash: cash === 0n ? "" : signedMoney(cash),
      cashSign: cash > 0n ? 1 : cash < 0n ? -1 : 0,
      shares: shares ? signedCount(shares) : "",
    };
  });
}

const nameOf = (staff: ReadonlyMap<string, StaffRef>, userId: string | null) => {
  if (!userId) return null;
  const s = staff.get(userId);
  return s ? s.display_name : "Unknown staff member";
};

/**
 * Pending corrections first (oldest first, the order they were asked), then the decided ones (newest first). A
 * correction needs a second person: its requester sees why they cannot decide it; only organisers and the fairness
 * officer decide.
 */
export function correctionViews(
  rows: readonly CorrectionRow[],
  ctx: {
    teams: ReadonlyMap<string, TeamRef>;
    companies: ReadonlyMap<string, CompanyRef>;
    staff: ReadonlyMap<string, StaffRef>;
    viewer: { userId: string; role: string };
  },
): { pending: CorrectionView[]; decided: CorrectionView[] } {
  const staffRole = ctx.viewer.role === "ORGANISER" || ctx.viewer.role === "FAIRNESS";
  const views = rows.map((r): CorrectionView => {
    const own = r.requested_by === ctx.viewer.userId;
    const whyNot =
      r.status !== "PENDING"
        ? null
        : own
          ? "You requested this correction. A second organiser or the fairness officer must approve or reject it."
          : staffRole
            ? null
            : "Only an organiser or the fairness officer can decide a correction.";
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      requestedBy: nameOf(ctx.staff, r.requested_by) ?? "—",
      requestedAt: r.requested_at,
      entries: correctionEntryLines(r.entries, ctx.teams, ctx.companies),
      decidedBy: nameOf(ctx.staff, r.decided_by),
      decidedAt: r.decided_at,
      note: r.decision_note,
      txn: r.applied_txn_id ? shortTxn(r.applied_txn_id) : null,
      canDecide: r.status === "PENDING" && whyNot === null,
      whyNot,
    };
  });
  const time = (s: string | null) => (s ? Date.parse(s) : 0);
  return {
    pending: views.filter((v) => v.status === "PENDING").sort((a, b) => time(a.requestedAt) - time(b.requestedAt)),
    decided: views.filter((v) => v.status !== "PENDING").sort((a, b) => time(b.decidedAt) - time(a.decidedAt)),
  };
}

/** Options for the request form: teams grouped by track (codes in order), companies by ticker. */
export function correctionOptions(teams: readonly TeamRef[], companies: readonly (CompanyRef & { squad_id?: string | null })[]) {
  const byCode = (a: TeamRef, b: TeamRef) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const map = new Map(teams.map((t) => [t.id, t]));
  return {
    tracks: (["PRODUCT", "CONSULTING", "FINANCE"] as const).map((track) => ({
      track,
      teams: teams.filter((t) => t.track === track).sort(byCode).map((t) => ({ id: t.id, code: t.code })),
    })),
    // Only companies that belong to a squad can be corrected (the game function checks it again).
    companies: companies
      .filter((c) => c.squad_id !== null)
      .map((c) => ({ id: c.id, label: companyLabel(c, map) }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    lots: [...LOT_TYPES],
  };
}
