import type { Metadata } from "next";
import { phaseReached, PRACTICE } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { ensurePracticeMarket, loadPracticeMarket, practiceResults, practiceTickers } from "@/lib/team/practice";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { Notice, Panel } from "@/components/ui/ui";
import { tradeGate } from "../gate";
import { PracticeTerminal } from "./terminal";

export const metadata: Metadata = { title: "Practice market" };

// Round 1 for the Finance teams: a practice market named after the Product teams, trading on candlestick charts while
// the PRDs are written. Before Round 1 it says when it opens; during Round 1 it is the trading terminal; after it,
// each fund's result and the edge carried into the real market.
export default async function PracticePage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const { status, event } = ctx;
  const edgeCap = money(PRACTICE.edgeCapCents);
  const start = money(PRACTICE.startCents);

  if (!phaseReached(status.phase, "BUILD")) {
    const sb = await supabaseServer();
    const { data } = await sb.from("phases").select("starts_at").eq("event_id", event.id).eq("code", "BUILD").maybeSingle<{ starts_at: string }>();
    return (
      <Panel title="Practice market">
        <p className="text-sm text-paper" data-testid="practice-notice">
          The practice market opens with Round 1{data ? ` at ${clock(data.starts_at)}` : ""}. You get {start} of practice money to trade
          candlestick charts named after the Product teams. Your profit, up to {edgeCap}, is added to your real fund before the IPO; a loss
          costs you nothing.
        </p>
      </Panel>
    );
  }

  const tickers = await practiceTickers(event.id);
  const market = status.phase === "BUILD" ? await ensurePracticeMarket(event.id, tickers) : await loadPracticeMarket(event.id);

  if (status.phase !== "BUILD" || market?.settledAt) {
    const results = await practiceResults(event.id);
    const mine = results.find((r) => r.code === ctx.team.code);
    return (
      <Panel title="Practice market: closed">
        {mine ? (
          <p className="text-sm text-paper" data-testid="practice-result">
            Your practice fund finished at <b>{money(mine.equity)}</b> ({mine.trades} trades).{" "}
            {mine.edge > 0 ? (
              <>
                <b className="text-phosphor">{money(mine.edge)}</b> was added to your real cash for the IPO.
              </>
            ) : (
              <>No profit, so nothing was added (and nothing was taken).</>
            )}
          </p>
        ) : (
          <p className="text-sm text-paper" data-testid="practice-result">
            {market ? "Your fund did not trade in the practice market." : "There was no practice market in this event."}
          </p>
        )}
        {results.length > 0 ? (
          <table className="mt-3 w-full max-w-2xl text-sm" data-testid="practice-leaderboard">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1">#</th>
                <th>Fund</th>
                <th className="text-right">Practice result</th>
                <th className="text-right">Edge</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 15).map((r, i) => (
                <tr key={r.code} className={r.code === ctx.team.code ? "text-phosphor" : "text-paper"}>
                  <td className="py-0.5">{i + 1}</td>
                  <td>
                    {r.code} {r.name}
                  </td>
                  <td className="text-right font-mono">{money(r.equity)}</td>
                  <td className="text-right font-mono">{r.edge > 0 ? `+${money(r.edge)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Panel>
    );
  }

  if (!market) {
    return <Notice tone="amber">The practice market could not open. Ask the organisers.</Notice>;
  }

  return (
    <PracticeTerminal
      eventId={event.id}
      teamId={ctx.team.id}
      tickers={tickers}
      startsAt={market.startsAt}
      tickSeconds={market.tickSeconds}
      steps={market.steps}
      serverNow={status.server_time}
      initialStep={Math.max(0, Math.floor((new Date(status.server_time).getTime() - new Date(market.startsAt).getTime()) / (market.tickSeconds * 1000)))}
      paused={status.paused}
    />
  );
}
