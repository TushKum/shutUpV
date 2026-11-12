// The Consulting firm's crisis room, as numbered steps: its profile in the directory, the offers made to it (accept,
// decline, counter), then each client (the crisis card, the client's plan as it stands, and the advice memo the firm
// writes for it; in Round 3 also the solution it can edit with the client), and its results: engagements and the league.

import Link from "next/link";
import { RULES, adviceOf, planOf, type SubmissionType } from "@msim/engine";
import { clock, money } from "@/lib/format";
import type { TeamContext } from "@/lib/team/context";
import { draftOf, type CrisisRoomData } from "@/lib/team/crisis-data";
import { FIRM_CLIENTS_PER_SUBROUND, hiringOpen, stepAt, subroundTitle, termsText } from "@/lib/team/crisis";
import { backupKey, toSnapshot } from "@/lib/team/editor";
import { submissionWindow } from "@/lib/team/squad";
import { pauseOf } from "@/lib/team/squad-data";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { ActionForm } from "@/components/ui/action";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";
import { Badge, Notice, inputClass } from "@/components/ui/ui";
import { ContentView } from "../squad/parts";
import { DraftEditor } from "../squad/draft-editor";
import { saveFirmProfile } from "./actions";
import { CardsOf, EngagementTable, FirmLeague, OfferCard, StatementBoard, Step, companyLabel, type StepState } from "./parts";

const EMPTY = { version: 0, content: {}, updatedAt: null, updatedBy: null };

export function ConsultingRoom({ ctx, data, k, nowMs }: { ctx: TeamContext; data: CrisisRoomData; k: number | null; nowMs: number }) {
  const pause = pauseOf(ctx);
  const me = ctx.team.id;
  const profile = data.profiles.get(me);
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pause);
  const company = new Map(data.companies.map((c) => [c.id, c]));
  const offers = k === null ? [] : data.offers.filter((o) => o.firm_team_id === me && o.k === k);
  const clients = k === null ? [] : data.engagements.filter((e) => e.firm_team_id === me && e.k === k);
  const winInput = {
    ...pause,
    phase: ctx.status.phase,
    drawn: ctx.status.drawn,
    nowMs,
    deadlines: data.deadlines,
    flashPublishedAt: null,
    flashReleased: false,
  };

  const r3 = k === 5;
  const myTurn = offers.filter((o) => o.status === "OPEN" && o.turn === "FIRM").length;
  const profileDone = !!profile?.headline;
  const hireAt = k === null ? "" : clock(stepAt(data.deadlines, "HIRE", k));
  const dueAt = k === null ? "" : clock(stepAt(data.deadlines, "DUE", k));
  const full = clients.length >= FIRM_CLIENTS_PER_SUBROUND;
  const offersState: StepState = k === null ? "later" : myTurn ? "now" : hiring ? (full ? "done" : "read") : clients.length ? "done" : "closed";
  const offersSummary =
    k === null
      ? "Offers arrive when the first crisis card is revealed."
      : myTurn
        ? `${myTurn === 1 ? "1 offer is" : `${myTurn} offers are`} waiting for your answer. Hiring closes at ${hireAt}.`
        : hiring
          ? full
            ? `You have ${FIRM_CLIENTS_PER_SUBROUND} clients: you are full for this ${r3 ? "round" : "crisis"}.`
            : `No offer to answer right now. Companies can send offers until ${hireAt} (${clients.length} of ${FIRM_CLIENTS_PER_SUBROUND} clients so far).`
          : clients.length
            ? `Hiring is closed. You have ${clients.length === 1 ? "1 client" : `${clients.length} clients`}.`
            : `Hiring is closed. No client this ${r3 ? "round" : "crisis"}.`;
  const memoType: SubmissionType | null = k === null ? null : adviceOf(k);
  const memoWin = memoType ? submissionWindow(memoType, "CONSULTING", winInput) : null;
  const memoSent = (companyId: string) => (memoType ? data.clientSubmissions.find((s) => s.company_id === companyId && s.type === memoType && s.superseded_at === null) : undefined);
  const allSent = clients.length > 0 && clients.every((e) => memoSent(e.company_id));
  const clientsState: StepState = k === null || clients.length === 0 ? (hiring || k === null ? "later" : "closed") : allSent ? "done" : memoWin?.stage === "OPEN" ? "now" : "closed";
  const clientsSummary =
    k === null || clients.length === 0
      ? hiring || k === null
        ? "A client appears here when you accept an offer."
        : "No client, so nothing to write. The next crisis brings new offers."
      : allSent
        ? `Memo sent for every client.${memoWin?.stage === "OPEN" ? ` You can send better versions until ${dueAt}.` : ""}`
        : memoWin?.stage === "OPEN"
          ? `Write a memo of up to ${RULES.WORD_LIMIT[memoType!]} words for each client by ${dueAt}. No memo: no fee.`
          : `Writing closed at ${dueAt}.`;

  return (
    <div className="space-y-4">
      <Step
        n={1}
        title="Your firm's profile"
        state={profileDone ? "done" : "now"}
        testId="step-profile"
        summary={profileDone ? `“${profile!.headline}” · asking ${profile!.asking_cents > 0 ? money(profile!.asking_cents) : "—"}. Tap to edit.` : "Companies read it to choose a firm. Fill it in first."}
      >
        <DoThis testId="profile-todo">Say what your firm is good at and what it asks for, then press Save profile.</DoThis>
        <p className="mb-3 mt-1 text-sm text-paper">
          Every Product team sees this in the firm directory.{" "}
          <Link href={`/team/firms/${encodeURIComponent(ctx.team.code)}`} className="text-[var(--term-amber)] hover:underline">
            See your public profile →
          </Link>
        </p>
        <ActionForm action={saveFirmProfile} submit="Save profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-paper">Headline</span>
              <input name="headline" maxLength={140} defaultValue={profile?.headline ?? ""} placeholder="Turnarounds for hardware start-ups" className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-paper">Specialities (comma-separated, up to 8)</span>
              <input name="specialities" defaultValue={profile?.specialities.join(", ") ?? ""} placeholder="supply chain, pricing, PR" className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-paper">Asking fee ($)</span>
              <input name="asking" inputMode="decimal" defaultValue={profile ? (profile.asking_cents / 100).toFixed(2) : ""} className={`${inputClass} mt-1 font-mono`} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-paper">Rate card</span>
              <textarea name="rate_card" maxLength={600} rows={3} defaultValue={profile?.rate_card ?? ""} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-paper">About the firm (who you are, how you work, past wins)</span>
              <textarea name="about" maxLength={1000} rows={4} defaultValue={profile?.about ?? ""} className={`${inputClass} mt-1`} />
            </label>
          </div>
        </ActionForm>
      </Step>

      <Step n={2} title="Answer offers from companies" state={offersState} summary={offersSummary} testId="step-offers" open={offers.length > 0 && (hiring || myTurn > 0)}>
        {offers.length === 0 ? (
          <p className="text-sm text-muted">No offer yet. A complete profile helps.</p>
        ) : (
          <ul className="space-y-2">
            {offers.map((o) => (
              <OfferCard key={o.id} offer={o} side="FIRM" hiring={hiring} counterpart={companyLabel(company.get(o.company_id))} />
            ))}
          </ul>
        )}
        <HowItWorks testId="offers-rules">
          <p>A company offers you cash, shares or both. Accept, decline, or send a counter-offer; each side can counter three times.</p>
          <p>
            You take at most {FIRM_CLIENTS_PER_SUBROUND} clients per {r3 ? "round" : "crisis"}. Accepting is final.
          </p>
          <p>The cash is kept safe (in escrow) and paid to you at the due time, but only if your memo for that client is submitted.</p>
        </HowItWorks>
      </Step>

      <Step n={3} title={clients.length > 1 ? "Write a memo for each client" : "Write your advice memo"} state={clientsState} summary={clientsSummary} testId="step-clients" open={clients.length > 0}>
        {k !== null && clients.length > 0 ? (
          <div className="space-y-6">
            <AutoRefresh everyMs={10_000} active />
            <RefreshAt at={stepAt(data.deadlines, "DUE", k)} />
            {clients.map((e) => {
              const c = company.get(e.company_id);
              const label = companyLabel(c);
              const plan = planOf(k);
              const memo = adviceOf(k);
              const win = submissionWindow(memo, "CONSULTING", winInput);
              const draftRow = draftOf(data.clientDrafts, e.company_id, memo);
              const planDraft = draftOf(data.clientDrafts, e.company_id, plan);
              const planSub = data.clientSubmissions.find((s) => s.company_id === e.company_id && s.type === plan && s.superseded_at === null);
              const cur = memoSent(e.company_id);
              const squadOf = { product_team_id: c?.product_team_id ?? "", consulting_team_id: me, finance_team_id: "" };
              return (
                <section key={e.id} id={`client-${e.company_id}`} className="scroll-mt-32 border border-line bg-panel p-3" aria-label={`Client ${label}`} data-testid="client">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-base font-bold text-[var(--term-amber)]">Client {label}</h3>
                    <span className="font-mono text-sm text-paper">fee {termsText(money(e.cash_cents), e.shares)}</span>
                    {cur ? <Badge tone="green">Memo sent {clock(cur.submitted_at)}</Badge> : <Badge tone="amber">Memo not sent</Badge>}
                    <Link href={`/team/messages?c=${e.company_id}&f=${me}`} className="ml-auto text-sm font-semibold text-[var(--term-amber)] hover:underline">
                      Chat with this client →
                    </Link>
                  </div>
                  {r3 ? null : (
                    <div className="mt-3">
                      <CardsOf data={data} k={k} only={[e.company_id]} />
                    </div>
                  )}
                  {r3 ? null : (
                    <details className="mt-3 border border-line p-3" open={!!(planSub ?? planDraft)}>
                      <summary className="cursor-pointer text-sm font-semibold text-[var(--term-amber)]">
                        The client&apos;s response plan {planSub ? <Badge tone="green">Submitted {clock(planSub.submitted_at)}</Badge> : planDraft ? <Badge tone="amber">Draft v{planDraft.version}</Badge> : <Badge tone="slate">Not started</Badge>}
                      </summary>
                      <div className="mt-2">
                        {planSub ?? planDraft ? <ContentView type={plan} content={(planSub ?? planDraft)!.content} /> : <p className="text-sm text-muted">Nothing written yet.</p>}
                      </div>
                    </details>
                  )}
                  <h4 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wider text-[var(--term-amber)]">Your advice memo · up to {RULES.WORD_LIMIT[memo]} words</h4>
                  <DraftEditor
                    type={memo}
                    draft={toSnapshot(draftRow) ?? EMPTY}
                    editable={win.editable}
                    closedNote={win.note}
                    deadline={win.deadline}
                    paused={ctx.status.paused}
                    pausedAt={ctx.status.paused_at}
                    squad={squadOf}
                    me={me}
                    storageKey={backupKey(e.company_id, me, memo)}
                    submitted={cur ? { content: cur.content, submittedAt: cur.submitted_at } : null}
                    companyId={e.company_id}
                  />
                  {cur ? (
                    <p className="mt-2 text-xs text-muted">
                      Submitted at {clock(cur.submitted_at, true)} ({cur.word_count} words). You can submit again until the due time.
                    </p>
                  ) : null}
                  {r3 ? (
                    <details className="mt-4 border border-line p-3" data-testid="solution-coedit">
                      <summary className="cursor-pointer text-sm font-semibold text-[var(--term-amber)]">
                        The solution, written with your client · up to {RULES.WORD_LIMIT.SOLUTION} words
                      </summary>
                      <p className="my-2 text-sm text-paper">You can edit it with your client: each save shows for both. Your client submits it.</p>
                      <DraftEditor
                        type="SOLUTION"
                        draft={toSnapshot(draftOf(data.clientDrafts, e.company_id, "SOLUTION")) ?? EMPTY}
                        editable={submissionWindow("SOLUTION", "CONSULTING", winInput).editable}
                        closedNote={submissionWindow("SOLUTION", "CONSULTING", winInput).note}
                        deadline={submissionWindow("SOLUTION", "CONSULTING", winInput).deadline}
                        paused={ctx.status.paused}
                        pausedAt={ctx.status.paused_at}
                        squad={squadOf}
                        me={me}
                        storageKey={backupKey(e.company_id, me, "SOLUTION")}
                        submitted={(() => {
                          const sol = data.clientSubmissions.find((s) => s.company_id === e.company_id && s.type === "SOLUTION" && s.superseded_at === null);
                          return sol ? { content: sol.content, submittedAt: sol.submitted_at } : null;
                        })()}
                        companyId={e.company_id}
                      />
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <Notice>No client this {r3 ? "round" : "crisis"} yet. Clients appear here once you accept an offer (or a company accepts your counter).</Notice>
        )}
        <HowItWorks label="How you earn" testId="memo-rules">
          <p>Your fee is paid at the due time if your memo for that client is submitted; otherwise the client gets it back.</p>
          <p>After the due time the client rates you 1 to 5 stars, and the judge scores your memo. A good memo and a good rating add a bonus; poor ones take money away.</p>
        </HowItWorks>
      </Step>

      {r3 ? <StatementBoard data={data} /> : null}

      <details className="mx-panel rounded-lg" data-testid="firm-results">
        <summary className="cursor-pointer px-4 py-3 text-base font-bold text-phosphor">Your results: clients, ratings and the firm league</summary>
        <div className="space-y-4 border-t border-line p-4">
          <EngagementTable data={data} rows={data.engagements.filter((e) => e.firm_team_id === me)} title="Your engagements" />
          <FirmLeague data={data} me={me} />
        </div>
      </details>
    </div>
  );
}
