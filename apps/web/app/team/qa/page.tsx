import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { loadTeamContext } from "@/lib/team/context";
import { loadQaCompanies, loadQaPage, loadUnanswered } from "@/lib/team/qa-data";
import { boardRole, boardState, parseQaQuery, qaHref, type QaQuery, type QuestionRow, type Thread } from "@/lib/team/qa";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, count, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, buttonClass, inputClass } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { answerQuestion, postQuestion } from "./actions";
import { AnswerForm, AskForm } from "./forms";

export const metadata: Metadata = { title: "Q&A" };

const PATH = "/team/qa";

// The Q&A board: every question with its answers, newest first, per company or all together. Funds ask; the Product
// team answers questions about its own company (its unanswered questions are listed first, oldest first); every
// question and answer is public. Who asked is never shown (a fund); an answer is shown as its company's. New posts
// arrive over the event's realtime channel, which refreshes the page.
export default async function QaPage({ searchParams }: PageProps<"/team/qa">) {
  const { team, event, status, company: own } = await loadTeamContext();
  const q = parseQaQuery(await searchParams);
  const state = boardState(status.phase);
  const role = boardRole(team.track);
  const sb = await supabaseServer();
  const { data: times, error } = await sb.from("phases").select("code, starts_at").eq("event_id", event.id).in("code", ["READING", "CLOSE"]);
  if (error) throw new Error(`Could not read the schedule: ${error.message}`);
  const startOf = (code: string) => (times ?? []).find((t) => t.code === code)?.starts_at as string | undefined;

  if (state === "NOT_YET") {
    return (
      <Panel title="Q&A board">
        <Notice>
          The Q&A board opens {startOf("READING") ? `at ${clock(startOf("READING"))} ` : ""}(Reading) with the pitch book. Finance teams ask questions; each Product
          team answers questions about its own company, in up to 100 words. Everything on the board is public.
        </Notice>
      </Panel>
    );
  }

  const companies = await loadQaCompanies(event.id);
  const filtered = q.company ? (companies.find((c) => c.ticker === q.company) ?? null) : null;
  const ownListed = own ? (companies.find((c) => c.id === own.id) ?? null) : null;
  const [page, waiting] = await Promise.all([
    q.company && !filtered ? null : loadQaPage(event.id, filtered?.id ?? null, q.page),
    state === "OPEN" && role === "ANSWER" && ownListed ? loadUnanswered(ownListed.id) : Promise.resolve([] as QuestionRow[]),
  ]);
  const tickers = new Map(companies.map((c) => [c.id, c.ticker]));
  const closes = startOf("CLOSE");

  return (
    <div className="space-y-6">
      {state === "CLOSED" ? (
        <Notice>The Q&A board closed at the close. Every question and answer stays readable.</Notice>
      ) : (
        <p className="text-sm text-slate-600" data-testid="qa-open">
          Open until the close
          {closes ? (
            <>
              {" "}
              ({clock(closes)}, in <Countdown to={closes} passed="a moment" />)
            </>
          ) : null}
          . Everything on the board is public; who asked is never shown (only that a fund asked), and answers are shown as their company&apos;s.
        </p>
      )}

      {state === "OPEN" && role === "ASK" ? (
        <Panel title="Ask a question">
          <AskForm action={postQuestion} companies={companies} initial={filtered?.id ?? null} />
        </Panel>
      ) : null}

      {state === "OPEN" && role === "ANSWER" && ownListed ? (
        <Panel title={`Waiting for your answer (${count(waiting.length)})`}>
          {waiting.length === 0 ? (
            <p className="text-sm text-slate-500">No question to {ownListed.ticker} is waiting for an answer.</p>
          ) : (
            <ul className="space-y-4" aria-label="Questions waiting for your answer">
              {waiting.map((w) => (
                <li key={w.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
                  <QuestionHead ticker={ownListed.ticker} at={w.created_at} />
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

      <Panel title="Questions">
        <Form action={PATH} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Company</span>
            <select name="company" defaultValue={q.company ?? ""} className={`${inputClass} w-48`}>
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.ticker}>
                  {c.ticker}
                  {c.id === own?.id ? " (yours)" : ""}
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
            <Notice tone="amber">No listed company has the ticker {q.company}.</Notice>
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
                    canAnswer={state === "OPEN" && role === "ANSWER" && t.question.company_id === own?.id && t.answers.length > 0}
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
      <span>A fund asked</span>
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
                <span className="font-semibold text-slate-700">{ticker} answered</span>
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
