// 23:30 the PRD reveal: every company's starting price is set by its PRD score ($10.00 + $0.10 × (score − 50)). How
// many companies are listed, the range of starting prices and the top 5 PRDs with score and price. Revealed scores
// and company names are public; no team appears.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { competitionRanks, prdSummary, type PrdRow } from "@/lib/display/takeovers";
import { count, money } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCompanies, loadRevealedScores } from "./data";
import { Neutral } from "./parts";

const COLS = "grid-cols-[4rem_minmax(0,1fr)_12rem_16rem]";

export async function PricesTakeover({ event, takeover }: TakeoverProps) {
  const [companies, scores] = await Promise.all([loadCompanies(event.id), loadRevealedScores(event.id, "PRD")]);
  const rows: (PrdRow & { id: string })[] = companies.map((c) => ({ id: c.id, ticker: c.ticker, name: c.name, score: scores.get(c.id) ?? null, startPrice: c.start_price }));
  const s = prdSummary(rows);
  const ranks = competitionRanks(s.top.map((r) => r.score));
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.PRICES} at={takeover.at} until={takeover.until} tone="bg-sky-400 text-black">
      {s.listed === 0 ? (
        <Neutral>The starting prices will appear here.</Neutral>
      ) : (
        <div className="flex h-full flex-col gap-8">
          <div className="grid shrink-0 grid-cols-2 gap-8">
            <div className="rounded-2xl bg-white/[0.06] px-8 py-5" data-testid="prices-listed">
              <p className="text-[30px] font-semibold tracking-wide text-slate-400 uppercase">Companies listed</p>
              <p className="text-[72px] leading-tight font-black tabular-nums">{count(s.listed)}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.06] px-8 py-5" data-testid="prices-range">
              <p className="text-[30px] font-semibold tracking-wide text-slate-400 uppercase">Starting prices</p>
              <p className="text-[72px] leading-tight font-black tabular-nums">{s.low === s.high ? money(s.low) : `${money(s.low)} – ${money(s.high)}`}</p>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col" aria-label="Top 5 PRDs" data-testid="prices-top">
            <h2 className="border-b-4 border-sky-400 pb-2 text-[44px] leading-tight font-black text-sky-300">Top 5 PRDs</h2>
            <div className={`mt-3 grid ${COLS} gap-6 px-5 text-[28px] font-semibold tracking-wide text-slate-400 uppercase`}>
              <span>#</span>
              <span>Company</span>
              <span className="text-right">Score</span>
              <span className="text-right">Starts at</span>
            </div>
            <ol className="mt-2 flex min-h-0 flex-col gap-3 overflow-hidden">
              {s.top.map((r, i) => (
                <li key={r.id} className={`grid ${COLS} items-center gap-6 rounded-xl bg-white/[0.06] px-5 py-1.5`} data-testid={`prices-top-${r.ticker}`}>
                  <span className="text-[40px] font-black text-slate-400 tabular-nums">{ranks[i]}</span>
                  <p className="min-w-0 truncate text-[40px] leading-tight">
                    <b className="font-black">{r.ticker}</b> <span className="text-[32px] text-slate-300">{r.name ?? ""}</span>
                  </p>
                  <span className="text-right text-[40px] font-bold tabular-nums">{r.score ?? "—"}</span>
                  <span className="text-right text-[48px] font-black text-sky-300 tabular-nums">{money(r.startPrice)}</span>
                </li>
              ))}
            </ol>
            {s.moreTied > 0 ? (
              <p className="mt-2 px-5 text-[30px] text-slate-300" data-testid="prices-more-tied">
                and {s.moreTied} more with the same score
              </p>
            ) : null}
            <p className="mt-auto pt-4 text-[30px] text-slate-300">Starting price = $10.00 + $0.10 × (PRD score − 50). The crisis comes next.</p>
          </section>
        </div>
      )}
    </TakeoverFrame>
  );
}
