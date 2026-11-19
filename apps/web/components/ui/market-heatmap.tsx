"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";
import { bp } from "@/lib/format";

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

export function HeatmapTiles({ quotes, selected, onSelect }: {
  quotes: readonly HeatmapQuote[];
  selected?: string;
  onSelect?: (ticker: string) => void;
}) {
  return (
    <div className="space-y-3">
      <ul aria-label="Price change legend" className="flex flex-wrap gap-1.5">
        {bands.map(({ label, tone }) => (
          <li key={label} className={`rounded border px-2 py-1 font-mono text-xs text-white ${tone}`}>{label}</li>
        ))}
      </ul>
      {quotes.length ? (
        <ul aria-label="Market heatmap" className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {quotes.map((quote) => {
            const active = quote.ticker === selected;
            const tileClass = `flex h-full min-h-24 w-full flex-col rounded-md border-t-2 px-3 py-2 text-left text-white hover:brightness-125 focus-visible:outline-offset-2 ${bandFor(quote.moveBp).tone} ${active ? "ring-2 ring-inset ring-white" : ""}`;
            const content = (
              <>
                <span className="flex flex-wrap justify-between gap-x-2">
                  <span className="font-mono text-sm font-semibold">{quote.ticker}</span>
                  {quote.tag && <span className="text-xs text-white/90">{quote.tag}</span>}
                </span>
                <span className="w-full truncate text-xs text-white/90" title={quote.name}>{quote.name}</span>
                <span className="mt-auto flex flex-wrap justify-between gap-x-1 pt-2 font-mono text-xs font-semibold tabular-nums sm:text-sm">
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
                  <button type="button" aria-pressed={active} onClick={() => onSelect?.(quote.ticker)} className={tileClass}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="py-2 text-sm text-muted">No companies match your search.</p>}
    </div>
  );
}

export function MarketHeatmap({ quotes, selected, onSelect }: {
  quotes: readonly HeatmapQuote[];
  selected?: string;
  onSelect?: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = quotes.filter(({ ticker, name }) => `${ticker} ${name}`.toLowerCase().includes(needle));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search ticker or company"
            placeholder="Search ticker or company"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-md border border-line bg-ink py-2 pr-3 pl-9 text-sm text-paper"
          />
        </label>
        <span className="font-mono text-xs text-muted" role="status">{matches.length} / {quotes.length}</span>
      </div>
      <HeatmapTiles quotes={matches} selected={selected} onSelect={onSelect} />
    </div>
  );
}
