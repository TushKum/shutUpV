// Pieces the takeovers share: a hex digest in groups (readable from the back of the hall), a column of movers (the
// verdicts and the closing bell), and the neutral note shown when there is nothing to show yet.

import type { ReactNode } from "react";
import { hexGroups } from "@/lib/display/takeovers";
import { money } from "@/lib/format";

export function HexGroups({ hex, className = "", testId }: { hex: string | null | undefined; className?: string; testId?: string }) {
  return (
    <span className={`font-mono tabular-nums ${className}`} data-testid={testId}>
      {hexGroups(hex).map((g, i) => (
        <span key={i} data-testid={testId ? `${testId}-group` : undefined}>
          {g}
        </span>
      ))}
    </span>
  );
}

/** "$10.50 → $8.93" with the new price stressed in the move's colour. */
export function PriceMove({ before, after, tone, className = "" }: { before: number | null; after: number | null; tone: "up" | "down" | "flat"; className?: string }) {
  const color = tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-white";
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      <span className="text-slate-300">{money(before)}</span>
      <span className="text-slate-400"> → </span>
      <span className={`font-bold ${color}`}>{money(after)}</span>
    </span>
  );
}

export interface MoverRowData {
  key: string;
  ticker: string;
  name: string | null;
  /** The middle and right-hand cells. */
  middle: ReactNode;
  right: ReactNode;
}

export function MoverColumn({
  title,
  tone,
  headers,
  rows,
  empty,
  testId,
}: {
  title: string;
  tone: "up" | "down";
  /** Labels over the company, middle and right-hand cells. */
  headers: [string, string, string];
  rows: MoverRowData[];
  empty: string;
  testId: string;
}) {
  const accent = tone === "up" ? "text-emerald-400 border-emerald-400" : "text-red-400 border-red-400";
  return (
    <section className="flex min-h-0 min-w-0 flex-col" aria-label={title} data-testid={testId}>
      <h2 className={`border-b-4 pb-1 text-[44px] leading-tight font-black ${accent}`}>
        {tone === "up" ? "▲" : "▼"} {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-6 text-[34px] text-slate-300">{empty}</p>
      ) : (
        // One grid for the labels and every row (each row a subgrid), so the columns line up and size to the widest
        // price or change instead of spilling out of a fixed width.
        <div className="mt-2 grid min-h-0 grid-cols-[minmax(0,1fr)_auto_auto] content-start gap-x-8 gap-y-2.5 overflow-hidden">
          <div className="col-span-3 grid grid-cols-subgrid px-5 text-[28px] leading-snug font-semibold tracking-wide text-slate-400 uppercase">
            <span>{headers[0]}</span>
            <span className="text-right">{headers[1]}</span>
            <span className="text-right">{headers[2]}</span>
          </div>
          {rows.map((r) => (
            <div
              key={r.key}
              className="col-span-3 grid grid-cols-subgrid items-center rounded-xl bg-white/[0.06] px-5 py-1.5"
              data-testid={`${testId}-${r.ticker}`}
            >
              <div className="min-w-0">
                <p className="text-[40px] leading-[1.1] font-black">{r.ticker}</p>
                <p className="truncate text-[28px] leading-[1.25] text-slate-300">{r.name ?? "—"}</p>
              </div>
              <div className="text-right whitespace-nowrap">{r.middle}</div>
              <div className="min-w-[9rem] text-right whitespace-nowrap">{r.right}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Neutral({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center" data-testid="takeover-empty">
      <p className="text-center text-[48px] font-bold text-slate-300">{children}</p>
    </div>
  );
}
