import type { Metadata } from "next";
import Link from "next/link";
import { DEADLINE_LABELS, phaseReached } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import {
  BODY_MAX,
  BULLETIN_KIND_LABELS,
  COMPOSER_KINDS,
  TITLE_MAX,
  qaThreads,
  sortBulletins,
  twistState,
  type AnswerRow,
  type BulletinKind,
  type BulletinRow,
  type QuestionRow,
} from "@/lib/admin/content-bulletins";
import { fetchAll } from "@/lib/fetch-all";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, inputClass, type Tone } from "@/components/ui/ui";
import { ActionButton, ConfirmForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { hideQuestion, publishBulletin, publishTwist } from "./actions";

export const metadata: Metadata = { title: "Bulletins" };

const KIND_TONES: Record<BulletinKind, Tone> = { GENERAL: "slate", TWIST: "violet", CRISIS: "red", RUMOUR: "amber", FAIRNESS: "amber", SYSTEM: "blue" };

// Bulletins: compose and publish to every screen (general notices, rumours from Round 2), the twist (22:15), every
// bulletin so far, and the Q&A board for moderation.
export default async function BulletinsPage({ params }: PageProps<"/admin/[slug]/bulletins">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [bulletins, twistDeadline, questions, answers, companies, teams] = await Promise.all([
    sb.from("bulletins").select("id, kind, title, body, published_at, created_at").eq("event_id", event.id).limit(1000),
    sb.from("deadlines").select("at").eq("event_id", event.id).eq("code", "TWIST").maybeSingle<{ at: string }>(),
    fetchAll<QuestionRow>((f, t) => sb.from("qa_questions").select("id, company_id, asker_team_id, body, hidden, created_at").eq("event_id", event.id).order("id").range(f, t)),
    fetchAll<AnswerRow>((f, t) => sb.from("qa_answers").select("id, question_id, body, created_at").eq("event_id", event.id).order("id").range(f, t)),
    sb.from("companies").select("id, ticker, founder_team_id").eq("event_id", event.id),
    sb.from("teams").select("id, code").eq("event_id", event.id),
  ]);
  if (bulletins.error) throw new Error(`Could not read the bulletins: ${bulletins.error.message}`);
  const rows = sortBulletins((bulletins.data ?? []) as BulletinRow[]);
  const twist = twistState(rows, !!event.drawn_at);
  const threads = qaThreads(questions, answers, companies.data ?? [], teams.data ?? []);
  const rumours = phaseReached(status.phase, "RESCUE");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        {organiser ? (
          <Panel title="Compose">
            <ConfirmForm
              action={publishBulletin.bind(null, event.id, status.phase)}
              submit="Publish bulletin"
              confirm="Click again to publish to every screen"
              className="grid gap-3"
              resetOnSuccess
            >
              <label className="block max-w-xs">
                <span className="text-xs font-medium text-slate-600">Kind</span>
                <select name="kind" defaultValue={rumours ? "RUMOUR" : "GENERAL"} className={inputClass}>
                  {COMPOSER_KINDS.map((k) => (
                    <option key={k} value={k} disabled={k === "RUMOUR" && !rumours}>
                      {BULLETIN_KIND_LABELS[k]}
                      {k === "RUMOUR" && !rumours ? " (from Round 2)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Title (up to {TITLE_MAX} characters)</span>
                <input name="title" required maxLength={TITLE_MAX} autoComplete="off" className={inputClass} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Body (up to {BODY_MAX.toLocaleString("en-US")} characters)</span>
                <textarea name="body" rows={4} maxLength={BODY_MAX} className={inputClass} />
              </label>
              <p className="text-xs text-slate-500">
                A bulletin appears at once on every team screen and the big screen, and cannot be withdrawn. Rumours never change any price. The twist is
                written under{" "}
                <Link href={`/admin/${slug}/content`} className="underline">
                  Content
                </Link>
                .
              </p>
            </ConfirmForm>
          </Panel>
        ) : (
          <Notice>The fairness officer can read every bulletin and the Q&amp;A board here; only organisers publish.</Notice>
        )}

        <Panel title={`Q&A board (${threads.length} question${threads.length === 1 ? "" : "s"})`}>
          <p className="text-sm text-slate-600">
            The rescuing team asks the team that built the company (while the Q&A board is open); the founders may answer until the crisis solution form locks. Everything is public; a hidden
            question (and its answers) leaves every team screen but stays here.
          </p>
          {threads.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No questions yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100" aria-label="Questions">
              {threads.map((q) => (
                <li key={q.id} className={`py-3 ${q.hidden ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono font-semibold">{q.ticker}</span>
                    <span className="text-slate-500">
                      {q.asker} asks {q.founder} · {clock(q.createdAt, true)}
                    </span>
                    {q.hidden ? <Badge tone="slate">Hidden</Badge> : null}
                    {organiser ? (
                      <ActionButton action={hideQuestion.bind(null, q.id, !q.hidden)} confirm={q.hidden ? undefined : "Click again to hide this question"}>
                        {q.hidden ? "Show again" : "Hide"}
                      </ActionButton>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{q.body}</p>
                  {q.answers.map((a) => (
                    <p key={a.id} className="mt-1 whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-sm text-slate-700">
                      {a.body} <span className="text-xs text-slate-400">{clock(a.createdAt, true)}</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`All bulletins (${rows.length})`}>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No bulletins yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Bulletins">
              {rows.map((b) => (
                <li key={b.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={KIND_TONES[b.kind]}>{BULLETIN_KIND_LABELS[b.kind]}</Badge>
                    {b.published_at ? (
                      <span className="font-mono tabular-nums text-slate-600" title={`${dateTime(b.published_at)} IST`}>
                        {clock(b.published_at, true)}
                      </span>
                    ) : (
                      <Badge tone="amber">Not published</Badge>
                    )}
                    <span className="font-semibold text-slate-900">{b.title}</span>
                  </div>
                  {b.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{b.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="min-w-0 space-y-6">
        <Panel title="The twist">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt>{DEADLINE_LABELS.TWIST}</dt>
              <dd className="font-mono tabular-nums">
                {clock(twistDeadline.data?.at)} · <Countdown to={twistDeadline.data?.at} passed="due" />
              </dd>
            </div>
          </dl>
          <div className="mt-3" data-testid="twist-state">
            {!twist.bulletin ? (
              <Notice tone="amber">
                Not written yet. Write it under{" "}
                <Link href={`/admin/${slug}/content`} className="underline">
                  Content
                </Link>
                .
              </Notice>
            ) : (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                {twist.published ? <Badge tone="green">Published {clock(twist.bulletin.published_at, true)}</Badge> : <Badge tone="violet">Written, not published</Badge>}
                <p className="mt-1 font-semibold text-slate-900">{twist.bulletin.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{twist.bulletin.body}</p>
              </div>
            )}
          </div>
          {organiser ? (
            <div className="mt-4">
              <ActionButton
                action={publishTwist.bind(null, event.id)}
                confirm={twist.bulletin && !twist.published ? `Click again to publish “${twist.bulletin.title}” now` : undefined}
                variant="primary"
                disabled={!!twist.blocked}
                title={twist.blocked ?? undefined}
              >
                Publish the twist now
              </ActionButton>
              <p className="mt-2 text-xs text-slate-500">{twist.blocked ?? "The phase clock publishes it at the twist time on its own; use this only if you need it earlier."}</p>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
