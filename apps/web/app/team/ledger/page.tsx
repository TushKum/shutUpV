import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { loadTeamContext } from "@/lib/team/context";
import { loadLedgerCompanies, loadPublicLedgerPage } from "@/lib/team/public-ledger-data";
import {
  PUBLIC_KINDS,
  PUBLIC_KIND_LABELS,
  SIDES,
  hasFilter,
  parsePublicLedgerQuery,
  publicLedgerHref,
  publicLedgerLines,
  resolvePublicFilter,
  type PublicLedgerQuery,
} from "@/lib/team/public-ledger";
import { count } from "@/lib/format";
import { Notice, Panel, Table, Td, buttonClass, inputClass } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Ledger" };

const PATH = "/team/ledger";

// The public ledger: every filled trade once its round clears (team code, company, buy or sell, quantity, price), each
// round's totals per company and published corrections, newest first, 50 a page, filtered by kind, company, team and
// side. Clearings and corrections broadcast and refresh the page.
export default async function PublicLedgerPage({ searchParams }: PageProps<"/team/ledger">) {
  const { event } = await loadTeamContext();
  const q = parsePublicLedgerQuery(await searchParams);
  const companies = await loadLedgerCompanies(event.id);
  const filter = resolvePublicFilter(q, companies);
  const page = filter.problems.length ? null : await loadPublicLedgerPage(event.id, filter, q.page);
  const lines = page ? publicLedgerLines(page.rows, companies) : [];
  const tickers = companies.flatMap((c) => (c.ticker ? [c.ticker] : []));

  return (
    <div className="space-y-6">
      <Panel title="Public ledger">
        <p className="mb-3 text-sm text-slate-600">
          Every filled trade is public once its round clears: the team, the company, buy or sell, the quantity and the price. Round totals show the net and the new
          price.
        </p>
        <Form action={PATH} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Kind</span>
            <select name="kind" defaultValue={q.kind ?? ""} className={`${inputClass} w-36`}>
              <option value="">All</option>
              {PUBLIC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PUBLIC_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Company</span>
            <select name="company" defaultValue={q.company ?? ""} className={`${inputClass} w-32`}>
              <option value="">All</option>
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Team</span>
            <input name="team" defaultValue={q.team ?? ""} placeholder="A101" maxLength={4} className={`${inputClass} w-24 font-mono uppercase`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Side</span>
            <select name="side" defaultValue={q.side ?? ""} className={`${inputClass} w-28`}>
              <option value="">Both</option>
              {SIDES.map((s) => (
                <option key={s} value={s}>
                  {s === "BUY" ? "Buys" : "Sells"}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.primary}>
            Filter
          </button>
          {hasFilter(q) ? (
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
              head={["Time", "Round", "Kind", "Team", "Company", "Side", "Shares", "Price", "Value", "Details"]}
              label="Public ledger rows"
              empty={hasFilter(q) ? "No rows match this filter." : "Nothing in the public ledger yet: trades appear when round 1 clears at 02:30."}
              className="mt-2"
            >
              {lines.map((l) => (
                <tr key={l.id} data-testid={`ledger-${l.kind}`}>
                  <Td mono>{l.time}</Td>
                  <Td mono className="text-right">
                    {l.round}
                  </Td>
                  <Td>{l.kindLabel}</Td>
                  <Td mono className="font-semibold">
                    {l.team}
                  </Td>
                  <Td mono className="font-semibold">
                    {l.ticker}
                  </Td>
                  <Td mono className={l.side === "BUY" ? "text-emerald-700" : l.side === "SELL" ? "text-red-700" : ""}>
                    {l.side}
                  </Td>
                  <Td mono className="text-right">
                    {l.shares}
                  </Td>
                  <Td mono className="text-right">
                    {l.price}
                  </Td>
                  <Td mono className="text-right">
                    {l.value}
                  </Td>
                  <Td className="text-slate-600">
                    <span className="block min-w-40 max-w-md whitespace-normal">{l.details}</span>
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
