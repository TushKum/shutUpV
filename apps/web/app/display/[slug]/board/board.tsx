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

export async function Board({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  if (!phaseReached(status.phase, "READING")) {
    const reading = await loadReadingStart(event.id);
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-24 text-center" data-testid="board">
        <p className="text-[56px] leading-tight font-bold" data-testid="board-waiting">
          Companies are listed here from the Reading phase.
        </p>
        {reading ? (
          <p className="text-[40px] text-slate-300" data-testid="board-reading">
            Reading is planned to start at <span className="font-mono font-bold text-white tabular-nums">{clock(reading)}</span>
          </p>
        ) : null}
      </div>
    );
  }

  const { companies, round } = await loadBoard(event.id);
  const tiles = boardTiles(companies, round?.round_prices ?? [], event.market_closed_at !== null);
  if (tiles.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" data-testid="board">
        <p className="text-[48px] font-bold text-slate-300">No companies are listed.</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board">
      <BoardPages
        tiles={tiles}
        round={round?.number ?? null}
        closed={tiles.some((t) => t.closing)}
        serverTime={status.server_time}
        highlightUntil={highlightUntil(round?.cleared_at)}
      />
    </div>
  );
}
