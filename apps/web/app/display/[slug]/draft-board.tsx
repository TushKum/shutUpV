// The Round 3 draft on the big screen, while it runs: whose pick it is (with its 20 seconds), every statement with the
// companies on it, and the picks still to come. Public data only (tickers, never team names). It replaces the board,
// and any results screen still showing, until every company has its statement.

import { Countdown } from "@/components/ui/countdown";
import { supabaseServer } from "@/lib/supabase/server";
import { TakeoverFrame } from "./takeovers/frame";

interface Pick {
  company_id: string;
  pick_no: number;
  opens_at: string;
  closes_at: string;
  statement_id: string | null;
  by_default: boolean;
}

export interface DraftBoardData {
  picks: Pick[];
  statements: { id: string; number: number; title: string; cap: number; sector: string | null }[];
  tickers: Map<string, string>;
  /** Each company's sector (an event split across sectors), by company id. */
  sectors: Map<string, string>;
}

/** The draft, when one is under way in this event (some company still to pick); null otherwise. */
export async function loadLiveDraft(eventId: string): Promise<DraftBoardData | null> {
  const sb = await supabaseServer();
  const { data: picks } = await sb
    .from("draft_picks")
    .select("company_id, pick_no, opens_at, closes_at, statement_id, by_default")
    .eq("event_id", eventId)
    .order("pick_no");
  const rows = (picks ?? []) as Pick[];
  if (rows.length === 0 || rows.every((p) => p.statement_id !== null)) return null;
  const [st, co, sec] = await Promise.all([
    sb.from("problem_statements").select("id, number, title, cap, sector").eq("event_id", eventId).order("number"),
    sb.from("companies").select("id, ticker").eq("event_id", eventId),
    // The display account may not read the squads' problem cards: the draft's sectors come from draft_sectors.
    sb.rpc("draft_sectors", { p_event: eventId }),
  ]);
  const companies = (co.data ?? []) as { id: string; ticker: string | null }[];
  return {
    picks: rows,
    statements: (st.data ?? []) as DraftBoardData["statements"],
    tickers: new Map(companies.map((c) => [c.id, c.ticker ?? "—"])),
    sectors: new Map(((sec.data ?? []) as { company_id: string; sector: string }[]).map((r) => [r.company_id, r.sector])),
  };
}

export function DraftBoard({ data }: { data: DraftBoardData }) {
  const current = data.picks.find((p) => p.statement_id === null)!;
  const left = data.picks.filter((p) => p.statement_id === null);
  const done = data.picks.length - left.length;
  // Split across sectors: the room sees the statements of the sector whose company is on the clock.
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const sector = data.statements.some((s) => s.sector) ? (data.sectors.get(current.company_id) ?? "") : "";
  const shown = sector ? data.statements.filter((s) => norm(s.sector) === norm(sector)) : data.statements;
  return (
    <TakeoverFrame title="Round 3 · the draft" at={data.picks[0]!.opens_at} until={null} tone="bg-[var(--term-amber,#ffa028)] text-ink">
      <div className="flex h-full flex-col gap-6" data-testid="display-draft">
        <div className="flex shrink-0 items-end justify-between gap-10">
          <div>
            <p className="text-[32px] font-bold uppercase tracking-widest text-muted">
              On the clock · pick {current.pick_no} of {data.picks.length}
              {sector ? <span className="text-warn"> · {sector}</span> : null}
            </p>
            <p className="text-[110px] font-black leading-none text-phosphor" data-testid="display-draft-current">
              {data.tickers.get(current.company_id)}
            </p>
          </div>
          <p className="text-right font-mono text-[120px] font-black leading-none tabular-nums text-warn">
            <Countdown to={current.closes_at} passed="0:00" />
          </p>
        </div>
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-5 overflow-hidden">
          {shown.map((s) => {
            const on = data.picks.filter((p) => p.statement_id === s.id);
            const full = on.length >= s.cap;
            return (
              <li key={s.id} className={`border-2 px-4 py-2.5 ${full ? "border-danger" : "border-line"}`} data-testid={`display-statement-${s.number}`}>
                <p className="flex items-baseline gap-4 text-[30px] font-bold leading-tight">
                  <span className="font-mono text-warn">#{s.number}</span>
                  <span className="min-w-0 flex-1 truncate text-paper">{s.title}</span>

                  <span className={`font-mono text-[28px] ${full ? "text-danger" : "text-muted"}`}>
                    {on.length}/{s.cap}
                  </span>
                </p>
                <p className="mt-1.5 flex min-h-[40px] flex-wrap gap-3">
                  {on.map((p) => (
                    <span key={p.company_id} className={`px-3 py-1 font-mono text-[28px] font-bold ${p.by_default ? "bg-raised text-muted" : "bg-phosphor text-ink"}`}>
                      {data.tickers.get(p.company_id)}
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="shrink-0 truncate text-[30px] text-muted">
          {done} picked · still to pick: <span className="font-mono text-paper">{left.map((p) => data.tickers.get(p.company_id)).join("  ")}</span>
        </p>
      </div>
    </TakeoverFrame>
  );
}
