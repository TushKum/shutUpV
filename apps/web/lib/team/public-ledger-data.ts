// Reads the public ledger as the signed-in team (public to the event), a page at a time, with the filter applied,
// and the companies that name its rows.

import { supabaseServer } from "@/lib/supabase/server";
import { pageOf, type CompanyRef, type Paging, type PublicFilter, type PublicLedgerRow } from "./public-ledger";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

const COLUMNS = "id, created_at, kind, label, team_code, company_id, ticker, side, cash_cents, shares, price_cents, round_number, details";

export async function loadLedgerCompanies(eventId: string): Promise<CompanyRef[]> {
  const sb = await supabaseServer();
  const rows = must(await sb.from("companies").select("id, ticker").eq("event_id", eventId).order("ticker"), "the companies") as CompanyRef[];
  return rows.filter((c) => c.ticker !== null);
}

export async function loadPublicLedgerPage(eventId: string, f: PublicFilter, page: number): Promise<{ rows: PublicLedgerRow[]; paging: Paging }> {
  const sb = await supabaseServer();
  let counted = sb.from("public_ledger").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  let rows = sb.from("public_ledger").select(COLUMNS).eq("event_id", eventId);
  const eq = (col: string, v: string | null) => {
    if (v === null) return;
    counted = counted.eq(col, v);
    rows = rows.eq(col, v);
  };
  eq("company_id", f.companyId);
  eq("team_code", f.team);
  eq("kind", f.kind);
  eq("side", f.side);
  const c = await counted;
  if (c.error) throw new Error(`Could not count the public ledger: ${c.error.message}`);
  const paging = pageOf(c.count ?? 0, page);
  if (!c.count) return { rows: [], paging };
  const r = must(await rows.order("id", { ascending: false }).range(paging.from, paging.to), "the public ledger");
  return { rows: r as unknown as PublicLedgerRow[], paging };
}
