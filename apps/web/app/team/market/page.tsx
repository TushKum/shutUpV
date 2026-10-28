import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadMarketList, loadReleased } from "@/lib/team/market-data";
import { marketLines, marketOpensText, openBooks, sign } from "@/lib/team/market";
import { supabaseServer } from "@/lib/supabase/server";
import { bp, money } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td } from "@/components/ui/ui";
import { Sparkline } from "@/components/ui/line-chart";
import { BookTabs } from "./tabs";

export const metadata: Metadata = { title: "Market" };

const TONE = { 1: "text-emerald-700", 0: "text-slate-500", [-1]: "text-red-700" } as const;
const ARROW = { 1: "▲", 0: "■", [-1]: "▼" } as const;

// Market: every listed company with its ticker, name, IPO price, market price and the last cleared round's move,
// in ticker order (never ranked). Each row opens the company's page (pitch, verdicts, crisis card, plan, flash
// answer, price history); the books gather one kind of public work for every company. Before Reading, when the
// market opens. Prices change only at a broadcast (clearing, crisis, tiers), which refreshes the page.
export default async function MarketPage() {
  const { event, status, company: own } = await loadTeamContext();
  const sb = await supabaseServer();
  if (!phaseReached(status.phase, "READING")) {
    const { data } = await sb.from("phases").select("starts_at").eq("event_id", event.id).eq("code", "READING").maybeSingle<{ starts_at: string }>();
    return (
      <Panel title="Market">
        <Notice>{marketOpensText(data?.starts_at)}</Notice>
      </Panel>
    );
  }
  const [list, released] = await Promise.all([loadMarketList(event.id), loadReleased(sb, event.id)]);
  const lines = marketLines(list.companies, list.lastRound?.rows ?? []);

  return (
    <div className="space-y-6">
      <BookTabs open={openBooks(status.phase, released)} current="PRICES" />
      <Panel title={`Listed companies (${lines.length})`}>
        {!released.PITCH ? (
          <p className="mb-3 text-sm text-slate-600">IPO prices are released at the IPO, with the pitch scores. Until then, read the pitch book.</p>
        ) : null}
        <Table
          head={["Ticker", "Company", "IPO price", "Market price", list.lastRound ? `Round ${list.lastRound.number}` : "Last round", "Trend"]}
          label="Listed companies"
          empty="No company is listed yet."
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
                    {own?.id === l.id ? <Badge tone="violet">Yours</Badge> : null}
                  </span>
                </Td>
                <Td mono className="text-right">
                  {money(l.ipo)}
                </Td>
                <Td mono className="text-right font-semibold">
                  {money(l.price)}
                </Td>
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
                  <Sparkline values={list.trends[l.id] ?? []} label={`${l.ticker} price trend`} />
                </Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-slate-500">
          In ticker order. {list.lastRound ? `The last column is the move in round ${list.lastRound.number}, the last round cleared. ` : ""}Open a company for
          everything public about it and its price history, round by round.
        </p>
      </Panel>
    </div>
  );
}
