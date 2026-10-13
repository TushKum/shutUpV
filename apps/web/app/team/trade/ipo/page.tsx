import type { Metadata } from "next";
import { RULES, mul } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadTradeData } from "@/lib/team/trade-data";
import { ipoBook, ipoResults, ipoView, ipoWindow, type IpoResultLine } from "@/lib/team/trade";
import { clock, count, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { tradeGate } from "../gate";
import { IpoBids } from "../ipo-bids";
import { placeIpoBid } from "../actions";

export const metadata: Metadata = { title: "IPO" };

const RULES_TEXT =
  "Each fund may request 0 to 4,000 shares of each company except its own squad's, and all its requests together may not cost more than its cash at IPO prices. A company whose 35,000 IPO shares are oversubscribed is scaled down: each allocation is request × 35,000 ÷ total requested, rounded down to the nearest 10 shares. The money goes to the exchange; IPO shares count towards the 4,000-share long limit.";

// The IPO: during the IPO phase, every company the fund may bid for with its IPO price and the fund's saved bids
// (each saved on its own, checked as it is typed); after the allocation, the shares received and the cash paid. Bids
// send no broadcast, so while bids are open the page re-reads itself every 10 s (a bid saved on the fund's other
// device) and at the deadline; the allocation broadcasts.
export default async function IpoPage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const { status, team, company: own } = ctx;
  const data = await loadTradeData(ctx, { orders: "pending", ipo: true });
  const nowMs = new Date(status.server_time).getTime();
  const win = ipoWindow({ phase: status.phase, paused: status.paused, allocatedAt: data.ipoAllocatedAt, deadline: data.ipoDeadline, nowMs });
  const view = ipoView(team.cash, own?.id ?? null, data.bids, data.companies);
  const results = ipoResults(data.bids, data.companies);
  const deadline = data.ipoDeadline;

  if (win === "NOT_YET") {
    return (
      <Panel title="IPO">
        <p className="text-sm text-slate-700" data-testid="ipo-state">
          IPO bids open with the IPO{data.phaseStarts.IPO ? ` at ${clock(data.phaseStarts.IPO)}` : ""}
          {deadline ? ` and close at ${clock(deadline)}` : ""}, once the pitch scores have set every company&apos;s IPO price ($10.00 × (1 + pitch tier)).
        </p>
        <p className="mt-2 text-sm text-slate-600">{RULES_TEXT}</p>
      </Panel>
    );
  }

  if (win === "ALLOCATED") {
    const books = new Map(data.ipoBooks.map((b) => [b.company_id, b.details]));
    return (
      <div className="space-y-4">
        <Panel title="IPO allocation">
          <p className="text-sm text-slate-600" data-testid="ipo-state">
            The IPO was allocated at {clock(data.ipoAllocatedAt)}. Unallocated shares stay with the exchange.
          </p>
          {results.lines.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">You placed no IPO bids.</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Shares requested" value={count(results.requested)} />
                <Stat label="Shares received" value={<span data-testid="ipo-received">{count(results.allocated)}</span>} />
                <Stat label="Cash paid" value={<span data-testid="ipo-paid">{money(results.paid)}</span>} />
              </div>
              <Table head={["Company", "Received", "Paid", "Requested", "IPO price", "Book"]} label="IPO allocation" className="mt-3">
                {results.lines.map((l) => (
                  <AllocationRow key={l.companyId} l={l} book={books.get(l.companyId) ?? null} />
                ))}
              </Table>
            </>
          )}
        </Panel>
      </div>
    );
  }

  const book = ipoBook(view);
  const items = data.companies
    .filter((c) => c.ipo_price !== null && c.id !== own?.id)
    .map((c) => ({ id: c.id, ticker: c.ticker!, name: c.name, ipoPrice: c.ipo_price!, action: placeIpoBid.bind(null, c.id) }));

  return (
    <div className="space-y-4">
      <RefreshAt at={win === "OPEN" ? deadline : null} />
      <AutoRefresh everyMs={10_000} active={win === "OPEN"} />
      {win === "OPEN" ? (
        <p className="text-sm text-slate-700" data-testid="ipo-state">
          IPO bids are open until {clock(deadline)}
          {deadline ? (
            <>
              {" "}
              (in <Countdown to={deadline} passed="now" className="font-semibold" />)
            </>
          ) : null}
          . Shares are allocated when round 1 starts.
        </p>
      ) : win === "PAUSED" ? (
        <Notice tone="amber">
          <span data-testid="ipo-state">The event is paused: IPO bids are refused until it resumes. The deadline moves later by the length of the pause.</span>
        </Notice>
      ) : (
        <Notice tone="amber">
          <span data-testid="ipo-state">
            IPO bids closed{deadline ? ` at ${clock(deadline)}` : ""}. Shares are allocated when round 1 starts; the bids below are final.
          </span>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Cash" value={money(team.cash)} />
        <Stat label="Your bids at IPO prices" value={<span data-testid="ipo-committed">{money(book.committed)}</span>} />
        <Stat label="Cash left at IPO prices" value={<span data-testid="ipo-remaining">{money(book.remaining)}</span>} />
      </div>

      <Panel title="Companies">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No company has an IPO price yet.</p>
        ) : win === "OPEN" ? (
          <IpoBids view={view} items={items} deadline={deadline} />
        ) : (
          <Table head={["Company", "IPO price", "Your bid", "Cost"]} label="Your IPO bids">
            {items.map((c) => {
              const q = view.bids[c.id] ?? 0;
              return (
                <tr key={c.id}>
                  <Td mono className="font-semibold">
                    {c.ticker}
                  </Td>
                  <Td mono className="text-right">
                    {money(c.ipoPrice)}
                  </Td>
                  <Td mono className="text-right">
                    {q > 0 ? count(q) : "—"}
                  </Td>
                  <Td mono className="text-right">
                    {q > 0 ? money(mul(q, c.ipoPrice)) : "—"}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        {own?.ticker ? (
          <p className="mt-3 text-xs text-slate-500">Your squad&apos;s company, {own.ticker}, is not offered to you: a fund never bids for or trades its own squad&apos;s company.</p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">{RULES_TEXT}</p>
      </Panel>
    </div>
  );
}

function AllocationRow({ l, book }: { l: IpoResultLine; book: { requested?: number; available?: number } | null }) {
  const requested = book?.requested ?? null;
  const available = book?.available ?? RULES.IPO_SHARES;
  return (
    <tr data-testid={`allocation-${l.ticker}`}>
      <Td mono className="font-semibold">
        {l.ticker}
      </Td>
      <Td mono className="text-right">
        {count(l.allocated)}
      </Td>
      <Td mono className="text-right">
        {money(l.paid)}
      </Td>
      <Td mono className="text-right">
        {count(l.requested)}
      </Td>
      <Td mono className="text-right">
        {money(l.price)}
      </Td>
      <Td>
        {l.scaledDown ? (
          <Badge tone="amber">
            {requested !== null ? `Scaled down: ${count(requested)} requested for ${count(available)}` : "Scaled down"}
          </Badge>
        ) : (
          <span className="text-slate-500">In full</span>
        )}
      </Td>
    </tr>
  );
}
