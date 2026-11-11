import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { loadTradeData } from "@/lib/team/trade-data";
import { STATUS_LABELS, orderHistory, type OrderLine } from "@/lib/team/trade";
import { clock, count, money, signedMoney } from "@/lib/format";
import { Badge, Panel, Table, Td } from "@/components/ui/ui";
import { tradeGate } from "../gate";

export const metadata: Metadata = { title: "Order history" };

// Order history: every order of every round (the open round's pending orders are on Orders), newest round first,
// with the price when it was placed, the fill price and the cash the fill moved. Clearings broadcast, so the page
// re-reads itself after every round.
export default async function HistoryPage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const data = await loadTradeData(ctx, { orders: "all" });
  const rounds = orderHistory(data.orders, data.rounds, data.companies);

  if (rounds.length === 0) {
    return (
      <Panel title="Order history">
        <p className="text-sm text-slate-500">
          No orders yet. Orders are placed under{" "}
          <Link href="/team/trade" className="underline">
            Orders
          </Link>{" "}
          while a round is open.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {rounds.map((r) => (
        <Panel
          key={r.number}
          title={`Round ${r.number}`}
          actions={
            r.status === "CLEARED" ? (
              <span className="text-sm text-slate-600">
                Cash from fills <span className="font-mono font-semibold tabular-nums">{signedMoney(r.cash)}</span>
              </span>
            ) : r.status === "OPEN" ? (
              <Badge tone="blue">Open: pending orders are under Orders</Badge>
            ) : (
              <Badge tone="amber">Clearing</Badge>
            )
          }
        >
          <Table head={["Order", "Shares", "Fill price", "Cash", "Status", "Price when placed", "Placed"]} label={`Orders of round ${r.number}`}>
            {r.lines.map((l) => (
              <HistoryRow key={l.id} l={l} clearing={r.status !== "CLEARED" && r.status !== "OPEN"} />
            ))}
          </Table>
        </Panel>
      ))}
    </div>
  );
}

function HistoryRow({ l, clearing }: { l: OrderLine; clearing: boolean }) {
  const tone = l.status === "FILLED" ? "green" : l.status === "CANCELLED" ? "slate" : "amber";
  return (
    <tr data-testid="history-order">
      <Td mono className="font-semibold">
        {l.type} {l.ticker}
      </Td>
      <Td mono className="text-right">
        {count(l.qty)}
      </Td>
      <Td mono className="text-right">
        {l.fillPrice === null ? "—" : money(l.fillPrice)}
      </Td>
      <Td mono className={`text-right ${l.cash !== null && l.cash < 0 ? "text-red-700" : ""}`}>
        {l.cash === null ? "—" : signedMoney(l.cash)}
      </Td>
      <Td>
        <Badge tone={tone}>{l.status === "PENDING" && clearing ? "Clearing" : STATUS_LABELS[l.status]}</Badge>
      </Td>
      <Td mono className="text-right">
        {money(l.entryPrice)}
      </Td>
      <Td mono className="text-slate-600">
        {clock(l.createdAt, true)}
      </Td>
    </tr>
  );
}
