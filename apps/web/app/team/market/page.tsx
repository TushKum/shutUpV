import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadMarketList, loadReleased } from "@/lib/team/market-data";
import { marketLines, marketOpensText, publicTypes, sign, SUBMISSION_TITLES } from "@/lib/team/market";
import { supabaseServer } from "@/lib/supabase/server";
import { bp, money } from "@/lib/format";
import { Notice, Panel, Table, Td } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Market" };

const TONE = { 1: "text-emerald-700", 0: "text-slate-500", [-1]: "text-red-700" } as const;
const ARROW = { 1: "▲", 0: "■", [-1]: "▼" } as const;

// Market: every listed company with its ticker, name, IPO price, market price and the last cleared round's move,
// in ticker order (never ranked). Each row opens the company's page (pitch, plan, verdicts, crisis card, flash answer,
// price history). Before Reading, when the market opens.
export default async function MarketPage() {
  const { event, status } = await loadTeamContext();
  if (!phaseReached(status.phase, "READING")) {
    const sb = await supabaseServer();
    const { data } = await sb.from("phases").select("starts_at").eq("event_id", event.id).eq("code", "READING").maybeSingle<{ starts_at: string }>();
    return (
      <Panel title="Market">
        <Notice>{marketOpensText(data?.starts_at)}</Notice>
      </Panel>
    );
  }
  const sb = await supabaseServer();
  const [list, released] = await Promise.all([loadMarketList(event.id), loadReleased(sb, event.id)]);
  const lines = marketLines(list.companies, list.lastRound?.rows ?? []);
  const books = publicTypes(status.phase, released);

  return (
    <div className="space-y-6">
      <Panel
        title={`Listed companies (${lines.length})`}
        actions={
          <nav aria-label="Books" className="flex flex-wrap gap-2 text-sm">
            {books.map((t) => (
              <Link key={t} href={`/team/market/book?type=${t}`} className="rounded-md px-2 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
                {t === "PITCH" ? "Pitch book" : t === "PLAN" ? "Rescue plans" : "Flash answers"}
              </Link>
            ))}
          </nav>
        }
      >
        {!released.PITCH ? (
          <p className="mb-3 text-sm text-slate-600">IPO prices are released at the IPO, with the pitch scores. Until then, read the pitch book.</p>
        ) : null}
        <Table
          head={["Ticker", "Company", "IPO price", "Market price", list.lastRound ? `Round ${list.lastRound.number}` : "Last round"]}
          label="Listed companies"
          empty="No company is listed yet."
        >
          {lines.map((l) => {
            const s = l.change ? sign(l.change.bp) : 0;
            return (
              <tr key={l.id}>
                <Td mono className="font-semibold">
                  <Link href={`/team/market/${l.ticker}`} className="underline underline-offset-2">
                    {l.ticker}
                  </Link>
                </Td>
                <Td>
                  <span className="block max-w-[14rem] truncate" title={l.name}>
                    {l.name}
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
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-slate-500">
          In ticker order. Open a company for its {books.map((t) => SUBMISSION_TITLES[t].toLowerCase()).join(", ")}
          {books.length ? ", " : ""}verdicts and price history.
        </p>
      </Panel>
    </div>
  );
}
