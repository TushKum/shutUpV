"use client";

// The board's tiles, 25 to a page (5 × 5), a new page every 20 seconds by the server clock: every projector shows the
// same page, and a reload carries on where the screen was. The first render (on the server and while hydrating) uses
// the time the server rendered at, so both agree. Tiles that moved in a round that has just cleared light up briefly.

import { useSyncExternalStore } from "react";
import { useServerNow } from "@/lib/live/clock";
import { bp, money } from "@/lib/format";
import {
  MOVE_ARROWS,
  MOVE_TONE,
  pageCount,
  pageIndex,
  pageOf,
  priceRowFit,
  toneOf,
  type BoardTile,
  type Move,
  type PriceRowFit,
} from "@/lib/display/board";

const TEXT = { up: "text-emerald-400", down: "text-red-500", flat: "text-slate-400" } as const;
const CHANGE = { up: "text-emerald-400", down: "text-red-500", flat: "text-slate-200" } as const;
const GLOW = { UP: "bg-emerald-500/25 ring-4 ring-emerald-400", DOWN: "bg-red-500/25 ring-4 ring-red-500", FLAT: "" } as const;
const MOVE_WORDS: Record<Move, string> = { UP: "up", DOWN: "down", FLAT: "unchanged" };

const noSubscription = () => () => {};

export function BoardPages({
  tiles,
  round,
  closed,
  serverTime,
  highlightUntil,
}: {
  tiles: BoardTile[];
  /** The last cleared round's number (null before any round has cleared). */
  round: number | null;
  /** The market has closed: the tiles show closing prices. */
  closed: boolean;
  serverTime: string;
  /** Server time (ms) until which the tiles that moved in the last round are highlighted. */
  highlightUntil: number | null;
}) {
  const live = useServerNow(500);
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const now = hydrated ? live : Date.parse(serverTime);
  const pages = pageCount(tiles.length);
  const page = pageIndex(now, pages);
  const glow = highlightUntil !== null && now < highlightUntil;
  const pending = tiles.every((t) => t.price === null);

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-5 grid-rows-5 gap-x-3 gap-y-1.5 px-6 py-2" data-testid="board-page-tiles" data-page={page + 1}>
        {pageOf(tiles, page).map((t) => (
          <Tile key={t.id} tile={t} round={round} glow={glow} />
        ))}
      </div>
      <footer className="flex h-[44px] shrink-0 items-center justify-between gap-8 border-t-2 border-white/15 px-8 text-[28px] text-slate-300">
        <p className="min-w-0 truncate" data-testid="board-legend">
          {pending ? (
            "IPO prices are set when the pitch scores are released."
          ) : (
            <>
              {closed ? <span className="font-bold text-amber-300">Closing prices · </span> : null}
              % change since the IPO price
              {round !== null ? (
                <>
                  {" · "}
                  <span className={TEXT.up}>▲</span> <span className={TEXT.down}>▼</span> <span className={TEXT.flat}>▬</span> round {round}&rsquo;s move
                </>
              ) : null}
            </>
          )}
        </p>
        {pages > 1 ? (
          <p className="shrink-0 font-mono font-bold text-white tabular-nums" data-testid="board-page" aria-label={`Page ${page + 1} of ${pages}`}>
            {page + 1} / {pages}
          </p>
        ) : null}
      </footer>
    </>
  );
}

function Tile({ tile: t, round, glow }: { tile: BoardTile; round: number | null; glow: boolean }) {
  const tone = toneOf(t.changeBp);
  const lit = glow && t.move !== null ? GLOW[t.move] : "";
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col justify-between overflow-hidden rounded-xl border-2 border-white/15 bg-white/[0.06] px-4 py-2 transition-[background-color,box-shadow] duration-1000 ${lit}`}
      data-testid={`tile-${t.ticker}`}
      data-lit={lit ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[52px] leading-none font-black tracking-tight" data-testid="tile-ticker">
          {t.ticker}
        </span>
        {t.move ? (
          <span
            className={`shrink-0 text-[44px] leading-none ${TEXT[MOVE_TONE[t.move]]}`}
            data-testid="tile-move"
            data-move={t.move}
            aria-label={`${MOVE_WORDS[t.move]} in round ${round}`}
          >
            {MOVE_ARROWS[t.move]}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-baseline gap-3">
        <p className="min-w-0 flex-1 truncate text-[28px] leading-[1.2] text-slate-300" data-testid="tile-name">
          {t.name}
        </p>
        {t.closing ? (
          <span className="shrink-0 text-[24px] font-bold tracking-wide text-amber-300 uppercase" data-testid="tile-closing">
            Close
          </span>
        ) : null}
      </div>
      {t.price === null ? (
        <p className="text-[30px] leading-[1.2] font-semibold text-slate-400" data-testid="tile-pending">
          IPO price pending
        </p>
      ) : (
        <PriceRow price={money(t.price)} change={bp(t.changeBp)} tone={tone} />
      )}
    </div>
  );
}

const FIT: Record<PriceRowFit, { price: string; change: string }> = {
  normal: { price: "text-[44px]", change: "text-[34px]" },
  small: { price: "text-[44px]", change: "text-[28px]" },
  smaller: { price: "text-[40px]", change: "text-[26px]" },
};

function PriceRow({ price, change, tone }: { price: string; change: string; tone: "up" | "down" | "flat" }) {
  const fit = FIT[priceRowFit(price, change)];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`shrink-0 leading-none font-bold tabular-nums ${fit.price}`} data-testid="tile-price">
        {price}
      </span>
      <span className={`min-w-0 leading-none font-bold tabular-nums ${fit.change} ${CHANGE[tone]}`} data-testid="tile-change">
        {change}
      </span>
    </div>
  );
}
