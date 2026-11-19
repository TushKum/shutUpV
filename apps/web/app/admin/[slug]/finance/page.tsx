import type { Metadata } from "next";
import Link from "next/link";
import { practiceEdge } from "@msim/engine";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadSquads } from "@/lib/admin/tracks-data";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, count, money } from "@/lib/format";
import { Badge, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { currentViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Finance" };

// The Finance track: the Round 1 practice market (live standings, then the edge each fund carried into the real
// market), and every fund's cash, collateral, IPO bids and orders in the open round.
export default async function FinanceTrack({ params }: PageProps<"/admin/[slug]/finance">) {
  const { slug } = await params;
  const [event, viewer] = await Promise.all([loadAdminEvent(slug), currentViewer()]);
  const [status, { teams, squads }] = await Promise.all([loadEventStatus(event.id), loadSquads(event.id)]);
  const sb = await supabaseServer();
  const funds = teams.filter((t) => t.track === "FINANCE");
  const [bidsQ, ordersQ, marketQ, accountsQ, positionsQ] = await Promise.all([
    sb.from("ipo_bids").select("team_id, qty_requested, qty_allocated").eq("event_id", event.id),
    sb.from("orders").select("team_id, qty").eq("event_id", event.id).eq("status", "PENDING"),
    // The practice tables come with migration 52: a database without them shows no practice market.
    sb.from("practice_markets").select("starts_at, tick_seconds, steps, settled_at").eq("event_id", event.id).maybeSingle(),
    sb.from("practice_accounts").select("team_id, cash_cents, trades, equity_cents, edge_cents").eq("event_id", event.id),
    sb.from("practice_positions").select("team_id, ticker_team_id, qty").eq("event_id", event.id).neq("qty", 0),
  ]);
  const bids = (bidsQ.data ?? []) as { team_id: string; qty_requested: number; qty_allocated: number | null }[];
  const orders = (ordersQ.data ?? []) as { team_id: string; qty: number }[];
  const market = marketQ.data as { starts_at: string; tick_seconds: number; steps: number; settled_at: string | null } | null;
  const accounts = (accountsQ.data ?? []) as { team_id: string; cash_cents: number | string; trades: number; equity_cents: number | string | null; edge_cents: number | string | null }[];
  const positions = (positionsQ.data ?? []) as { team_id: string; ticker_team_id: string; qty: number }[];

  // Live practice standings: cash plus every position at its latest price (the tick of this moment).
  let latest = new Map<string, number>();
  if (market && !market.settled_at) {
    const step = Math.max(0, Math.min(market.steps - 1, Math.floor((new Date(status.server_time).getTime() - new Date(market.starts_at).getTime()) / (market.tick_seconds * 1000))));
    const { data } = await sb.from("practice_ticks").select("ticker_team_id, price_cents").eq("event_id", event.id).eq("step", step);
    latest = new Map(((data ?? []) as { ticker_team_id: string; price_cents: number }[]).map((r) => [r.ticker_team_id, r.price_cents]));
  }
  const equity = (a: (typeof accounts)[number]) =>
    a.equity_cents !== null && market?.settled_at
      ? Number(a.equity_cents)
      : Number(a.cash_cents) + positions.filter((p) => p.team_id === a.team_id).reduce((t, p) => t + p.qty * (latest.get(p.ticker_team_id) ?? 0), 0);
  const code = new Map(teams.map((t) => [t.id, t.code]));
  const standings = accounts.map((a) => ({ team: a.team_id, equity: equity(a), trades: a.trades, edge: market?.settled_at ? Number(a.edge_cents ?? 0) : practiceEdge(equity(a)) })).sort((x, y) => y.equity - x.equity);
  const practiceState = !market ? "Not opened yet" : market.settled_at ? `Closed at ${clock(market.settled_at)}` : "Open";
  const squadOf = new Map(squads.map((s) => [s.finance.id, s]));
  const edgeTotal = standings.reduce((t, s) => t + s.edge, 0);

  return (
    <div className="space-y-6">
      {viewer?.role === "ORGANISER" && (
        <div className="flex justify-end">
          <Link href={`/admin/${slug}/finance/data-settings`} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-phosphor">
            Data settings
          </Link>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Funds" value={funds.length} />
        <Stat label="Practice market" value={practiceState} hint={`${accounts.length} funds traded`} />
        <Stat label={market?.settled_at ? "Edge paid" : "Edge so far"} value={money(edgeTotal)} hint="practice profit, up to $50,000 a fund" />
        <Stat label="Open orders" value={count(orders.length)} hint={status.open_round ? `round ${status.open_round.number}` : "no round open"} />
      </div>

      <Panel title="Practice market · top funds" actions={market && !market.settled_at ? <Badge tone="green">LIVE</Badge> : undefined}>
        {standings.length === 0 ? (
          <p className="text-sm text-muted">
            {market ? "No fund has traded yet." : "The practice market opens with Round 1 (the first Finance page opened then prepares it)."}
          </p>
        ) : (
          <Table head={["#", "Fund", "Value", "Profit", "Edge", "Trades"]} label="Practice standings">
            {standings.slice(0, 15).map((s, i) => (
              <tr key={s.team}>
                <Td mono>{i + 1}</Td>
                <Td mono>{code.get(s.team)}</Td>
                <Td mono>{money(s.equity)}</Td>
                <Td mono className={s.equity >= 10_000_000 ? "text-phosphor" : "text-danger-soft"}>
                  {s.equity >= 10_000_000 ? "+" : "−"}
                  {money(Math.abs(s.equity - 10_000_000))}
                </Td>
                <Td mono>{s.edge ? `+${money(s.edge)}` : "—"}</Td>
                <Td mono>{s.trades}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Funds">
        <Table head={["Fund", "Squad", "Cash", "Collateral", "IPO bids", "Shares allotted", "Open orders", "Practice edge"]} label="Funds" empty="No funds.">
          {funds.map((f) => {
            const b = bids.filter((x) => x.team_id === f.id);
            const st = standings.find((s) => s.team === f.id);
            return (
              <tr key={f.id} data-testid={`fund-${f.code}`}>
                <Td mono>{f.code}</Td>
                <Td mono>{squadOf.get(f.id)?.number ?? "—"}</Td>
                <Td mono>{money(Number(f.cash_cents))}</Td>
                <Td mono>{Number(f.collateral_cents) ? money(Number(f.collateral_cents)) : "—"}</Td>
                <Td mono>{b.length ? `${b.length} · ${count(b.reduce((t, x) => t + x.qty_requested, 0))} sh` : "—"}</Td>
                <Td mono>{b.some((x) => x.qty_allocated !== null) ? count(b.reduce((t, x) => t + (x.qty_allocated ?? 0), 0)) : "—"}</Td>
                <Td mono>{orders.filter((o) => o.team_id === f.id).length || "—"}</Td>
                <Td mono>{st?.edge ? `+${money(st.edge)}` : "—"}</Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </div>
  );
}
