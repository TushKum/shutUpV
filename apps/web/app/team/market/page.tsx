import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadMarketList } from "@/lib/team/market-data";
import { marketLines, marketOpensText, sign } from "@/lib/team/market";
import { bp, money } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td } from "@/components/ui/ui";
import { Sparkline } from "@/components/ui/line-chart";
import { MarketTabs } from "./tabs";

export const metadata: Metadata = { title: "Market" };

const TONE = { 1: "text-emerald-700", 0: "text-slate-500", [-1]: "text-red-700" } as const;
const ARROW = { 1: "▲", 0: "■", [-1]: "▼" } as const;

// Market: every company with its ticker, name, starting price, market price, score-based price, the last round's move
// and a trend line, in ticker order (never ranked). Each row opens the company's page (PRD, crisis card, crisis
// solution, scores, price history). Prices change only at a broadcast (start, crisis, reveal, clearing, close), which
// refreshes the page.
export default async function MarketPage() {
  const { event, status, built, rescued } = await loadTeamContext();
  if (!phaseReached(status.phase, "REVEAL_1")) {
    return (
      <Panel title="Market">
        <Notice>{marketOpensText()}</Notice>
      </Panel>
    );
  }
  const list = await loadMarketList(event.id);
  const lines = marketLines(list.companies, list.lastRound?.rows ?? [], list.trends);
  const closed = lines.some((l) => l.closing !== null);

  return (
    <div className="space-y-6">
      <MarketTabs current="PRICES" solutions={phaseReached(status.phase, "MARKET_BLIND")} />
      <Panel title={`Companies (${lines.length})`}>
        <Table
          head={["Ticker", "Company", "Starting price", "Market price", "Score-based price", ...(closed ? ["Closing price"] : []), list.lastRound ? `Round ${list.lastRound.number}` : "Last round", "Trend"]}
          label="Companies"
          empty="No company yet."
        >
          {lines.map((l) => {
            const s = l.change ? sign(l.change.bp) : 0;
            return (
              <tr key={l.id} data-testid={`market-${l.ticker}`}>
                <Td mono className="font-semibold">
                  <Link href={`/team/market/${l.ticker}`} className="underline underline-offset-2">
                    {l.ticker}
                  </Link>
                </Td>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <span className="block max-w-[14rem] truncate" title={l.name}>
                      {l.name}
                    </span>
                    {built?.id === l.id ? <Badge tone="violet">You built it</Badge> : rescued?.id === l.id ? <Badge tone="amber">You rescue it</Badge> : null}
                  </span>
                </Td>
                <Td mono className="text-right">
                  {money(l.start)}
                </Td>
                <Td mono className="text-right font-semibold">
                  {money(l.price)}
                </Td>
                <Td mono className="text-right">
                  {money(l.scorePrice)}
                </Td>
                {closed ? (
                  <Td mono className="text-right font-semibold">
                    {money(l.closing)}
                  </Td>
                ) : null}
                <Td mono className={`text-right ${TONE[s]}`}>
                  {l.change ? (
                    <>
                      <span aria-hidden>{ARROW[s]}</span> {bp(l.change.bp)}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <Sparkline values={l.trend} label={`${l.ticker} price trend`} />
                </Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-slate-500">
          In ticker order. The market price moves with the crisis, the score reveal and every trading round; the score-based price only with the crisis and
          the reveal. At the close, closing price = ½ market price (average of rounds 8 and 9) + ½ score-based price.
        </p>
      </Panel>
    </div>
  );
}
