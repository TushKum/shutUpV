import type { Metadata } from "next";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadRoundsData } from "@/lib/admin/rounds-data";
import { aggregateOrders, orderLines, previewClearing, roundHistory, roundWait, signedCount, signedMoney } from "@/lib/admin/rounds";
import { clock, count, money } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { closeRound } from "./actions";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";

export const metadata: Metadata = { title: "Rounds" };

const changeTone = (n: number) => (n > 0 ? "text-emerald-700" : n < 0 ? "text-red-700" : "text-slate-500");

// Rounds: the open (or next) round, its pending orders, what clearing it now would do, "close now", and every cleared
// round's prices.
export default async function RoundsPage({ params }: PageProps<"/admin/[slug]/rounds">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  const data = await loadRoundsData(event.id, new Date(status.server_time).getTime());
  const { focus } = data;
  const open = focus?.kind === "OPEN" ? focus.round : null;
  const book = open ? aggregateOrders(data.orders, data.companies) : [];
  const lines = open ? orderLines(data.orders, data.teams, data.companies) : [];
  const preview = open ? previewClearing(data.companies, data.orders, data.teams, data.holdings) : null;
  const history = roundHistory(data.clearings, data.rounds, data.companies);
  const traders = new Set(data.orders.map((o) => o.team_id)).size;
  const wait = roundWait(
    focus,
    { nowMs: new Date(status.server_time).getTime(), paused: status.paused, phase: status.phase, autoAdvance: status.auto_advance, gate: status.gate },
    (p) => PHASE_LABELS[p as PhaseCode] ?? p,
  );

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={5000} active={!!open} />
      {/* When the round's time comes, re-read: it opens or clears, or the page explains why it waits. */}
      <RefreshAt at={focus ? (focus.kind === "OPEN" ? focus.round.closes_at : focus.round.opens_at) : null} />

      <Panel
        title={open ? `Round ${open.number}` : focus ? `Next: round ${focus.round.number}` : "Rounds"}
        actions={
          organiser ? (
            <ActionButton
              action={closeRound.bind(null, event.id, open?.number ?? 0)}
              confirm={open ? `Click again to close round ${open.number} now` : undefined}
              disabled={!open}
              title={open ? "Clears the round at once with the orders in the book" : "No round is open"}
            >
              {open ? `Close round ${open.number} now` : "Close round now"}
            </ActionButton>
          ) : null
        }
      >
        {focus ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Round" value={focus.round.number} hint={PHASE_LABELS[focus.round.phase as PhaseCode]} />
            <Stat
              label="Status"
              value={
                focus.kind === "OPEN" ? (
                  status.paused ? (
                    <Badge tone="amber">Paused</Badge>
                  ) : focus.overdue ? (
                    <Badge tone="amber">Clearing</Badge>
                  ) : (
                    <Badge tone="green">Open</Badge>
                  )
                ) : (
                  <Badge tone="blue">Scheduled</Badge>
                )
              }
              hint={status.paused ? "Event paused" : undefined}
            />
            {focus.kind === "OPEN" ? (
              <Stat label="Closes in" value={<Countdown to={focus.round.closes_at} passed={status.paused ? "paused" : "closing…"} />} hint={clock(focus.round.closes_at, true)} />
            ) : (
              <Stat label="Opens in" value={<Countdown to={focus.round.opens_at} passed={wait ? "waiting" : "opening…"} />} hint={clock(focus.round.opens_at, true)} />
            )}
            <Stat
              label="Pending orders"
              value={open ? count(data.orders.length) : "—"}
              hint={open ? `${traders} team${traders === 1 ? "" : "s"} · ${book.length} compan${book.length === 1 ? "y" : "ies"}` : undefined}
            />
          </div>
        ) : (
          <p className="text-sm text-slate-600">Every round has cleared.</p>
        )}
        {wait ? (
          <div className="mt-3">
            <Notice tone={wait.tone}>{wait.text}</Notice>
          </div>
        ) : null}
        {!organiser ? <p className="mt-3 text-sm text-slate-600">Only organisers close a round early.</p> : null}
      </Panel>

      {open ? (
        <>
          <Panel title={`Pending orders · round ${open.number}`}>
            <h3 className="text-sm font-semibold text-slate-900">Per company</h3>
            <Table head={["Ticker", "Buy", "Sell", "Net", "Capped net", "Price"]} empty="No pending orders.">
              {book.map((b) => (
                <tr key={b.companyId}>
                  <Td mono className="font-semibold">{b.ticker}</Td>
                  <Td mono>{count(b.buy)}</Td>
                  <Td mono>{count(b.sell)}</Td>
                  <Td mono className={changeTone(b.net)}>{signedCount(b.net)}</Td>
                  <Td mono className={changeTone(b.cappedNet)}>{signedCount(b.cappedNet)}</Td>
                  <Td mono>{money(b.price)}</Td>
                </tr>
              ))}
            </Table>
            <h3 className="mt-5 text-sm font-semibold text-slate-900">Orders</h3>
            <div className="max-h-[28rem] overflow-y-auto">
              <Table head={["Team", "Ticker", "Type", "Quantity", "Reserve", "Time"]} empty="No pending orders.">
                {lines.map((o) => (
                  <tr key={o.id}>
                    <Td mono>{o.code}</Td>
                    <Td mono>{o.ticker}</Td>
                    <Td>{o.type}</Td>
                    <Td mono>{count(o.qty)}</Td>
                    <Td mono>{money(o.reserve)}</Td>
                    <Td mono>{clock(o.createdAt, true)}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Panel>

          <Panel title={`Clearing preview · round ${open.number}`}>
            <p className="text-sm text-slate-600">
              What clearing round {open.number} now would do: the engine&apos;s clearing rule on the current prices, the pending orders and the
              teams&apos; books. New price = price × (100,000 + capped net) ÷ 100,000; every order fills at its company&apos;s new price.
            </p>
            {preview && !preview.ok ? (
              <div className="mt-3">
                <Notice tone="red">The clearing preview failed: {preview.message}</Notice>
              </div>
            ) : preview ? (
              <>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">Prices</h3>
                <Table head={["Ticker", "Price", "New price", "Change", "Net", "Capped net"]} empty="No price moves.">
                  {preview.companies.map((c) => (
                    <tr key={c.companyId}>
                      <Td mono className="font-semibold">{c.ticker}</Td>
                      <Td mono>{money(c.oldPrice)}</Td>
                      <Td mono className="font-semibold">{money(c.newPrice)}</Td>
                      <Td mono className={changeTone(c.newPrice - c.oldPrice)}>{signedMoney(c.newPrice - c.oldPrice)}</Td>
                      <Td mono>{signedCount(c.net)}</Td>
                      <Td mono>{signedCount(c.cappedNet)}</Td>
                    </tr>
                  ))}
                </Table>
                {preview.unchanged > 0 ? (
                  <p className="mt-1 px-2 text-xs text-slate-500">
                    {preview.unchanged === 1
                      ? "1 other company has no orders and keeps its price."
                      : `${preview.unchanged} other companies have no orders and keep their prices.`}
                  </p>
                ) : null}
                <h3 className="mt-5 text-sm font-semibold text-slate-900">Teams</h3>
                <Table head={["Team", "Orders", "Cash", "Cash after", "Change"]} empty="No team's cash changes.">
                  {preview.teams.map((f) => (
                    <tr key={f.teamId}>
                      <Td mono className="font-semibold">{f.code}</Td>
                      <Td mono>{f.orders}</Td>
                      <Td mono>{money(f.cashBefore)}</Td>
                      <Td mono>{money(f.cashAfter)}</Td>
                      <Td mono className={changeTone(f.cashChange)}>{signedMoney(f.cashChange)}</Td>
                    </tr>
                  ))}
                </Table>
                <p className="mt-2 px-2 text-xs text-slate-500">Exchange cash change: {signedMoney(preview.exchangeCashDelta)}</p>
              </>
            ) : null}
          </Panel>
        </>
      ) : null}

      <Panel title="Cleared rounds">
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No round has cleared yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((r, i) => (
              <details key={r.number} open={i === 0} className="rounded-md border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-900">
                  Round {r.number} · cleared {clock(r.clearedAt, true)} · {r.traded} compan{r.traded === 1 ? "y" : "ies"} traded
                </summary>
                <div className="px-2 pb-2">
                  <Table head={["Ticker", "Price before → after", "Change", "Net", "Capped net"]}>
                    {r.rows.map((p) => (
                      <tr key={p.company_id}>
                        <Td mono className="font-semibold">{p.ticker}</Td>
                        <Td mono>
                          {money(p.market_before)} → {money(p.market_after)}
                        </Td>
                        <Td mono className={changeTone(p.market_after - (p.market_before ?? p.market_after))}>
                          {signedMoney(p.market_after - (p.market_before ?? p.market_after))}
                        </Td>
                        <Td mono>{signedCount(p.net_qty)}</Td>
                        <Td mono>{signedCount(p.capped_net)}</Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </details>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
