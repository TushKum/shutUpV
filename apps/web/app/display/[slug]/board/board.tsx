// The ticker board under the header and the bulletin banner: every listed company's ticker, name, price, change since
// the IPO price and the last cleared round's move, 25 tiles to a page (BoardPages). Before READING no company is
// public yet, so it says when they will be listed. A clearing broadcasts on the event channel and the page re-reads
// itself, so the board is always the latest clearing.

import { phaseReached } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { boardTiles, highlightUntil } from "@/lib/display/board";
import { clock } from "@/lib/format";
import { loadBoard, loadReadingStart } from "./data";
import { BoardPages } from "./pages";
import { marketPulse, MOODS } from "@/lib/team/pulse";
import { count } from "@/lib/format";
import { Glyph } from "@/components/ui/matrix";
import { loadSectorRace } from "@/lib/team/sectors-data";
import { pctText, sectorStyle } from "@/lib/team/sectors";

export async function Board({ event, status, compact = false }: { event: DisplayEvent; status: EventStatus; compact?: boolean }) {
  if (!phaseReached(status.phase, "READING")) {
    const reading = await loadReadingStart(event.id);
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-24 text-center" data-testid="board">
        <div className="mx-panel glow-box flex flex-col gap-8 rounded-2xl px-16 py-12">
        <p className="text-[56px] leading-tight font-bold" data-testid="board-waiting">
          Companies are listed here from the Reading phase.
        </p>
        {reading ? (
          <p className="text-[40px] text-muted" data-testid="board-reading">
            Reading is planned to start at <span className="font-mono font-bold text-phosphor tabular-nums">{clock(reading)}</span>
          </p>
        ) : null}
        </div>
      </div>
    );
  }

  const [{ companies, round }, race] = await Promise.all([loadBoard(event.id), loadSectorRace(event.id)]);
  const tiles = boardTiles(companies, round?.round_prices ?? [], event.market_closed_at !== null);
  if (tiles.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" data-testid="board">
        <p className="mx-panel rounded-2xl px-16 py-10 text-[48px] font-bold text-muted">No companies are listed.</p>
      </div>
    );
  }
  // The last round's headline for the room: the biggest riser and faller and the most-traded company.
  const byId = new Map(companies.map((c) => [c.id, c]));
  const pulse = round
    ? marketPulse(
        round.number,
        round.round_prices.map((p) => ({
          ticker: byId.get(p.company_id)?.ticker ?? null,
          name: byId.get(p.company_id)?.name ?? null,
          before: p.market_before === null ? null : Number(p.market_before),
          after: Number(p.market_after),
          volume: Number(p.buy_qty ?? 0) + Number(p.sell_qty ?? 0) + Number(p.short_qty ?? 0) + Number(p.cover_qty ?? 0),
        })),
      )
    : null;
  const pct = (bp: number) => `${bp > 0 ? "+" : "−"}${(Math.abs(bp) / 100).toFixed(2)}%`;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board">
      {pulse && !event.market_closed_at && (pulse.riser || pulse.faller || pulse.busiest) ? (
        <p className="mx-6 mt-3 flex shrink-0 flex-wrap items-center gap-x-10 gap-y-1 rounded-xl border border-phosphor-dim px-6 py-2 font-mono text-[28px] leading-tight" data-testid="board-pulse">
          <span className="font-bold text-muted">ROUND {pulse.round} PULSE</span>
          {pulse.riser ? (
            <span>
              <Glyph e="📈" /> <span className="font-bold text-phosphor">{pulse.riser.ticker}</span> <span className="text-phosphor glow">{pct(pulse.riser.changeBp)}</span>
            </span>
          ) : null}
          {pulse.faller ? (
            <span>
              <Glyph e="📉" /> <span className="font-bold text-phosphor">{pulse.faller.ticker}</span> <span className="text-danger-soft">{pct(pulse.faller.changeBp)}</span>
            </span>
          ) : null}
          {pulse.busiest ? (
            <span>
              <Glyph e="🔥" /> <span className="font-bold text-phosphor">{pulse.busiest.ticker}</span> {count(pulse.busiest.volume)} shares
            </span>
          ) : null}
          <span className="text-paper">
            <Glyph e={MOODS[pulse.mood].icon} /> {MOODS[pulse.mood].label}
          </span>
        </p>
      ) : null}
      {race ? (
        // The sector race in one line: each sector's average change since the IPO, best first.
        <p className="mx-6 mt-3 flex shrink-0 flex-wrap items-center gap-x-10 gap-y-1 rounded-xl border border-line px-6 py-2 text-[28px] leading-tight" data-testid="board-race">
          <span className="font-mono font-bold text-muted">SECTOR RACE</span>
          {race.map((r, i) => (
            <span key={r.sector} className={`font-bold ${sectorStyle(r.sector).text}`}>
              <span className="font-mono text-muted">{i + 1}.</span> <Glyph e={sectorStyle(r.sector).icon} /> {r.sector}{" "}
              <span className={`font-mono ${r.avgBp >= 0 ? "text-phosphor" : "text-danger-soft"}`}>{pctText(r.avgBp)}</span>
            </span>
          ))}
        </p>
      ) : null}
      <BoardPages
        tiles={tiles}
        round={round?.number ?? null}
        closed={tiles.some((t) => t.closing)}
        serverTime={status.server_time}
        highlightUntil={highlightUntil(round?.cleared_at)}
        compact={compact}
      />
    </div>
  );
}
