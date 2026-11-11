import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadLedgerCompanies, loadPublicLedgerPage } from "@/lib/team/public-ledger-data";
import {
  PUBLIC_KINDS,
  PUBLIC_KIND_LABELS,
  parsePublicLedgerQuery,
  publicLedgerHref,
  publicLedgerLines,
  resolvePublicFilter,
  type PublicLedgerQuery,
} from "@/lib/team/public-ledger";
import { count } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Notice, Panel, Table, Td, buttonClass, inputClass } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Ledger" };

const PATH = "/team/ledger";

// The public ledger: every transfer that is not a trade, labelled by squad and role (seed money, IPO allocations,
// advisor fees, rescue deals, consultant bonuses, published corrections), and each round's totals per company, newest
// first, 50 a page, filtered by company and kind. A fund's own trades are private (its Trade page). Clearings,
// the IPO and corrections broadcast and refresh the page; fees and deals do not, so it re-reads every 30 s while they
// can happen.
export default async function PublicLedgerPage({ searchParams }: PageProps<"/team/ledger">) {
  const { event, status } = await loadTeamContext();
  const q = parsePublicLedgerQuery(await searchParams);
  const companies = await loadLedgerCompanies(event.id);
  const filter = resolvePublicFilter(q, companies);
  const page = filter.problems.length ? null : await loadPublicLedgerPage(event.id, filter, q.page);
  const lines = page ? publicLedgerLines(page.rows, companies) : [];
  const tickers = companies.flatMap((c) => (c.ticker ? [c.ticker] : []));
  const rescue = phaseReached(status.phase, "CRISIS") && !phaseReached(status.phase, "PLANS_PUBLISHED");

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={30_000} active={rescue} />
      <Panel title="Public ledger">
        <p className="mb-3 text-sm text-slate-600">
          Every transfer that is not a trade, labelled by squad and role, and each round&apos;s totals per company. Individual funds&apos; trades stay private.
        </p>
        <Form action={PATH} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Company</span>
            <select name="company" defaultValue={q.company ?? ""} className={`${inputClass} w-36`}>
              <option value="">All</option>
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Kind</span>
            <select name="kind" defaultValue={q.kind ?? ""} className={`${inputClass} w-44`}>
              <option value="">All</option>
              {PUBLIC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PUBLIC_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.primary}>
            Filter
          </button>
          {q.company || q.kind ? (
            <Link href={PATH} className={buttonClass.secondary}>
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
            <Pager q={q} page={page.paging.page} pages={page.paging.pages} label={page.paging.label} />
            <Table
              head={["Time", "Kind", "Who", "Company", "Cash", "Shares", "Price", "Details"]}
              label="Public ledger rows"
              empty={q.company || q.kind ? "No rows match this filter." : "Nothing in the public ledger yet."}
              className="mt-2"
            >
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td mono>{l.time}</Td>
                  <Td>{l.kindLabel}</Td>
                  <Td>{l.label}</Td>
                  <Td mono className="font-semibold">
                    {l.ticker}
                  </Td>
                  <Td mono className="text-right">
                    {l.cash}
                  </Td>
                  <Td mono className="text-right">
                    {l.shares}
                  </Td>
                  <Td mono className="text-right">
                    {l.price}
                  </Td>
                  <Td className="text-slate-600">
                    <span className="block min-w-48 max-w-md whitespace-normal">{l.details}</span>
                  </Td>
                </tr>
              ))}
            </Table>
            {page.paging.pages > 1 ? <Pager q={q} page={page.paging.page} pages={page.paging.pages} label={page.paging.label} bottom /> : null}
          </>
        ) : null}
      </Panel>
    </div>
  );
}

function Pager({ q, page, pages, label, bottom = false }: { q: PublicLedgerQuery; page: number; pages: number; label: string; bottom?: boolean }) {
  const link = "rounded-md px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50";
  const off = "rounded-md px-2 py-1 text-sm text-slate-300 ring-1 ring-inset ring-slate-100";
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label={bottom ? "Ledger pages (bottom)" : "Ledger pages"}>
      <span className="text-sm text-slate-600">
        {label}
        {pages > 1 ? ` · page ${count(page)} of ${count(pages)}` : ""}
      </span>
      {pages > 1 ? (
        <span className="flex gap-2">
          {page > 1 ? (
            <Link href={publicLedgerHref(PATH, q, { page: page - 1 })} className={link}>
              ← Newer
            </Link>
          ) : (
            <span className={off}>← Newer</span>
          )}
          {page < pages ? (
            <Link href={publicLedgerHref(PATH, q, { page: page + 1 })} className={link}>
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
