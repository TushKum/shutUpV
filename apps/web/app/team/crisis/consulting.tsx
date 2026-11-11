// The Consulting firm's crisis room: its profile in the directory, the offers made to it (accept, decline, counter),
// each client of the sub-round (the crisis card, the client's response plan as it stands, and the advice memo the firm
// writes for it, or the Round 3 solution co-written with the client), its engagements and the firm league.

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
import { Badge, Notice, Panel, inputClass } from "@/components/ui/ui";
import { ContentView } from "../squad/parts";
import { DraftEditor } from "../squad/draft-editor";
import { saveFirmProfile } from "./actions";
import { CardsOf, EngagementTable, FirmLeague, OfferCard, companyLabel } from "./parts";

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

  return (
    <div className="space-y-6">
      <Panel title="Your firm's profile">
        <p className="mb-3 text-sm text-paper">Every Product team sees this in the firm directory when it chooses whom to hire.</p>
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
          </div>
        </ActionForm>
      </Panel>

      {k !== null ? (
        <Panel title={`Offers · ${subroundTitle(k)}`}>
          <p className="mb-3 text-sm text-paper">
            {hiring
              ? `Hiring closes at ${clock(stepAt(data.deadlines, "HIRE", k))}. You take at most ${FIRM_CLIENTS_PER_SUBROUND} clients this sub-round (${clients.length} so far). Accepted cash is held in escrow and paid to you at the due time if your memo is submitted.`
              : "Hiring for this sub-round is closed."}
          </p>
          {offers.length === 0 ? (
            <p className="text-sm text-muted">No offer yet. A complete profile helps.</p>
          ) : (
            <ul className="space-y-2">
              {offers.map((o) => (
                <OfferCard key={o.id} offer={o} side="FIRM" hiring={hiring} counterpart={companyLabel(company.get(o.company_id))} />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {k !== null && clients.length > 0 ? (
        <>
          <AutoRefresh everyMs={10_000} active />
          <RefreshAt at={stepAt(data.deadlines, "DUE", k)} />
          {clients.map((e) => {
            const c = company.get(e.company_id);
            const label = companyLabel(c);
            // Round 3: the firm co-writes the solution; Round 2: it writes its own memo and reads the client's plan.
            const writeType: SubmissionType = k === 5 ? "SOLUTION" : adviceOf(k);
            const plan = planOf(k);
            const win = submissionWindow(writeType, "CONSULTING", winInput);
            const draftRow = draftOf(data.clientDrafts, e.company_id, writeType);
            const planDraft = k === 5 ? null : draftOf(data.clientDrafts, e.company_id, plan);
            const planSub = k === 5 ? null : data.clientSubmissions.find((s) => s.company_id === e.company_id && s.type === plan && s.superseded_at === null);
            const cur = data.clientSubmissions.find((s) => s.company_id === e.company_id && s.type === writeType && s.superseded_at === null);
            return (
              <Panel key={e.id} title={`Client ${label} · ${termsText(money(e.cash_cents), e.shares)}`}>
                {k < 5 ? <CardsOf data={data} k={k} only={[e.company_id]} /> : null}
                {k < 5 ? (
                  <details className="mt-3 border border-line p-3" open={!!(planSub ?? planDraft)}>
                    <summary className="cursor-pointer text-sm font-semibold text-[var(--term-amber)]">
                      The client&apos;s response plan {planSub ? <Badge tone="green">Submitted {clock(planSub.submitted_at)}</Badge> : planDraft ? <Badge tone="amber">Draft v{planDraft.version}</Badge> : <Badge tone="slate">Not started</Badge>}
                    </summary>
                    <div className="mt-2">
                      {planSub ?? planDraft ? <ContentView type={plan} content={(planSub ?? planDraft)!.content} /> : <p className="text-sm text-muted">Nothing written yet.</p>}
                    </div>
                  </details>
                ) : null}
                <h3 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wider text-[var(--term-amber)]">
                  {k === 5 ? "The solution (with your client)" : "Your advice memo"} · up to {RULES.WORD_LIMIT[writeType]} words
                </h3>
                <DraftEditor
                  type={writeType}
                  draft={toSnapshot(draftRow) ?? EMPTY}
                  editable={win.editable}
                  closedNote={win.note}
                  deadline={win.deadline}
                  paused={ctx.status.paused}
                  pausedAt={ctx.status.paused_at}
                  squad={{ product_team_id: c?.product_team_id ?? "", consulting_team_id: me, finance_team_id: "" }}
                  me={me}
                  storageKey={backupKey(e.company_id, me, writeType)}
                  submitted={cur ? { content: cur.content, submittedAt: cur.submitted_at } : null}
                  companyId={e.company_id}
                />
                {cur ? (
                  <p className="mt-2 text-xs text-muted">
                    Submitted at {clock(cur.submitted_at, true)} ({cur.word_count} words). You can submit again until the due time.
                  </p>
                ) : null}
              </Panel>
            );
          })}
        </>
      ) : k !== null ? (
        <Notice>No client this sub-round yet. Clients appear here once you accept an offer (or a company accepts your counter).</Notice>
      ) : null}

      <EngagementTable data={data} rows={data.engagements.filter((e) => e.firm_team_id === me)} title="Your engagements" />
      <FirmLeague data={data} me={me} />
    </div>
  );
}
