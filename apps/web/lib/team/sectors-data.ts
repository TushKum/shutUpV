// The sector race's rows, read through company_sectors (public from READING) and the companies' public prices.
import { supabaseServer } from "@/lib/supabase/server";
import { sectorRace, type SectorStanding } from "./sectors";

export async function loadSectorRace(eventId: string): Promise<SectorStanding[] | null> {
  const sb = await supabaseServer();
  const [sec, co] = await Promise.all([
    sb.rpc("company_sectors", { p_event: eventId }),
    sb.from("companies").select("id, ticker, ipo_price, market_price, closing_price").eq("event_id", eventId).not("ticker", "is", null),
  ]);
  if (sec.error || co.error) return null; // an older database: no race rather than a broken page
  const sector = new Map(((sec.data ?? []) as { company_id: string; sector: string }[]).map((r) => [r.company_id, r.sector]));
  return sectorRace(
    ((co.data ?? []) as { id: string; ticker: string; ipo_price: number | null; market_price: number | null; closing_price: number | null }[]).map((c) => ({
      ticker: c.ticker,
      sector: sector.get(c.id) ?? "",
      ipo: c.ipo_price === null ? null : Number(c.ipo_price),
      price: c.closing_price !== null ? Number(c.closing_price) : c.market_price !== null ? Number(c.market_price) : null,
    })),
  );
}
