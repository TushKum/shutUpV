// The sector race: each sector's average share-price change since the IPO, best first, as bars around a zero line,
// with each sector's best company. Drawn the same on the big screen (size "screen") and on the Market page.

import { pctText, sectorStyle, type SectorStanding } from "@/lib/team/sectors";
import { Glyph } from "@/components/ui/matrix/glyph";

export function SectorRace({ race, size = "page", mine = null }: { race: SectorStanding[]; size?: "page" | "screen"; mine?: string | null }) {
  const max = Math.max(500, ...race.map((r) => Math.abs(r.avgBp)));
  const big = size === "screen";
  return (
    <ol className={big ? "space-y-3" : "space-y-2"} aria-label="Sector race" data-testid="sector-race">
      {race.map((r, i) => {
        const st = sectorStyle(r.sector);
        const w = (Math.abs(r.avgBp) / max) * 50;
        const up = r.avgBp >= 0;
        const isMine = !!mine && mine.trim().toLowerCase() === r.sector.trim().toLowerCase();
        return (
          <li key={r.sector} className={`grid items-center gap-3 ${big ? "grid-cols-[360px_1fr_220px] text-[34px]" : "grid-cols-[minmax(7rem,10rem)_1fr_5.5rem] text-sm"}`} data-testid={`race-${r.sector}`}>
            <span className={`flex min-w-0 items-center gap-2 font-bold ${st.text}`}>
              <span className={`font-mono ${big ? "text-[28px]" : "text-xs"} text-muted`}>{i + 1}.</span>
              <Glyph e={st.icon} />
              <span className="truncate">{r.sector}</span>
              {isMine ? <span className={`rounded px-1.5 ${big ? "text-[20px]" : "text-[10px]"} ${st.chip}`}>YOU</span> : null}
            </span>
            {/* A zero line in the middle: rises grow right, falls grow left. */}
            <span className={`relative block ${big ? "h-10" : "h-4"} rounded bg-raised`} aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-muted" />
              <span
                className={`absolute inset-y-0 rounded ${up ? "left-1/2" : "right-1/2"} ${up ? st.chip.split(" ")[0] : "bg-danger"}`}
                style={{ width: `${w}%` }}
              />
            </span>
            <span className={`text-right font-mono font-extrabold tabular-nums ${up ? "text-phosphor" : "text-danger-soft"}`}>{pctText(r.avgBp)}</span>
            <span className={`col-span-3 -mt-1 ${big ? "pl-[52px] text-[24px]" : "pl-6 text-xs"} text-muted`}>
              {r.companies} {r.companies === 1 ? "company" : "companies"}
              {r.best ? (
                <>
                  {" "}
                  · best <span className="font-mono font-bold text-paper">{r.best.ticker}</span> {pctText(r.best.bp)}
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
