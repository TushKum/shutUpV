// Reads the public ledger as the signed-in team (public to the event), a page at a time, with the filter applied,
// and the companies that name its rows (readable from Reading; before that, only the team's own squad company).

import { supabaseServer } from "@/lib/supabase/server";
import { pageOf, type CompanyRef, type Paging, type PublicFilter, type PublicLedgerRow } from "./public-ledger";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

const COLUMNS = "id, created_at, kind, label, company_id, ticker, cash_cents, shares, price_cents, round_number, details";

export async function loadLedgerCompanies(eventId: string): Promise<CompanyRef[]> {
  const sb = await supabaseServer();
  return must(await sb.from("companies").select("id, ticker").eq("event_id", eventId).order("ticker"), "the companies") as CompanyRef[];
}

export async function loadPublicLedgerPage(eventId: string, f: PublicFilter, page: number): Promise<{ rows: PublicLedgerRow[]; paging: Paging }> {
  const sb = await supabaseServer();
  let counted = sb.from("public_ledger").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  let rows = sb.from("public_ledger").select(COLUMNS).eq("event_id", eventId);
  if (f.companyId) {
    counted = counted.eq("company_id", f.companyId);
    rows = rows.eq("company_id", f.companyId);
  }
  if (f.kind) {
    counted = counted.eq("kind", f.kind);
    rows = rows.eq("kind", f.kind);
  }
  const c = await counted;
  if (c.error) throw new Error(`Could not count the public ledger: ${c.error.message}`);
  const paging = pageOf(c.count ?? 0, page);
  if (!c.count) return { rows: [], paging };
  const r = must(await rows.order("id", { ascending: false }).range(paging.from, paging.to), "the public ledger");
  return { rows: r as unknown as PublicLedgerRow[], paging };
}
