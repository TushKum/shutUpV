// The Product team's crisis room: its crisis card, hiring a firm (the directory, offers and counters), the response
// plan (or the Round 3 solution), rating the firm, and the Round 3 draft.

import { RULES, planOf, type SubmissionType } from "@msim/engine";
import { clock, money } from "@/lib/format";
import type { TeamContext } from "@/lib/team/context";
import type { CrisisRoomData } from "@/lib/team/crisis-data";
import {
  FIRM_CLIENTS_PER_SUBROUND,
  draftState,
  feeBand,
  hiringOpen,
  pastSubrounds,
  ratingOpen,
  statementCounts,
  stepAt,
  subroundTitle,
  termsText,
} from "@/lib/team/crisis";
import { submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { Badge, Notice, Panel, inputClass } from "@/components/ui/ui";
import { SubmissionEditor } from "../squad/submission";
import { makeOffer, pickStatement, rateFirm } from "./actions";
import { CardsOf, EngagementTable, OfferCard, TermsFields, companyLabel } from "./parts";

export async function ProductRoom({ ctx, data, k, nowMs }: { ctx: TeamContext; data: CrisisRoomData; k: number | null; nowMs: number }) {
  const pause = pauseOf(ctx);
  const mine = data.companies.find((c) => c.product_team_id === ctx.team.id) ?? null;
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pause);
  const engaged = k !== null && mine ? data.engagements.find((e) => e.company_id === mine.id && e.k === k) : undefined;
  const firmById = new Map(data.firms.map((f) => [f.team_id, f]));
  const myOffers = mine && k !== null ? data.offers.filter((o) => o.company_id === mine.id && o.k === k) : [];
  const ws = ctx.squad ? await loadSquadWorkspace(ctx) : null;
  const planType: SubmissionType | null = k === null ? null : planOf(k);
  const win = ws && planType ? submissionWindow(planType, "PRODUCT", windowInput(ctx, ws)) : null;
  const rateable = mine ? data.engagements.filter((e) => e.company_id === mine.id && ratingOpen(e.k, data.deadlines, nowMs, pause)) : [];
  const draft = draftState(data.picks, mine?.id ?? null);
  const counts = statementCounts(data.picks);
  const myStatement = draft.mine?.statement_id ? data.statements.find((s) => s.id === draft.mine!.statement_id) : undefined;
  const band = k === 5 ? feeBand(ctx.team.cash) : null;
  const clientsThisRound = (firmId: string) => data.engagements.filter((e) => e.firm_team_id === firmId && e.k === k).length;

  return (
    <div className="space-y-6">
      {k !== null && k < 5 && mine ? (
        <Panel title={`Your crisis card · ${subroundTitle(k)}`}>
          <CardsOf data={data} k={k} only={[mine.id]} />
          <p className="mt-2 text-xs text-muted">
            The reveal knocked 5% off every price. Your response plan and your firm&apos;s memo are judged after the due time; the plan&apos;s tier moves your price.
          </p>
        </Panel>
      ) : null}

      {k === 5 ? (
        <Panel title="Round 3 · the draft">
          {myStatement ? (
            <Notice tone="green">
              Your company works on statement {myStatement.number}: <strong>{myStatement.title}</strong>
              {draft.mine?.by_default ? " (given by default: no pick in time)" : ""}.
            </Notice>
          ) : draft.myTurn ? (
            <Notice tone="amber">
              It is your pick: choose a statement before <Countdown to={draft.current!.closes_at} className="font-semibold" /> runs out, or you get the
              least-crowded one.
            </Notice>
          ) : draft.mine ? (
            <Notice>
              You pick {draft.mine.pick_no === 1 ? "first" : `at number ${draft.mine.pick_no}`} (lowest score so far picks first). {draft.ahead} pick
              {draft.ahead === 1 ? "" : "s"} before yours.
            </Notice>
          ) : (
            <Notice>The draft order appears when Round 3 starts.</Notice>
          )}
          <ul className="mt-3 space-y-2" aria-label="Problem statements">
            {data.statements.map((s) => {
              const n = counts.get(s.id) ?? 0;
              const full = n >= s.cap;
              return (
                <li key={s.id} className="border border-line bg-panel p-3" data-testid={`statement-${s.number}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[var(--term-amber)]">#{s.number}</span>
                    <span className="font-semibold text-paper">{s.title}</span>
                    <Badge tone={full ? "red" : "slate"}>
                      {n}/{s.cap}
                    </Badge>
                    {draft.myTurn && !full ? (
                      <span className="ml-auto">
                        <ActionButton variant="primary" confirm={`Click again to pick #${s.number}`} action={pickStatement.bind(null, s.id, `statement ${s.number}`)}>
                          Pick
                        </ActionButton>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{s.body}</p>
                </li>
              );
            })}
          </ul>
          {data.statements.length === 0 ? <p className="text-sm text-muted">The organisers have not published the statements yet.</p> : null}
        </Panel>
      ) : null}

      {k !== null ? (
        <Panel title={`Hire a firm · ${subroundTitle(k)}`}>
          {engaged ? (
            <Notice tone="green">
              You hired <strong>{firmById.get(engaged.firm_team_id)?.code ?? "a firm"}</strong> for {termsText(money(engaged.cash_cents), engaged.shares)}. Escrow:{" "}
              {engaged.escrow.toLowerCase()} (paid to the firm at the due time if it submits its memo, refunded otherwise).
            </Notice>
          ) : !hiring ? (
            <Notice>{k === 5 && !draft.done ? "Hiring opens when the draft ends." : "Hiring for this sub-round is closed."}</Notice>
          ) : (
            <>
              <p className="mb-3 text-sm text-paper">
                Offer a firm cash, shares or both. The firm can accept, decline or counter; each side counters at most three times. A firm takes at most{" "}
                {FIRM_CLIENTS_PER_SUBROUND} clients a sub-round. Hiring closes at {clock(stepAt(data.deadlines, "HIRE", k))}.
                {band ? ` In Round 3 the fee must be worth ${money(band.min)}–${money(band.max)} (5–20% of your cash).` : ""}
              </p>
              <ul className="grid gap-3 md:grid-cols-2" aria-label="Firm directory">
                {data.firms.map((f) => {
                  const p = data.profiles.get(f.team_id);
                  const full = clientsThisRound(f.team_id) >= FIRM_CLIENTS_PER_SUBROUND;
                  const open = myOffers.some((o) => o.firm_team_id === f.team_id && o.status === "OPEN");
                  return (
                    <li key={f.team_id} className="border border-line bg-panel p-3" data-testid={`firm-${f.code}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-[var(--term-amber)]">{f.code}</span>
                        <span className="text-paper">{f.name}</span>
                        {f.avg_rating !== null ? <Badge tone="slate">★ {f.avg_rating.toFixed(1)}</Badge> : null}
                        {full ? <Badge tone="red">Full</Badge> : null}
                      </div>
                      {p?.headline ? <p className="mt-1 text-sm font-semibold text-paper">{p.headline}</p> : null}
                      {p?.specialities.length ? <p className="mt-1 text-xs text-[var(--term-cyan)]">{p.specialities.join(" · ")}</p> : null}
                      {p?.rate_card ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{p.rate_card}</p> : null}
                      <p className="mt-1 text-xs text-muted">Asking {p && p.asking_cents > 0 ? money(p.asking_cents) : "—"}</p>
                      {!full && !open ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm font-semibold text-[var(--term-amber)]">Make an offer</summary>
                          <ActionForm action={makeOffer.bind(null, f.team_id, f.code)} submit="Send offer" className="mt-2" resetOnSuccess>
                            <TermsFields cash={p?.asking_cents ?? 0} />
                            <label className="mt-2 block text-sm">
                              <span className="font-semibold text-paper">Note (optional)</span>
                              <input name="note" maxLength={300} className={`${inputClass} mt-1`} />
                            </label>
                          </ActionForm>
                        </details>
                      ) : open ? (
                        <p className="mt-2 text-xs text-muted">You have an open offer with this firm (below).</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {myOffers.length ? (
            <>
              <h3 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wider text-[var(--term-amber)]">Your offers</h3>
              <ul className="space-y-2">
                {myOffers.map((o) => (
                  <OfferCard key={o.id} offer={o} side="COMPANY" hiring={hiring} counterpart={firmById.get(o.firm_team_id)?.code ?? "Firm"} />
                ))}
              </ul>
            </>
          ) : null}
        </Panel>
      ) : null}

      {k !== null && planType && ws && win ? (
        <Panel title={k === 5 ? "Round 3 solution" : `Response plan · ${subroundTitle(k)}`}>
          <p className="mb-3 text-sm text-paper">
            Up to {RULES.WORD_LIMIT[planType]} words.{" "}
            {k === 5
              ? "Written with your hired firm (each save shows for both). The tier moves your price, scaled by your rank within the statement."
              : "Your plan's tier moves your price; a missing plan scores 0. Your hired firm writes its advice memo separately."}
          </p>
          <SubmissionEditor ctx={ctx} ws={ws} type={planType} win={win} />
        </Panel>
      ) : null}

      {rateable.length ? (
        <Panel title="Rate your firm">
          <ul className="space-y-3">
            {rateable.map((e) => (
              <li key={e.id} className="text-sm" data-testid={`rate-${e.k}`}>
                <p className="text-paper">
                  {subroundTitle(e.k)} · {firmById.get(e.firm_team_id)?.code ?? "your firm"} · current rating{" "}
                  <strong>{e.rating === null ? "none (3 if you do not rate)" : `${e.rating}/5`}</strong>. Ratings close at {clock(stepAt(data.deadlines, "RATE", e.k))}.
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <ActionButton key={r} variant={e.rating === r ? "primary" : "secondary"} action={rateFirm.bind(null, e.k, r)}>
                      {"★".repeat(r)}
                    </ActionButton>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The firm&apos;s bonus moves by $1,000 for each star above or below 3.</p>
        </Panel>
      ) : null}

      {mine ? <History data={data} k={k} companyId={mine.id} /> : null}
    </div>
  );
}

function History({ data, k, companyId }: { data: CrisisRoomData; k: number | null; companyId: string }) {
  const past = pastSubrounds(k, data.subrounds);
  const mine = data.engagements.filter((e) => e.company_id === companyId);
  if (past.length === 0 && mine.length === 0) return null;
  return (
    <>
      {past.length ? (
        <Panel title="Earlier crises">
          <div className="space-y-4">
            {past.map((pk) => (
              <section key={pk}>
                <h3 className="mb-1 text-sm font-bold uppercase tracking-wider text-[var(--term-amber-dim)]">{subroundTitle(pk)}</h3>
                <CardsOf data={data} k={pk} only={[companyId]} />
              </section>
            ))}
          </div>
        </Panel>
      ) : null}
      <EngagementTable data={data} rows={mine} title={`Your firms · ${companyLabel(data.companies.find((c) => c.id === companyId))}`} />
    </>
  );
}
