// The public ledger as every team sees it (PLAN decision Q4): the transfers that are not trades, labelled by squad
// and role (seed money, IPO allocation totals, advisor fees, rescue deals, consultant bonuses, published
// corrections), and per-round per-company totals (buys, sells, shorts, covers, the net and the new price). A fund's
// own trades stay private. Newest first, 50 rows a page, filtered by company and kind (?company=&kind=&page=). Pure.

import { clock, count, money, signedCount, signedMoney } from "@/lib/format";

export const PUBLIC_KINDS = ["SEED", "IPO", "ROUND", "FEE", "FEE_DEFAULT", "DEAL", "BONUS_PLAN", "BONUS_DEAL", "CALL_EARNINGS", "CORRECTION"] as const;
export type PublicKind = (typeof PUBLIC_KINDS)[number];

export const PUBLIC_KIND_LABELS: Record<PublicKind, string> = {
  SEED: "Seed money",
  IPO: "IPO allocation",
  ROUND: "Round totals",
  FEE: "Advisor fee",
  FEE_DEFAULT: "Default fee",
  DEAL: "Rescue deal",
  BONUS_PLAN: "Plan bonus",
  BONUS_DEAL: "Deal bonus",
  CALL_EARNINGS: "Call earnings",
  CORRECTION: "Correction",
};

export const isPublicKind = (k: string): k is PublicKind => (PUBLIC_KINDS as readonly string[]).includes(k);

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
  kind: string | null;
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function parsePublicLedgerQuery(sp: SearchParams): PublicLedgerQuery {
  const page = first(sp.page);
  const n = /^\d{1,6}$/.test(page) ? Number(page) : 1;
  return { page: n >= 1 ? n : 1, company: first(sp.company).toUpperCase() || null, kind: first(sp.kind).toUpperCase() || null };
}

/** The address with `patch` applied; a changed filter goes back to page 1. */
export function publicLedgerHref(base: string, q: PublicLedgerQuery, patch: Partial<PublicLedgerQuery> = {}): string {
  const changed = (["company", "kind"] as const).some((k) => k in patch && patch[k] !== q[k]);
  const next = { ...q, ...patch, page: patch.page ?? (changed ? 1 : q.page) };
  const params = new URLSearchParams();
  if (next.company) params.set("company", next.company);
  if (next.kind) params.set("kind", next.kind);
  if (next.page > 1) params.set("page", String(next.page));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

export interface CompanyRef {
  id: string;
  ticker: string | null;
}

export interface PublicFilter {
  companyId: string | null;
  kind: PublicKind | null;
  /** A filter value that matches nothing (said plainly instead of an empty table). */
  problems: string[];
}

export function resolvePublicFilter(q: PublicLedgerQuery, companies: readonly CompanyRef[]): PublicFilter {
  const out: PublicFilter = { companyId: null, kind: null, problems: [] };
  if (q.company) {
    const c = companies.find((x) => x.ticker === q.company);
    if (c) out.companyId = c.id;
    else out.problems.push(`No listed company ${q.company}.`);
  }
  if (q.kind) {
    if (isPublicKind(q.kind)) out.kind = q.kind;
    else out.problems.push(`No ledger kind ${q.kind}.`);
  }
  return out;
}

// ───────────────────────────── Lines ─────────────────────────────

export interface PublicLedgerRow {
  id: number | string;
  created_at: string;
  kind: string;
  label: string;
  company_id: string | null;
  ticker: string | null;
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
  label: string;
  ticker: string;
  cash: string;
  shares: string;
  price: string;
  details: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);

/** The extra facts of a row, in words: what a round traded, how an IPO was subscribed, a correction's reason. */
export function detailsText(kind: string, d: Record<string, unknown> | null): string {
  const x = d ?? {};
  switch (kind) {
    case "ROUND": {
      const parts = (["buy", "sell", "short", "cover"] as const).map((k) => `${k} ${count(num(x[k]) ?? 0)}`);
      const before = num(x.before);
      return `${parts.join(" · ")}${before !== null ? ` · was ${money(before)}` : ""}`;
    }
    case "IPO": {
      const requested = num(x.requested);
      const available = num(x.available);
      const bidders = num(x.bidders);
      const bits = [];
      if (requested !== null) bits.push(`${count(requested)} requested${available !== null ? ` of ${count(available)}` : ""}`);
      if (bidders !== null) bits.push(`${count(bidders)} ${bidders === 1 ? "fund" : "funds"}`);
      return bits.join(" · ");
    }
    case "FEE":
    case "FEE_DEFAULT": {
      const v = num(x.value);
      return v !== null ? `Total value ${money(v)} (shares at the IPO price)` : "";
    }
    case "DEAL": {
      const post = num(x.post_crisis_price);
      return post !== null ? `Post-crisis price ${money(post)}` : "";
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

/** Table lines. Tickers come from the row or, for rows written before a ticker existed, from the company. */
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
      label: r.label,
      ticker: r.ticker ?? (r.company_id ? (tickers.get(r.company_id) ?? "—") : "—"),
      // A bonus can be negative (a plan bonus below 50); the other transfers are amounts moved.
      cash: cash === null ? "—" : r.kind.startsWith("BONUS") ? signedMoney(cash) : money(cash),
      shares: r.shares === null ? "—" : r.kind === "ROUND" ? signedCount(r.shares) : count(r.shares),
      price: r.price_cents === null ? "—" : money(r.price_cents),
      details: detailsText(r.kind, r.details),
    };
  });
}
