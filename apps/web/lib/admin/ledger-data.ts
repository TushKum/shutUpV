// Reads what the ledger view needs, as the signed-in staff member (staff read every table of the event through RLS).
// PostgREST returns at most 1,000 rows per request, so whole tables are read in pages.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cashSnapshot,
  checkBooks,
  paging,
  type BooksResult,
  type BooksRow,
  type BooksTeam,
  type CompanyRef,
  type LedgerRow,
  type Paging,
  type ResolvedFilter,
  type RoundRef,
  type TeamRef,
} from "./ledger";
import type { CorrectionRow, StaffRef } from "./ledger-corrections";

export const ROWS_PER_REQUEST = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Every row of a query, `size` rows per request, requests made `parallel` at a time once the count is known. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { total?: number; size?: number; parallel?: number } = {},
): Promise<T[]> {
  const size = opts.size ?? ROWS_PER_REQUEST;
  if (opts.total !== undefined) {
    const starts = Array.from({ length: Math.ceil(opts.total / size) }, (_, i) => i * size);
    const out: T[] = [];
    const parallel = opts.parallel ?? 4;
    for (let i = 0; i < starts.length; i += parallel) {
      const batch = await Promise.all(starts.slice(i, i + parallel).map((from) => page(from, from + size - 1)));
      for (const r of batch) {
        if (r.error) throw new Error(r.error.message);
        out.push(...(r.data ?? []));
      }
    }
    // Rows added since the count was taken: keep reading until a short page.
    for (let from = starts.length * size; ; from += size) {
      const r = await page(from, from + size - 1);
      if (r.error) throw new Error(r.error.message);
      out.push(...(r.data ?? []));
      if ((r.data ?? []).length < size) return out;
    }
  }
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const r = await page(from, from + size - 1);
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < size) return out;
  }
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export interface LedgerTeam extends TeamRef {
  cash_cents: number | string;
  collateral_cents: number | string;
  disqualified: boolean;
  disqualified_reason: string | null;
}

export interface LedgerCompany extends CompanyRef {
  squad_id: string | null;
}

export interface LedgerBase {
  teams: LedgerTeam[];
  companies: LedgerCompany[];
  rounds: RoundRef[];
}

/** The event's teams (with their cash), companies and rounds: what turns ids into codes, tickers and numbers. */
export async function loadLedgerBase(sb: SupabaseClient, eventId: string): Promise<LedgerBase> {
  const [teams, companies, rounds] = await Promise.all([
    sb
      .from("teams")
      .select("id, code, track, name, cash_cents, collateral_cents, disqualified, disqualified_reason")
      .eq("event_id", eventId)
      .order("code")
      .then((r) => must(r, "teams") as LedgerTeam[]),
    sb
      .from("companies")
      .select("id, ticker, product_team_id, squad_id")
      .eq("event_id", eventId)
      .order("ticker")
      .then((r) => must(r, "companies") as LedgerCompany[]),
    sb
      .from("rounds")
      .select("id, number")
      .eq("event_id", eventId)
      .order("number")
      .then((r) => must(r, "rounds") as RoundRef[]),
  ]);
  return { teams, companies, rounds };
}

export const LEDGER_COLUMNS = "id, created_at, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, round_id, memo";

/** One page of the ledger, newest first, with the filter applied. */
export async function loadLedgerPage(sb: SupabaseClient, eventId: string, f: ResolvedFilter, page: number): Promise<{ rows: LedgerRow[]; paging: Paging }> {
  let counted = sb.from("ledger_entries").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  let rows = sb.from("ledger_entries").select(LEDGER_COLUMNS).eq("event_id", eventId);
  if (f.teamId) {
    counted = counted.eq("team_id", f.teamId);
    rows = rows.eq("team_id", f.teamId);
  }
  if (f.exchange) {
    counted = counted.is("team_id", null);
    rows = rows.is("team_id", null);
  }
  if (f.kind) {
    counted = counted.eq("kind", f.kind);
    rows = rows.eq("kind", f.kind);
  }
  if (f.companyId) {
    counted = counted.eq("company_id", f.companyId);
    rows = rows.eq("company_id", f.companyId);
  }
  const c = await counted;
  if (c.error) throw new Error(`ledger count: ${c.error.message}`);
  const p = paging(c.count ?? 0, page);
  if ((c.count ?? 0) === 0) return { rows: [], paging: p };
  const r = await rows.order("id", { ascending: false }).range(p.from, p.to);
  return { rows: must(r, "ledger") as unknown as LedgerRow[], paging: p };
}

async function readCash(sb: SupabaseClient, eventId: string): Promise<{ teams: BooksTeam[]; exchange: number | string }> {
  const [teams, event] = await Promise.all([
    sb
      .from("teams")
      .select("id, code, cash_cents")
      .eq("event_id", eventId)
      .then((r) => must(r, "teams") as BooksTeam[]),
    sb
      .from("events")
      .select("exchange_cash_cents")
      .eq("id", eventId)
      .single<{ exchange_cash_cents: number | string }>()
      .then((r) => must(r, "event")),
  ]);
  return { teams, exchange: event.exchange_cash_cents };
}

export type BooksStatus = BooksResult | { ok: null; message: string };

/**
 * The books check over every ledger row of the event. The cash is read before and after the rows; if a transaction
 * committed in between (the snapshots differ), the read is repeated, up to three times.
 */
export async function loadBooks(sb: SupabaseClient, eventId: string, companies: readonly CompanyRef[]): Promise<BooksStatus> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readCash(sb, eventId);
    const counted = await sb.from("ledger_entries").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    if (counted.error) throw new Error(`ledger count: ${counted.error.message}`);
    const rows = await fetchAll<BooksRow>(
      (from, to) =>
        sb
          .from("ledger_entries")
          .select("txn_id, kind, team_id, company_id, cash_delta_cents, share_delta")
          .eq("event_id", eventId)
          .order("id")
          .range(from, to),
      { total: counted.count ?? 0 },
    );
    const after = await readCash(sb, eventId);
    if (cashSnapshot(before.teams, before.exchange) === cashSnapshot(after.teams, after.exchange)) {
      return checkBooks(rows, after.teams, after.exchange, companies);
    }
  }
  return { ok: null, message: "The books changed while they were being checked (three times in a row); the check runs again on the next update." };
}

/** Every correction of the event and the staff accounts (to name who requested and decided). */
export async function loadCorrections(sb: SupabaseClient, eventId: string): Promise<{ corrections: CorrectionRow[]; staff: StaffRef[] }> {
  const [corrections, staff] = await Promise.all([
    fetchAll<CorrectionRow>((from, to) =>
      sb
        .from("corrections")
        .select("id, requested_by, requested_at, reason, entries, status, decided_by, decided_at, decision_note, applied_txn_id")
        .eq("event_id", eventId)
        .order("requested_at", { ascending: false })
        .range(from, to),
    ),
    loadStaff(sb),
  ]);
  return { corrections, staff };
}

export async function loadStaff(sb: SupabaseClient): Promise<StaffRef[]> {
  const r = await sb.from("accounts").select("user_id, display_name, role").in("role", ["ORGANISER", "FAIRNESS"]);
  return must(r, "accounts") as StaffRef[];
}
