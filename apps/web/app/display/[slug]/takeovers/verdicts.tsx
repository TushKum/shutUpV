// A verdict release: the scores just released and what they did to prices. The pitch release sets the IPO prices
// (how many companies are listed, the range, the five highest); the plan and flash releases move every price by the
// company's tier (the top five risers and fallers with score, tier and price before → after). Released scores and
// company names are public; no team appears.

import { VERDICT_TITLES, TAKEOVER_TITLES, type VerdictType } from "@/lib/display/takeover";
import { competitionRanks, pitchSummary, verdictMovers, type PitchRow, type VerdictRow } from "@/lib/display/takeovers";
import { bp, count, money } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCompanies, loadPriceMoves, loadReleasedScores } from "./data";
import { MoverColumn, Neutral, PriceMove, type MoverRowData } from "./parts";

export async function VerdictsTakeover({ event, takeover }: TakeoverProps) {
  const type: VerdictType = takeover.type ?? "PITCH";
  const title = VERDICT_TITLES[type] ?? TAKEOVER_TITLES.VERDICTS;
  return (
    <TakeoverFrame title={title} at={takeover.at} until={takeover.until} tone="bg-sky-400 text-black">
      {type === "PITCH" ? <PitchVerdicts eventId={event.id} /> : <TierVerdicts eventId={event.id} type={type} />}
    </TakeoverFrame>
  );
}

async function PitchVerdicts({ eventId }: { eventId: string }) {
  const [companies, scores] = await Promise.all([loadCompanies(eventId), loadReleasedScores(eventId, "PITCH")]);
  const score = new Map(scores.map((s) => [s.company_id, s.final_score]));
  const rows: (PitchRow & { id: string })[] = companies
    .filter((c) => score.has(c.id))
    .map((c) => ({ id: c.id, ticker: c.ticker, name: c.name, score: score.get(c.id) ?? null, ipoPrice: c.ipo_price }));
  const s = pitchSummary(rows);
  // Tied scores share a number (the top list is sorted by score first).
  const ranks = competitionRanks(s.top.map((r) => r.score));
  if (s.listed === 0) return <Neutral>The IPO prices will appear here.</Neutral>;
  return (
    <div className="flex h-full flex-col gap-8">
      <div className="grid shrink-0 grid-cols-2 gap-8">
        <div className="rounded-2xl bg-white/[0.06] px-8 py-5" data-testid="verdicts-listed">
          <p className="text-[30px] font-semibold tracking-wide text-slate-400 uppercase">Companies listed</p>
          <p className="text-[72px] leading-tight font-black tabular-nums">{count(s.listed)}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.06] px-8 py-5" data-testid="verdicts-range">
          <p className="text-[30px] font-semibold tracking-wide text-slate-400 uppercase">IPO prices</p>
          <p className="text-[72px] leading-tight font-black tabular-nums">
            {s.low === s.high ? money(s.low) : `${money(s.low)} – ${money(s.high)}`}
          </p>
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col" aria-label="Highest IPO prices" data-testid="verdicts-top">
        <h2 className="border-b-4 border-sky-400 pb-2 text-[44px] leading-tight font-black text-sky-300">Highest IPO prices</h2>
        <div className="mt-3 grid grid-cols-[4rem_minmax(0,1fr)_12rem_16rem] gap-6 px-5 text-[28px] font-semibold tracking-wide text-slate-400 uppercase">
          <span>#</span>
          <span>Company</span>
          <span className="text-right">Score</span>
          <span className="text-right">IPO price</span>
        </div>
        <ol className="mt-2 flex min-h-0 flex-col gap-3 overflow-hidden">
          {s.top.map((r, i) => (
            <li
              key={r.id}
              className="grid grid-cols-[4rem_minmax(0,1fr)_12rem_16rem] items-center gap-6 rounded-xl bg-white/[0.06] px-5 py-1.5"
              data-testid={`verdicts-top-${r.ticker}`}
            >
              <span className="text-[40px] font-black text-slate-400 tabular-nums">{ranks[i]}</span>
              <p className="min-w-0 truncate text-[40px] leading-tight">
                <b className="font-black">{r.ticker}</b> <span className="text-[32px] text-slate-300">{r.name ?? ""}</span>
              </p>
              <span className="text-right text-[40px] font-bold tabular-nums">{r.score ?? "—"}</span>
              <span className="text-right text-[48px] font-black text-sky-300 tabular-nums">{money(r.ipoPrice)}</span>
            </li>
          ))}
        </ol>
        {s.moreTied > 0 ? (
          <p className="mt-2 px-5 text-[30px] text-slate-300" data-testid="verdicts-more-tied">
            and {s.moreTied} more with the same score
          </p>
        ) : null}
      </section>
    </div>
  );
}

async function TierVerdicts({ eventId, type }: { eventId: string; type: "PLAN" | "FLASH" }) {
  const [companies, scores, moves] = await Promise.all([
    loadCompanies(eventId),
    loadReleasedScores(eventId, type),
    loadPriceMoves(eventId, type === "PLAN" ? "PLAN_TIER" : "FLASH_TIER"),
  ]);
  const score = new Map(scores.map((s) => [s.company_id, s]));
  const rows: (VerdictRow & { id: string })[] = companies.flatMap((c) => {
    const s = score.get(c.id);
    if (!s) return [];
    const m = moves.get(c.id);
    return [{ id: c.id, ticker: c.ticker, name: c.name, score: s.final_score, tierBp: s.tier_bp ?? 0, before: m?.market_before ?? null, after: m?.market_after ?? null }];
  });
  if (rows.length === 0) return <Neutral>The verdicts will appear here.</Neutral>;
  const m = verdictMovers(rows);
  const toRow = (r: VerdictRow & { id: string }, tone: "up" | "down"): MoverRowData => ({
    key: r.id,
    ticker: r.ticker,
    name: r.name,
    middle: <span className="text-[44px] font-bold tabular-nums">{r.score ?? "—"}</span>,
    right: (
      <>
        <p className={`text-[44px] leading-tight font-black tabular-nums ${tone === "up" ? "text-emerald-400" : "text-red-400"}`}>{bp(r.tierBp)}</p>
        <PriceMove before={r.before} after={r.after} tone={tone} className="text-[28px]" />
      </>
    ),
  });
  return (
    <div className="flex h-full flex-col gap-6">
      <p className="shrink-0 text-[36px] text-slate-200" data-testid="verdicts-summary">
        Every price moved by the company&apos;s tier: <b className="text-emerald-400">{count(m.up)} up</b> ·{" "}
        <b className="text-white">{count(m.unchanged)} unchanged</b> · <b className="text-red-400">{count(m.down)} down</b>
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-12">
        <MoverColumn
          title="Top risers"
          tone="up"
          headers={["Company", "Score", "Tier · price"]}
          rows={m.risers.map((r) => toRow(r, "up"))}
          empty="No company's price rose."
          testId="verdicts-risers"
        />
        <MoverColumn
          title="Top fallers"
          tone="down"
          headers={["Company", "Score", "Tier · price"]}
          rows={m.fallers.map((r) => toRow(r, "down"))}
          empty="No company's price fell."
          testId="verdicts-fallers"
        />
      </div>
    </div>
  );
}
