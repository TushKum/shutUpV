// 02:45 the score reveal: every crisis solution's score moves the rescued company's price by 0.5% per point above or
// below 50. The biggest risers and fallers with score, change and price before → after. Revealed scores and company
// names are public; no team appears.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { revealMovers, type RevealRow } from "@/lib/display/takeovers";
import { bp, count } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCompanies, loadPriceMoves, loadRevealedScores } from "./data";
import { MoverColumn, Neutral, PriceMove, type MoverRowData } from "./parts";

export async function RevealTakeover({ event, takeover }: TakeoverProps) {
  const [companies, scores, moves] = await Promise.all([loadCompanies(event.id), loadRevealedScores(event.id, "SOLUTION"), loadPriceMoves(event.id, "REVEAL")]);
  const rows: (RevealRow & { id: string })[] = companies.flatMap((c) => {
    const m = moves.get(c.id);
    if (!m || m.factor_bp === null) return [];
    return [{ id: c.id, ticker: c.ticker, name: c.name, score: scores.get(c.id) ?? null, factorBp: m.factor_bp, before: m.market_before, after: m.market_after }];
  });
  const m = revealMovers(rows);
  const toRow = (r: RevealRow & { id: string }, tone: "up" | "down"): MoverRowData => ({
    key: r.id,
    ticker: r.ticker,
    name: r.name,
    middle: <span className="text-[44px] font-bold tabular-nums">{r.score ?? "—"}</span>,
    right: (
      <>
        <p className={`text-[44px] leading-tight font-black tabular-nums ${tone === "up" ? "text-emerald-400" : "text-red-400"}`}>{bp(r.factorBp - 10_000)}</p>
        <PriceMove before={r.before} after={r.after} tone={tone} className="text-[28px]" />
      </>
    ),
  });
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.REVEAL} at={takeover.at} until={takeover.until} tone="bg-emerald-400 text-black">
      {rows.length === 0 ? (
        <Neutral>The crisis-solution scores will appear here.</Neutral>
      ) : (
        <div className="flex h-full flex-col gap-6">
          <p className="shrink-0 text-[36px] text-slate-200" data-testid="reveal-summary">
            Every price moved 0.5% per point above or below 50: <b className="text-emerald-400">{count(m.up)} up</b> ·{" "}
            <b className="text-white">{count(m.unchanged)} unchanged</b> · <b className="text-red-400">{count(m.down)} down</b>
          </p>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-12">
            <MoverColumn title="Biggest risers" tone="up" headers={["Company", "Score", "Change · price"]} rows={m.risers.map((r) => toRow(r, "up"))} empty="No company's price rose." testId="reveal-risers" />
            <MoverColumn title="Biggest fallers" tone="down" headers={["Company", "Score", "Change · price"]} rows={m.fallers.map((r) => toRow(r, "down"))} empty="No company's price fell." testId="reveal-fallers" />
          </div>
        </div>
      )}
    </TakeoverFrame>
  );
}
