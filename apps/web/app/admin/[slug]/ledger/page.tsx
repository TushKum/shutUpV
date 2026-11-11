import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import {
  EXCHANGE,
  LEDGER_KINDS,
  LEDGER_KIND_LABELS,
  booksLine,
  ledgerHref,
  ledgerLines,
  ledgerRefs,
  parseLedgerQuery,
  resolveFilter,
  type LedgerQuery,
} from "@/lib/admin/ledger";
import { loadBooks, loadLedgerBase, loadLedgerPage, type BooksStatus } from "@/lib/admin/ledger-data";
import { clock, count } from "@/lib/format";
import { Notice, Panel, Table, Td, buttonClass, inputClass } from "@/components/ui/ui";
import { LedgerTabs } from "./tabs";

export const metadata: Metadata = { title: "Ledger" };

const MAX_PROBLEMS = 20;
const tone = (sign: number) => (sign > 0 ? "text-emerald-700" : sign < 0 ? "text-red-700" : "");

// Ledger: every row of the event's ledger, newest first, 50 a page, filtered by team (or the exchange), kind and
// ticker; above it, the books check (every transaction balances; each team's cash and the exchange's equal the sum of
// their rows).
export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const sb = await supabaseServer();
  const q = parseLedgerQuery(await searchParams);
  const base = await loadLedgerBase(sb, event.id);
  const filter = resolveFilter(q, base.teams, base.companies);
  const [page, books, pending] = await Promise.all([
    filter.problems.length ? null : loadLedgerPage(sb, event.id, filter, q.page),
    loadBooks(sb, event.id, base.companies),
    sb.from("corrections").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("status", "PENDING"),
  ]);
  const refs = ledgerRefs(base.teams, base.companies, base.rounds);
  const lines = page ? ledgerLines(page.rows, refs) : [];
  const path = `/admin/${slug}/ledger`;
  const tickers = base.companies.flatMap((c) => (c.ticker ? [c.ticker] : [])).sort();

  return (
    <div className="space-y-6">
      <LedgerTabs slug={slug} current="ledger" pending={pending.count ?? 0} />
      <BooksCheck books={books} />

      <Panel title="Ledger">
        <Form action={path} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Team</span>
            <select name="team" defaultValue={q.team ?? ""} className={`${inputClass} w-36`}>
              <option value="">All</option>
              <option value={EXCHANGE}>Exchange</option>
              {base.teams.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Kind</span>
            <select name="kind" defaultValue={q.kind ?? ""} className={`${inputClass} w-44`}>
              <option value="">All</option>
              {LEDGER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LEDGER_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Ticker</span>
            <select name="ticker" defaultValue={q.ticker ?? ""} className={`${inputClass} w-32`}>
              <option value="">All</option>
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.primary}>
            Filter
          </button>
          {q.team || q.kind || q.ticker ? (
            <Link href={path} className={buttonClass.secondary}>
              Clear
            </Link>
          ) : null}
        </Form>

        {filter.problems.length ? (
          <div className="mt-4">
            <Notice tone="amber">{filter.problems.join(" ")}</Notice>
          </div>
        ) : page ? (
          <>
            <Pager path={path} q={q} page={page.paging.page} pages={page.paging.pages} label={page.paging.label} />
            <Table
              head={["Time", "Transaction", "Kind", "Team", "Ticker", "Lot", "Cash change", "Share change", "Price", "Round", "Memo"]}
              empty={q.team || q.kind || q.ticker ? "No ledger rows match this filter." : "No ledger rows yet."}
              className="mt-2"
            >
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td mono>{clock(l.at, true)}</Td>
                  <Td mono>
                    <span title={l.txnId}>{l.txn}</span>
                  </Td>
                  <Td>{l.kindLabel}</Td>
                  <Td mono className={l.exchange ? "text-slate-500" : "font-semibold"}>
                    {l.party}
                  </Td>
                  <Td mono>{l.ticker}</Td>
                  <Td mono>{l.lot}</Td>
                  <Td mono className={tone(l.cashSign)}>
                    {l.cash}
                  </Td>
                  <Td mono>{l.shares}</Td>
                  <Td mono>{l.price}</Td>
                  <Td mono>{l.round}</Td>
                  <Td className="text-slate-600">
                    <span className="block min-w-48 max-w-md whitespace-normal">{l.memo}</span>
                  </Td>
                </tr>
              ))}
            </Table>
            {page.paging.pages > 1 ? (
              <Pager path={path} q={q} page={page.paging.page} pages={page.paging.pages} label={page.paging.label} where="bottom" />
            ) : null}
          </>
        ) : null}
      </Panel>
    </div>
  );
}

function BooksCheck({ books }: { books: BooksStatus }) {
  if (books.ok === null) {
    return (
      <div data-testid="books-check">
        <Notice tone="amber">{books.message}</Notice>
      </div>
    );
  }
  return (
    <div data-testid="books-check">
      <Notice tone={books.ok ? "green" : "red"}>
        <strong>{booksLine(books)}</strong>
        {!books.ok ? (
          <ul className="mt-1 list-disc pl-5">
            {books.problems.slice(0, MAX_PROBLEMS).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
            {books.problems.length > MAX_PROBLEMS ? <li>… and {count(books.problems.length - MAX_PROBLEMS)} more.</li> : null}
          </ul>
        ) : null}
      </Notice>
    </div>
  );
}

function Pager({
  path,
  q,
  page,
  pages,
  label,
  where = "top",
}: {
  path: string;
  q: LedgerQuery;
  page: number;
  pages: number;
  label: string;
  where?: "top" | "bottom";
}) {
  const link = "rounded-md px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50";
  const off = "rounded-md px-2 py-1 text-sm text-slate-300 ring-1 ring-inset ring-slate-100";
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label={where === "top" ? "Ledger pages" : "Ledger pages (bottom)"}>
      <span className="text-sm text-slate-600">
        {label}
        {pages > 1 ? ` · page ${count(page)} of ${count(pages)}` : ""}
      </span>
      {pages > 1 ? (
        <span className="flex gap-2">
          {page > 1 ? (
            <Link href={ledgerHref(path, q, { page: page - 1 })} className={link}>
              ← Newer
            </Link>
          ) : (
            <span className={off}>← Newer</span>
          )}
          {page < pages ? (
            <Link href={ledgerHref(path, q, { page: page + 1 })} className={link}>
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
