import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { loadBook, loadReleased } from "@/lib/team/market-data";
import { BOOK_PUBLIC_FROM, BOOK_TITLES, openBooks, parseBookKind, verdict } from "@/lib/team/market";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { Submission } from "../submission";
import { CrisisCard } from "../crisis-card";
import { BookTabs } from "../tabs";

export const metadata: Metadata = { title: "Market" };

const TIER_TONE = { 1: "green", 0: "slate", [-1]: "red" } as const;

// A book: every company's public submission of one type, or its crisis card, in ticker order, with a jump list: the
// pitch book from Reading, the crisis cards from the crisis, the rescue plans (each with its company's crisis card)
// from Plans published, the flash answers once their scores are released. Released verdicts are shown with each
// entry; nothing is ranked.
export default async function BookPage({ searchParams }: PageProps<"/team/market/book">) {
  const kind = parseBookKind((await searchParams).type);
  const { event, status, company: own } = await loadTeamContext();
  const sb = await supabaseServer();
  const released = await loadReleased(sb, event.id);
  const open = openBooks(status.phase, released);
  if (!open.includes(kind)) {
    return (
      <div className="space-y-4">
        <BookTabs open={open} current={kind} />
        <Notice>{BOOK_PUBLIC_FROM[kind]}</Notice>
      </div>
    );
  }
  const book = await loadBook(event.id, kind);
  const companies = book.companies;
  const entries = kind === "CRISIS" ? companies.filter((c) => c.crisis_card_id).length : book.submissions.size;

  return (
    <div className="space-y-6">
      <BookTabs open={open} current={kind} />
      <Panel title={`${BOOK_TITLES[kind]} (${entries} of ${companies.length})`}>
        <nav aria-label="Companies" className="flex flex-wrap gap-1.5">
          {companies.map((c) => (
            <a key={c.id} href={`#${c.ticker}`} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700 hover:bg-slate-200">
              {c.ticker}
            </a>
          ))}
        </nav>
      </Panel>
      {companies.map((c) => {
        const s = kind === "CRISIS" ? undefined : book.submissions.get(c.id);
        const score = book.scores.get(c.id);
        const v = score ? verdict(score) : null;
        const crisis = c.crisis_card_id ? book.crises.get(c.crisis_card_id) : undefined;
        return (
          <section key={c.id} id={c.ticker ?? c.id} className="scroll-mt-4" aria-label={`${c.ticker} ${BOOK_TITLES[kind].toLowerCase()}`}>
            <Panel
              title={
                <span className="flex flex-wrap items-baseline gap-2">
                  <Link href={`/team/market/${c.ticker}`} className="font-mono underline underline-offset-2">
                    {c.ticker}
                  </Link>
                  <span>{c.name}</span>
                  {own?.id === c.id ? <Badge tone="violet">Your squad</Badge> : null}
                </span>
              }
              actions={
                v ? (
                  <span className="flex items-center gap-2 text-sm" data-testid="book-verdict">
                    <span className="font-mono font-semibold">{v.score}</span>
                    <Badge tone={TIER_TONE[v.tierSign]}>{v.tier}</Badge>
                  </span>
                ) : null
              }
            >
              {kind === "CRISIS" ? (
                crisis ? (
                  <CrisisCard card={crisis} />
                ) : (
                  <p className="text-sm text-slate-500">No crisis card.</p>
                )
              ) : (
                <>
                  {kind === "PLAN" && crisis ? (
                    <div className="mb-3">
                      <CrisisCard card={crisis} compact />
                    </div>
                  ) : null}
                  {s ? <Submission type={kind} s={s} /> : <p className="text-sm text-slate-500">Nothing was submitted on time.</p>}
                  {v?.notes.length ? <p className="mt-2 text-xs text-slate-500">{v.notes.join(" ")}</p> : null}
                </>
              )}
            </Panel>
          </section>
        );
      })}
    </div>
  );
}
