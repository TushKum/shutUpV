"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";
import { bp } from "@/lib/format";
import "./market-board.css";

export interface HeatmapQuote {
  ticker: string;
  name: string;
  price: string;
  moveBp: number | null;
  tag?: string;
  href?: string;
}

const bands = [
  { label: "Above +5%", tone: "bg-[#08604c] border-[#53d6b4]" },
  { label: "+2% to +5%", tone: "bg-[#145340] border-[#49ae91]" },
  { label: "0% to +2%", tone: "bg-[#153f36] border-[#378073]" },
  { label: "0%", tone: "bg-[#303844] border-[#697382]" },
  { label: "0% to −2%", tone: "bg-[#543039] border-[#b66b73]" },
  { label: "−2% to −5%", tone: "bg-[#682b38] border-[#d47183]" },
  { label: "Below −5%", tone: "bg-[#7f2538] border-[#f08799]" },
  { label: "No data", tone: "bg-[#22272d] border-[#4d5663]" },
] as const;

function bandFor(move: number | null) {
  if (move === null) return bands[7];
  if (move > 500) return bands[0];
  if (move >= 200) return bands[1];
  if (move > 0) return bands[2];
  if (move === 0) return bands[3];
  if (move > -200) return bands[4];
  return move >= -500 ? bands[5] : bands[6];
}

const PAGE_SIZE = 50;

export function HeatmapTiles({ quotes, selected, onSelect, opensDialog = false }: {
  quotes: readonly HeatmapQuote[];
  selected?: string;
  onSelect?: (ticker: string) => void;
  opensDialog?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(quotes.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const visible = quotes.slice(start, start + PAGE_SIZE);

  return (
    <div className="market-type @container space-y-3">
      <ul aria-label="Price change legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-paper">
        {bands.map(({ label, tone }) => (
          <li key={label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2.5 rounded-sm border ${tone}`} />
            {label}
          </li>
        ))}
      </ul>
      {quotes.length ? (
        <ul aria-label="Market heatmap" className="grid grid-cols-2 gap-1.5 @min-[650px]:grid-cols-5 @min-[1080px]:grid-cols-10">
          {visible.map((quote) => {
            const active = quote.ticker === selected;
            const tileClass = `flex h-full min-h-22 w-full cursor-pointer flex-col rounded-md border-t px-2.5 py-2 text-left text-white hover:brightness-110 focus-visible:outline-offset-2 ${bandFor(quote.moveBp).tone} ${active ? "ring-2 ring-inset ring-[color:var(--heatmap-selection,white)]" : ""}`;
            const content = (
              <>
                <span className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-sm font-semibold">{quote.ticker}</span>
                  {quote.tag && <span className="text-xs text-white/90">{quote.tag}</span>}
                </span>
                <span className="w-full truncate text-xs text-white/90" title={quote.name}>{quote.name}</span>
                <span className="mt-auto flex flex-wrap justify-between gap-x-2 pt-2 text-xs font-semibold tabular-nums">
                  <span>{quote.price}</span>
                  <span>{bp(quote.moveBp)}</span>
                </span>
              </>
            );
            return (
              <li key={quote.ticker} className="min-w-0">
                {quote.href ? (
                  <Link href={quote.href} prefetch={false} className={tileClass}>{content}</Link>
                ) : (
                  <button type="button" aria-pressed={active} aria-haspopup={opensDialog ? "dialog" : undefined} onClick={() => onSelect?.(quote.ticker)} className={tileClass}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="py-2 text-sm text-muted">No companies match your search.</p>}
      {pageCount > 1 && (
        <nav aria-label="Heatmap pages" className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <span role="status" className="mr-auto text-xs text-paper tabular-nums">
            {start + 1}–{start + visible.length} of {quotes.length}
          </span>
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}
            className="min-h-11 cursor-pointer rounded border border-line px-3 text-paper hover:bg-raised disabled:cursor-default disabled:opacity-50">Previous</button>
          <button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}
            className="min-h-11 cursor-pointer rounded border border-line px-3 text-paper hover:bg-raised disabled:cursor-default disabled:opacity-50">Next</button>
        </nav>
      )}
    </div>
  );
}

export function MarketHeatmap({ quotes, selected, onSelect, opensDialog }: {
  quotes: readonly HeatmapQuote[];
  selected?: string;
  onSelect?: (ticker: string) => void;
  opensDialog?: boolean;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = quotes.filter(({ ticker, name }) => `${ticker} ${name}`.toLowerCase().includes(needle));

  return (
    <div className="market-type space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium text-paper">Search ticker or company</span>
          <Search aria-hidden="true" className="pointer-events-none absolute bottom-3.5 left-3 size-4 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 w-full rounded-md border border-line bg-ink py-2 pr-3 pl-9 text-sm text-paper"
          />
        </label>
        <span className="self-end pb-3 text-xs text-muted tabular-nums" role="status">{matches.length} / {quotes.length}</span>
      </div>
      <HeatmapTiles key={needle} quotes={matches} selected={selected} onSelect={onSelect} opensDialog={opensDialog} />
    </div>
  );
}
