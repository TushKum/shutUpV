// Pieces shared by the three tracks' crisis rooms: the sub-round's timeline, the crisis cards, the firm league table,
// the engagements (who hired whom) and an offer with the moves open to this side.

import { clock, money } from "@/lib/format";
import type { CrisisRoomData, RoomCompany } from "@/lib/team/crisis-data";
import {
  OFFER_STATUS_TONE,
  countersLeft,
  offerMoves,
  subroundTitle,
  termsText,
  type EngagementRow,
  type OfferRow,
  type OfferSide,
  type TimelineStep,
} from "@/lib/team/crisis";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Badge, Panel, Table, Td, inputClass } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { CrisisCard } from "../market/crisis-card";
import { answerOffer, counterOffer } from "./actions";

export const companyLabel = (c: RoomCompany | undefined) => (c ? `${c.ticker ?? "—"}${c.name ? ` · ${c.name}` : ""}` : "—");

export function Timeline({ k, steps }: { k: number; steps: TimelineStep[] }) {
  const next = steps.find((s) => !s.passed && s.at);
  return (
    <div className="border border-line bg-panel" data-testid="subround-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-raised px-3 py-1.5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--term-amber)]">{subroundTitle(k)}</h2>
        {next ? (
          <span className="text-xs text-muted">
            {next.label} in <Countdown to={next.at} className="text-[var(--term-amber)]" />
          </span>
        ) : null}
      </div>
      <ol className="grid grid-cols-2 gap-px bg-line text-sm sm:grid-cols-4">
        {steps.map((s) => (
          <li key={s.code} className="bg-ink px-3 py-1.5">
            <p className="text-[11px] uppercase tracking-wider text-[var(--term-amber-dim)]">{s.label}</p>
            <p className={`font-mono ${s.passed ? "text-muted line-through" : s === next ? "text-[var(--term-amber)]" : "text-paper"}`}>{s.at ? clock(s.at) : "—"}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CardsOf({ data, k, only }: { data: CrisisRoomData; k: number; only?: readonly string[] }) {
  const rows = data.cards.filter((c) => c.k === k && (!only || only.includes(c.company_id)));
  if (rows.length === 0) return <p className="text-sm text-muted">No crisis card has been dealt for this sub-round yet.</p>;
  const byId = new Map(data.companies.map((c) => [c.id, c]));
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Crisis cards">
      {rows.map((r) => (
        <li key={r.company_id}>
          {only && only.length === 1 ? null : <p className="mb-1 font-mono text-xs text-[var(--term-cyan)]">{companyLabel(byId.get(r.company_id))}</p>}
          <CrisisCard card={r.card} />
        </li>
      ))}
    </ul>
  );
}

export function FirmLeague({ data, me }: { data: CrisisRoomData; me?: string }) {
  return (
    <Panel title="Firm values">
      <Table
        head={["Firm", "Cash", "Fee shares", "Value", "Clients", "Avg rating"]}
        empty={data.firms.length === 0 ? "No Consulting firm in this event." : undefined}
      >
        {data.firms.map((f, i) => (
          <tr key={f.team_id} className={f.team_id === me ? "bg-raised" : ""} data-testid={`firm-value-${f.code}`}>
            <Td>
              <span className="mr-2 text-muted">{i + 1}.</span>
              <span className="font-mono font-semibold text-[var(--term-amber)]">{f.code}</span> {f.name}
              {f.team_id === me ? <span className="ml-2"><Badge tone="violet">You</Badge></span> : null}
            </Td>
            <Td mono>{money(f.cash_cents)}</Td>
            <Td mono>{money(f.fee_share_value_cents)}</Td>
            <Td mono className="font-semibold text-[var(--term-green)]">
              {money(f.value_cents)}
            </Td>
            <Td mono>{f.clients}</Td>
            <Td mono>{f.avg_rating === null ? "—" : f.avg_rating.toFixed(2)}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-muted">Value = cash + fee shares at the market price. The final ranking ties on the average client rating.</p>
    </Panel>
  );
}

const ESCROW_TONE = { HELD: "amber", RELEASED: "green", REFUNDED: "slate" } as const;

export function EngagementTable({ data, rows, title = "Who hired whom" }: { data: CrisisRoomData; rows: EngagementRow[]; title?: string }) {
  const company = new Map(data.companies.map((c) => [c.id, c]));
  const firm = new Map(data.firms.map((f) => [f.team_id, f]));
  return (
    <Panel title={title}>
      <Table head={["Sub-round", "Company", "Firm", "Fee", "Escrow", "Rating", "Bonus"]} empty={rows.length === 0 ? "No firm hired yet." : undefined}>
        {rows.map((e) => (
          <tr key={e.id}>
            <Td>{subroundTitle(e.k).replace(/^Round 2 · /, "")}</Td>
            <Td mono>{companyLabel(company.get(e.company_id))}</Td>
            <Td mono>{firm.get(e.firm_team_id)?.code ?? "—"}</Td>
            <Td mono>{termsText(money(e.cash_cents), e.shares)}</Td>
            <Td>
              <Badge tone={ESCROW_TONE[e.escrow]}>{e.escrow}</Badge>
            </Td>
            <Td mono>{e.rating === null ? "—" : `${e.rating}/5${e.rating_default ? " (default)" : ""}`}</Td>
            <Td mono>{e.bonus_cents === null ? "—" : money(e.bonus_cents)}</Td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

/** One offer, with the moves this side may make now (accept, decline, counter, withdraw). */
export function OfferCard({ offer, side, hiring, counterpart }: { offer: OfferRow; side: OfferSide; hiring: boolean; counterpart: string }) {
  const moves = offerMoves(offer, side, hiring);
  const waiting = offer.status === "OPEN" && offer.turn !== side;
  return (
    <li className="border border-line bg-panel p-3" data-testid="offer">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold text-[var(--term-amber)]">{counterpart}</span>
        <span className="font-mono text-paper">{termsText(money(offer.cash_cents), offer.shares)}</span>
        <Badge tone={OFFER_STATUS_TONE[offer.status]}>{offer.status}</Badge>
        {offer.status === "OPEN" ? (
          <span className="text-xs text-muted">{waiting ? "Waiting for the other side" : "Your turn to answer"}</span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-muted">{clock(offer.updated_at)}</span>
      </div>
      {offer.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-paper">“{offer.note}”</p> : null}
      {moves.length ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {moves.includes("ACCEPT") ? (
            <ActionButton variant="primary" confirm="Click again to accept these terms" action={answerOffer.bind(null, offer.id, "ACCEPT")}>
              Accept
            </ActionButton>
          ) : null}
          {moves.includes("DECLINE") ? <ActionButton action={answerOffer.bind(null, offer.id, "DECLINE")}>Decline</ActionButton> : null}
          {moves.includes("WITHDRAW") ? <ActionButton action={answerOffer.bind(null, offer.id, "WITHDRAW")}>Withdraw</ActionButton> : null}
        </div>
      ) : null}
      {moves.includes("COUNTER") ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--term-amber)]">Counter ({countersLeft(offer, side)} left)</summary>
          <ActionForm action={counterOffer.bind(null, offer.id)} submit="Send counter" className="mt-2">
            <TermsFields cash={offer.cash_cents} shares={offer.shares} />
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}

/** Cash (dollars) and shares fields for an offer or a counter. */
export function TermsFields({ cash = 0, shares = 0, hint }: { cash?: number; shares?: number; hint?: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="font-semibold text-paper">Cash ($)</span>
        <input name="cash" inputMode="decimal" defaultValue={(cash / 100).toFixed(2)} className={`${inputClass} mt-1 font-mono`} />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-paper">Shares</span>
        <input name="shares" inputMode="numeric" defaultValue={String(shares)} className={`${inputClass} mt-1 font-mono`} />
      </label>
      {hint ? <p className="text-xs text-muted sm:col-span-2">{hint}</p> : null}
    </div>
  );
}
