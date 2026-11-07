// The public ledger as every team sees it: every filled trade once its round clears (team code, company, buy or sell,
// quantity, price), each round's totals per company (bought, sold, the net and the new price) and published
// corrections. Newest first, 50 rows a page, filtered by kind, company, team and side (?kind=&company=&team=&side=&page=).
// Pure.

import { clock, count, money, signedCount } from "@/lib/format";

export const PUBLIC_KINDS = ["TRADE", "ROUND", "CORRECTION"] as const;
export type PublicKind = (typeof PUBLIC_KINDS)[number];

export const PUBLIC_KIND_LABELS: Record<PublicKind, string> = {
  TRADE: "Trade",
  ROUND: "Round totals",
  CORRECTION: "Correction",
};

export const SIDES = ["BUY", "SELL"] as const;
export type Side = (typeof SIDES)[number];

export const isPublicKind = (k: string): k is PublicKind => (PUBLIC_KINDS as readonly string[]).includes(k);
const isSide = (s: string): s is Side => (SIDES as readonly string[]).includes(s);

export const PAGE_SIZE = 50;

export interface Paging {
  page: number;
  pages: number;
  /** Row offsets for .range(from, to). */
  from: number;
  to: number;
  /** "Rows 51–100 of 230". */
  label: string;
}

/** The page to show (a page past the end shows the last one). */
export function pageOf(total: number, requested: number, size = PAGE_SIZE, noun = "Rows"): Paging {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pages);
  const from = (page - 1) * size;
  const to = from + size - 1;
  const label = total === 0 ? `No ${noun.toLowerCase()}` : `${noun} ${count(from + 1)}–${count(Math.min(total, to + 1))} of ${count(total)}`;
  return { page, pages, from, to, label };
}

// ───────────────────────────── The filter in the address ─────────────────────────────

export interface PublicLedgerQuery {
  page: number;
  /** A ticker, or null for every company. */
  company: string | null;
  /** A team code, or null for every team. */
  team: string | null;
  kind: string | null;
  side: string | null;
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const FILTERS = ["kind", "company", "team", "side"] as const;

export function parsePublicLedgerQuery(sp: SearchParams): PublicLedgerQuery {
  const page = first(sp.page);
  const n = /^\d{1,6}$/.test(page) ? Number(page) : 1;
  const up = (k: (typeof FILTERS)[number]) => first(sp[k]).toUpperCase().slice(0, 16) || null;
  return { page: n >= 1 ? n : 1, kind: up("kind"), company: up("company"), team: up("team"), side: up("side") };
}

/** The address with `patch` applied; a changed filter goes back to page 1. */
export function publicLedgerHref(base: string, q: PublicLedgerQuery, patch: Partial<PublicLedgerQuery> = {}): string {
  const changed = FILTERS.some((k) => k in patch && patch[k] !== q[k]);
  const next = { ...q, ...patch, page: patch.page ?? (changed ? 1 : q.page) };
  const params = new URLSearchParams();
  for (const k of FILTERS) if (next[k]) params.set(k, next[k]!);
  if (next.page > 1) params.set("page", String(next.page));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

export const hasFilter = (q: PublicLedgerQuery) => FILTERS.some((k) => q[k] !== null);

export interface CompanyRef {
  id: string;
  ticker: string | null;
}

export interface PublicFilter {
  companyId: string | null;
  team: string | null;
  kind: PublicKind | null;
  side: Side | null;
  /** A filter value that matches nothing (said plainly instead of an empty table). */
  problems: string[];
}

/** Team codes are checked only for their shape (a letter and three digits): the ledger itself lists who traded. */
export function resolvePublicFilter(q: PublicLedgerQuery, companies: readonly CompanyRef[]): PublicFilter {
  const out: PublicFilter = { companyId: null, team: null, kind: null, side: null, problems: [] };
  if (q.company) {
    const c = companies.find((x) => x.ticker === q.company);
    if (c) out.companyId = c.id;
    else out.problems.push(`No listed company ${q.company}.`);
  }
  if (q.team) {
    if (/^[A-Z][0-9]{3}$/.test(q.team)) out.team = q.team;
    else out.problems.push(`${q.team} is not a team code (a letter and three digits, like A101).`);
  }
  if (q.kind) {
    if (isPublicKind(q.kind)) out.kind = q.kind;
    else out.problems.push(`No ledger kind ${q.kind}.`);
  }
  if (q.side) {
    if (isSide(q.side)) out.side = q.side;
    else out.problems.push(`No side ${q.side} (BUY or SELL).`);
  }
  return out;
}

// ───────────────────────────── Lines ─────────────────────────────

export interface PublicLedgerRow {
  id: number | string;
  created_at: string;
  kind: string;
  label: string;
  team_code: string | null;
  company_id: string | null;
  ticker: string | null;
  side: string | null;
  cash_cents: number | string | null;
  shares: number | null;
  price_cents: number | null;
  round_number: number | null;
  details: Record<string, unknown> | null;
}

export interface PublicLedgerLine {
  id: string;
  at: string;
  time: string;
  kind: string;
  kindLabel: string;
  round: string;
  team: string;
  ticker: string;
  side: string;
  shares: string;
  price: string;
  value: string;
  details: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);

/** The extra facts of a row, in words: what a round traded, a correction's reason. */
export function detailsText(kind: string, d: Record<string, unknown> | null): string {
  const x = d ?? {};
  switch (kind) {
    case "ROUND": {
      const before = num(x.before);
      return `bought ${count(num(x.buy) ?? 0)} · sold ${count(num(x.sell) ?? 0)}${before !== null ? ` · was ${money(before)}` : ""}`;
    }
    case "CORRECTION": {
      const n = num(x.entries);
      const reason = typeof x.reason === "string" ? x.reason : "";
      return [reason, n !== null ? `${count(n)} ${n === 1 ? "entry" : "entries"}` : ""].filter(Boolean).join(" · ");
    }
    default:
      return "";
  }
}

/** Table lines. Tickers come from the row or, failing that, from the company. */
export function publicLedgerLines(rows: readonly PublicLedgerRow[], companies: readonly CompanyRef[]): PublicLedgerLine[] {
  const tickers = new Map(companies.map((c) => [c.id, c.ticker]));
  return rows.map((r) => {
    const cash = r.cash_cents === null || r.cash_cents === undefined ? null : num(r.cash_cents);
    return {
      id: String(r.id),
      at: r.created_at,
      time: clock(r.created_at, true),
      kind: r.kind,
      kindLabel: isPublicKind(r.kind) ? PUBLIC_KIND_LABELS[r.kind] : r.kind,
      round: r.round_number === null ? "—" : String(r.round_number),
      team: r.team_code ?? "—",
      ticker: r.ticker ?? (r.company_id ? (tickers.get(r.company_id) ?? "—") : "—"),
      side: r.side ?? "—",
      // A round's net can be negative (more sold than bought); a trade's quantity is what changed hands.
      shares: r.shares === null ? "—" : r.kind === "ROUND" ? signedCount(r.shares) : count(r.shares),
      price: r.price_cents === null ? "—" : money(r.price_cents),
      value: cash === null ? "—" : money(cash),
      details: detailsText(r.kind, r.details),
    };
  });
}
