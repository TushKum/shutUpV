import { phaseReached, type PhaseCode } from "@msim/engine";
import { Panel } from "@/components/ui/ui";

/** Before 02:15 the trading screens explain Round 3 instead; null once trading has started. */
export function TradingNotYet({ phase, title }: { phase: PhaseCode; title: string }) {
  if (phaseReached(phase, "MARKET_BLIND")) return null;
  return (
    <Panel title={title}>
      <p className="text-sm text-slate-700" data-testid="trading-notice">
        Trading starts at 02:15 with $100,000 for every team: nine rounds of 15 minutes, buy and sell only, at most 5,000 shares of any company, never the
        company you built or the one you rescued. Every order in a round fills at the same new price when the round clears.
      </p>
    </Panel>
  );
}
