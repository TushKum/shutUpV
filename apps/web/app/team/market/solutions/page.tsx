import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadSolutions } from "@/lib/team/market-data";
import { PUBLIC_FROM } from "@/lib/team/market";
import { money } from "@/lib/format";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { MarketTabs } from "../tabs";
import { Submission } from "../submission";
import { CrisisCard } from "../crisis-card";

export const metadata: Metadata = { title: "Crisis solutions" };

// Every company's crisis solution, public from 02:15 (without scores until the 02:45 reveal), with its crisis card, in
// ticker order, so teams can read them and trade.
export default async function SolutionsPage() {
  const { event, status } = await loadTeamContext();
  if (!phaseReached(status.phase, "MARKET_BLIND")) {
    return (
      <div className="space-y-6">
        <MarketTabs current="SOLUTIONS" solutions={false} />
        <Notice>{PUBLIC_FROM.SOLUTION}</Notice>
      </div>
    );
  }
  const { companies, submissions, scores, crises } = await loadSolutions(event.id);
  const revealed = scores.size > 0;
  return (
    <div className="space-y-6">
      <MarketTabs current="SOLUTIONS" solutions />
      <p className="text-sm text-slate-600">
        {revealed ? "Scores have been revealed." : "Scores stay secret until the score reveal, when each one moves its company's prices by 1 + 0.5% × (score − 50)."}
      </p>
      {companies.map((c) => {
        const s = submissions.get(c.id);
        const card = c.crisis_card_id ? crises.get(c.crisis_card_id) : undefined;
        const score = scores.get(c.id);
        return (
          <Panel
            key={c.id}
            title={
              <span className="flex flex-wrap items-baseline gap-2">
                <Link href={`/team/market/${c.ticker}`} className="font-mono underline">
                  {c.ticker}
                </Link>
                <span>{c.name}</span>
                <span className="text-sm font-normal text-slate-500">{money(c.market_price)}</span>
                {score !== undefined ? <Badge tone="violet">Score {score ?? "—"}</Badge> : null}
              </span>
            }
          >
            {card ? (
              <div className="mb-3">
                <CrisisCard card={card} compact />
              </div>
            ) : null}
            {s ? <Submission type="SOLUTION" s={s} /> : <p className="text-sm text-slate-500">No crisis solution was saved before the lock.</p>}
          </Panel>
        );
      })}
    </div>
  );
}
