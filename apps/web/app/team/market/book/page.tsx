import type { Metadata } from "next";
import Link from "next/link";
import { SUBMISSION_TYPES, type SubmissionType } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadBook, loadReleased } from "@/lib/team/market-data";
import { PUBLIC_FROM, publicTypes, verdict } from "@/lib/team/market";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { Submission } from "../submission";

export const metadata: Metadata = { title: "Market" };

const BOOK_TITLES: Record<SubmissionType, string> = { PITCH: "Pitch book", PLAN: "Rescue plans", FLASH: "Flash answers" };
const TIER_TONE = { 1: "green", 0: "slate", [-1]: "red" } as const;

// A book: every company's public submission of one type, in ticker order, with a jump list (the pitch book from
// Reading, the rescue plans from Plans published with each company's crisis card, the flash answers once their scores
// are released). Released verdicts are shown with each entry; nothing is ranked.
export default async function BookPage({ searchParams }: PageProps<"/team/market/book">) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.type) ? sp.type[0] : sp.type)?.toUpperCase() ?? "PITCH";
  const type = (SUBMISSION_TYPES as readonly string[]).includes(raw) ? (raw as SubmissionType) : "PITCH";
  const { event, status, company: own } = await loadTeamContext();
  const sb = await supabaseServer();
  const released = await loadReleased(sb, event.id);
  const open = publicTypes(status.phase, released);
  const tabs = (
    <nav aria-label="Books" className="flex flex-wrap gap-2">
      <Link href="/team/market" className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
        ← Prices
      </Link>
      {SUBMISSION_TYPES.filter((t) => open.includes(t)).map((t) => (
        <Link
          key={t}
          href={`/team/market/book?type=${t}`}
          aria-current={t === type ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${t === type ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"}`}
        >
          {BOOK_TITLES[t]}
        </Link>
      ))}
    </nav>
  );
  if (!open.includes(type)) {
    return (
      <div className="space-y-4">
        {tabs}
        <Notice>{PUBLIC_FROM[type]}</Notice>
      </div>
    );
  }
  const book = await loadBook(event.id, type);
  const companies = book.companies;

  return (
    <div className="space-y-6">
      {tabs}
      <Panel title={`${BOOK_TITLES[type]} (${book.submissions.size} of ${companies.length})`}>
        <nav aria-label="Companies" className="flex flex-wrap gap-1.5">
          {companies.map((c) => (
            <a key={c.id} href={`#${c.ticker}`} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700 hover:bg-slate-200">
              {c.ticker}
            </a>
          ))}
        </nav>
      </Panel>
      {companies.map((c) => {
        const s = book.submissions.get(c.id);
        const score = book.scores.get(c.id);
        const v = score ? verdict(score) : null;
        const crisis = type === "PLAN" && c.crisis_card_id ? book.crises.get(c.crisis_card_id) : undefined;
        return (
          <section key={c.id} id={c.ticker ?? c.id} className="scroll-mt-4">
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
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-semibold">{v.score}</span>
                    <Badge tone={TIER_TONE[v.tierSign]}>{v.tier}</Badge>
                  </span>
                ) : null
              }
            >
              {crisis ? (
                <p className="mb-3 border-l-4 border-red-600 bg-red-50/70 py-1 pl-3 text-sm">
                  <span className="font-semibold text-red-800">Crisis · {crisis.category}:</span> {crisis.title}
                </p>
              ) : null}
              {s ? <Submission type={type} s={s} /> : <p className="text-sm text-slate-500">Nothing was submitted on time.</p>}
              {v?.notes.length ? <p className="mt-2 text-xs text-slate-500">{v.notes.join(" ")}</p> : null}
            </Panel>
          </section>
        );
      })}
    </div>
  );
}
