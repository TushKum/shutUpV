import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { loadTeamContext } from "@/lib/team/context";
import { loadQaCompanies, loadQaPage, loadUnanswered } from "@/lib/team/qa-data";
import { answerState, askState, parseQaQuery, qaHref, type BoardFacts, type QaQuery, type Thread } from "@/lib/team/qa";
import { loadDeadline } from "@/lib/team/round-data";
import { clock, count, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, buttonClass, inputClass } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { RefreshAt } from "@/lib/live/refresh-at";
import { answerQuestion, postQuestion } from "./actions";
import { AnswerForm, AskForm } from "./forms";

export const metadata: Metadata = { title: "Q&A" };

const PATH = "/team/qa";

// The Q&A board (23:45–00:15): this team asks the founders of the company it rescues, and answers the team that rescues
// its own company (until 01:45). Every question and answer is public, newest first, per company or all together. New
// posts arrive over the event's realtime channel, which refreshes the page.
export default async function QaPage({ searchParams }: PageProps<"/team/qa">) {
  const { event, status, built, rescued } = await loadTeamContext();
  const q = parseQaQuery(await searchParams);
  const [qaClose, solutionLock] = await Promise.all([loadDeadline(event.id, "QA_CLOSE"), loadDeadline(event.id, "SOLUTION_LOCK")]);
  const facts: BoardFacts = {
    phase: status.phase,
    paused: status.paused,
    pausedAt: status.paused_at,
    nowMs: new Date(status.server_time).getTime(),
    crisisApplied: !!event.crisis_applied_at,
    qaClose,
    solutionLock,
  };
  const ask = askState(facts);
  const answer = answerState(facts);

  if (ask === "NOT_YET") {
    return (
      <Panel title="Q&A board">
        <Notice>
          The board opens at the crisis (23:45). You ask the founders of the company you rescue (up to 300 characters, until 00:15), and you answer the team
          that rescues your company (up to 150 words). Everything on the board is public.
        </Notice>
      </Panel>
    );
  }

  const companies = await loadQaCompanies(event.id);
  const filtered = q.company ? (companies.find((c) => c.ticker === q.company) ?? null) : null;
  const [page, waiting] = await Promise.all([
    q.company && !filtered ? null : loadQaPage(event.id, filtered?.id ?? null, q.page),
    answer === "OPEN" && built ? loadUnanswered(built.id) : Promise.resolve([]),
  ]);
  const tickers = new Map(companies.map((c) => [c.id, c.ticker]));

  return (
    <div className="space-y-6">
      <RefreshAt at={ask === "OPEN" ? qaClose : answer === "OPEN" ? solutionLock : null} />
      {ask === "OPEN" && rescued ? (
        <Panel
          title={`Ask ${rescued.ticker}'s founders`}
          actions={
            qaClose ? (
              <span className="text-sm text-slate-600">
                Questions close at {clock(qaClose)} · <Countdown to={qaClose} className="font-semibold text-slate-900" />
              </span>
            ) : null
          }
        >
          <p className="mb-3 text-sm text-slate-600">
            You rescue <span className="font-mono font-semibold">{rescued.ticker}</span> {rescued.name}. Ask what you need to write its crisis solution.
          </p>
          <AskForm action={postQuestion} ticker={rescued.ticker ?? "the company"} />
        </Panel>
      ) : ask === "CLOSED" ? (
        <Notice>Questions closed at {clock(qaClose)}. {answer === "OPEN" ? `Founders can still answer until ${clock(solutionLock)}.` : "Every question and answer stays readable."}</Notice>
      ) : null}

      {answer === "OPEN" && built ? (
        <Panel title={`Questions to your company ${built.ticker ?? ""} waiting for an answer (${count(waiting.length)})`}>
          {waiting.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is waiting for an answer.</p>
          ) : (
            <ul className="space-y-4" aria-label="Questions waiting for your answer">
              {waiting.map((w) => (
                <li key={w.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
                  <QuestionHead ticker={built.ticker ?? "—"} at={w.created_at} />
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{w.body}</p>
                  <div className="mt-2">
                    <AnswerForm action={answerQuestion.bind(null, w.id)} label={`Answer the question asked at ${clock(w.created_at, true)}`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel title="The board">
        <Form action={PATH} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Company</span>
            <select name="company" defaultValue={q.company ?? ""} className={`${inputClass} w-48`}>
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.ticker}>
                  {c.ticker}
                  {c.id === built?.id ? " (yours)" : c.id === rescued?.id ? " (you rescue it)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.primary}>
            Show
          </button>
          {q.company ? (
            <Link href={PATH} className={buttonClass.secondary}>
              All
            </Link>
          ) : null}
        </Form>

        {!page ? (
          <div className="mt-4">
            <Notice tone="amber">No company has the ticker {q.company}.</Notice>
          </div>
        ) : (
          <>
            <Pager q={q} page={page.paging.page} pages={page.paging.pages} label={page.paging.label} />
            {page.threads.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{filtered ? `No questions to ${filtered.ticker} yet.` : "No questions yet."}</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100" aria-label="Questions and answers">
                {page.threads.map((t) => (
                  <ThreadItem
                    key={t.question.id}
                    t={t}
                    ticker={tickers.get(t.question.company_id) ?? "—"}
                    canAnswer={answer === "OPEN" && t.question.company_id === built?.id && t.answers.length > 0}
                  />
                ))}
              </ul>
            )}
            {page.paging.pages > 1 ? <Pager q={q} page={page.paging.page} pages={page.paging.pages} label={page.paging.label} bottom /> : null}
          </>
        )}
      </Panel>
    </div>
  );
}

function QuestionHead({ ticker, at }: { ticker: string; at: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <Link href={`/team/market/${ticker}`} className="font-mono text-sm font-semibold text-slate-900 underline underline-offset-2">
        {ticker}
      </Link>
      <span>its rescuing team asked</span>
      <time dateTime={at} title={`${dateTime(at)} IST`} className="font-mono tabular-nums">
        {clock(at, true)}
      </time>
    </div>
  );
}

function ThreadItem({ t, ticker, canAnswer }: { t: Thread; ticker: string; canAnswer: boolean }) {
  return (
    <li className="py-3" data-testid="qa-thread">
      <QuestionHead ticker={ticker} at={t.question.created_at} />
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{t.question.body}</p>
      {t.answers.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          <Badge tone="amber">No answer yet</Badge>
        </p>
      ) : (
        <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
          {t.answers.map((a) => (
            <li key={a.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{ticker}&apos;s founders answered</span>
                <time dateTime={a.created_at} className="font-mono tabular-nums">
                  {clock(a.created_at, true)}
                </time>
                <span>{count(a.word_count)} words</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canAnswer ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Add another answer</summary>
          <div className="mt-2">
            <AnswerForm action={answerQuestion.bind(null, t.question.id)} label={`Add an answer to the question asked at ${clock(t.question.created_at, true)}`} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

function Pager({ q, page, pages, label, bottom = false }: { q: QaQuery; page: number; pages: number; label: string; bottom?: boolean }) {
  const link = "rounded-md px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50";
  const off = "rounded-md px-2 py-1 text-sm text-slate-300 ring-1 ring-inset ring-slate-100";
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label={bottom ? "Question pages (bottom)" : "Question pages"}>
      <span className="text-sm text-slate-600">
        {label}
        {pages > 1 ? ` · page ${count(page)} of ${count(pages)}` : ""}
      </span>
      {pages > 1 ? (
        <span className="flex gap-2">
          {page > 1 ? (
            <Link href={qaHref(PATH, q, { page: page - 1 })} className={link}>
              ← Newer
            </Link>
          ) : (
            <span className={off}>← Newer</span>
          )}
          {page < pages ? (
            <Link href={qaHref(PATH, q, { page: page + 1 })} className={link}>
              Older →
            </Link>
          ) : (
            <span className={off}>Older →</span>
          )}
        </span>
      ) : null}
    </nav>
  );
}
