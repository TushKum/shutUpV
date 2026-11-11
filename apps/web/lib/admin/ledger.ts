// The ledger view's pure logic: the filter in the address (?team=&kind=&ticker=&page=), paging, the lines of the
// table, and the books check (every transaction balances; each team's cash, and the exchange's, equals the sum of
// its ledger rows). Money stays integer cents throughout: bigint columns arrive as numbers or strings, and sums are
// taken as BigInt.

import { RULES } from "@msim/engine";
import { count, money } from "@/lib/format";

export type Cents = number | string;

/** The ledger_kind enum, in the order of the night. */
export const LEDGER_KINDS = [
  "STARTING_CASH",
  "ISSUE",
  "SEED",
  "IPO_ALLOCATION",
  "TRADE",
  "FEE",
  "FEE_DEFAULT",
  "DEAL",
  "SHORT_CLOSE",
  "BONUS_PLAN",
  "BONUS_DEAL",
  "CALL_EARNINGS",
  "CORRECTION",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  STARTING_CASH: "Starting cash",
  ISSUE: "Share issue",
  SEED: "Seed",
  IPO_ALLOCATION: "IPO allocation",
  TRADE: "Trade",
  FEE: "Fee",
  FEE_DEFAULT: "Default fee",
  DEAL: "Deal",
  SHORT_CLOSE: "Short close",
  BONUS_PLAN: "Plan bonus",
  BONUS_DEAL: "Deal bonus",
  CALL_EARNINGS: "Call earnings",
  CORRECTION: "Correction",
};

export const isLedgerKind = (k: string): k is LedgerKind => (LEDGER_KINDS as readonly string[]).includes(k);

export const PAGE_SIZE = 50;

/** The team filter's value for the exchange's own rows (team_id is null). */
export const EXCHANGE = "EXCHANGE";

// ───────────────────────────── Rows as read through RLS ─────────────────────────────

export interface TeamRef {
  id: string;
  code: string;
  track: "PRODUCT" | "CONSULTING" | "FINANCE";
  name: string;
}

export interface CompanyRef {
  id: string;
  ticker: string | null;
  product_team_id: string;
}

export interface RoundRef {
  id: string;
  number: number;
}

export interface LedgerRow {
  id: number | string;
  created_at: string;
  txn_id: string;
  kind: string;
  team_id: string | null;
  company_id: string | null;
  lot: string | null;
  cash_delta_cents: Cents;
  share_delta: number;
  price_cents: number | null;
  round_id: string | null;
  memo: string | null;
}

// ───────────────────────────── Conversions and labels ─────────────────────────────

/** A bigint column (a number or its string form) as a BigInt. Refuses anything that is not a whole number. */
export function bigCents(v: Cents | bigint | null | undefined): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new Error(`not a whole number of cents: ${String(v)}`);
}

/**
 * Cents as money, exactly, at any size: "$1,234.56", "−$0.50" (the same form as money(), which stops at 2^53 cents;
 * a sum of many bigint rows is formatted here digit by digit).
 */
export function bigMoney(c: Cents | bigint): string {
  const b = bigCents(c);
  const abs = b < 0n ? -b : b;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${b < 0n ? "−" : ""}$${whole}.${frac}`;
}

/** "+$12.34", "−$0.50", "$0.00". */
export function signedMoney(c: Cents | bigint): string {
  const b = bigCents(c);
  return b > 0n ? `+${bigMoney(b)}` : bigMoney(b);
}

/** "+3,000", "−500", "0". */
export function signedCount(n: number): string {
  return n > 0 ? `+${count(n)}` : n < 0 ? `−${count(-n)}` : "0";
}

/** The first 8 characters of a transaction id: enough to tell transactions apart on a screen. */
export const shortTxn = (id: string) => id.slice(0, 8);

/** A company's ticker, or (before the pitch sets one) its Product team's code. */
export function companyLabel(c: CompanyRef | undefined, teams: ReadonlyMap<string, TeamRef>): string {
  if (!c) return "—";
  return c.ticker ?? `${teams.get(c.product_team_id)?.code ?? "?"}’s company`;
}

// ───────────────────────────── The filter in the address ─────────────────────────────

export interface LedgerQuery {
  page: number;
  /** A team code, EXCHANGE, or null for every party. */
  team: string | null;
  kind: string | null;
  ticker: string | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function parseLedgerQuery(sp: SearchParams): LedgerQuery {
  const page = first(sp.page);
  const n = /^\d{1,6}$/.test(page) ? Number(page) : 1;
  return {
    page: n >= 1 ? n : 1,
    team: first(sp.team).toUpperCase() || null,
    kind: first(sp.kind).toUpperCase() || null,
    ticker: first(sp.ticker).toUpperCase() || null,
  };
}

/** The address of the ledger with `patch` applied; a changed filter goes back to page 1. */
export function ledgerHref(base: string, q: LedgerQuery, patch: Partial<LedgerQuery> = {}): string {
  const filterChanged = (["team", "kind", "ticker"] as const).some((k) => k in patch && patch[k] !== q[k]);
  const next = { ...q, ...patch, page: patch.page ?? (filterChanged ? 1 : q.page) };
  const params = new URLSearchParams();
  if (next.team) params.set("team", next.team);
  if (next.kind) params.set("kind", next.kind);
  if (next.ticker) params.set("ticker", next.ticker);
  if (next.page > 1) params.set("page", String(next.page));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

/** What the filter selects, in ids; `problems` names a filter value that matches nothing in this event. */
export interface ResolvedFilter {
  teamId: string | null;
  exchange: boolean;
  kind: LedgerKind | null;
  companyId: string | null;
  problems: string[];
}

export function resolveFilter(q: LedgerQuery, teams: readonly TeamRef[], companies: readonly CompanyRef[]): ResolvedFilter {
  const out: ResolvedFilter = { teamId: null, exchange: false, kind: null, companyId: null, problems: [] };
  if (q.team === EXCHANGE) out.exchange = true;
  else if (q.team) {
    const t = teams.find((x) => x.code === q.team);
    if (t) out.teamId = t.id;
    else out.problems.push(`No team ${q.team} in this event.`);
  }
  if (q.kind) {
    if (isLedgerKind(q.kind)) out.kind = q.kind;
    else out.problems.push(`No ledger kind ${q.kind}.`);
  }
  if (q.ticker) {
    const c = companies.find((x) => x.ticker === q.ticker);
    if (c) out.companyId = c.id;
    else out.problems.push(`No company ${q.ticker} in this event.`);
  }
  return out;
}

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
export function paging(total: number, requested: number, size = PAGE_SIZE): Paging {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pages);
  const from = (page - 1) * size;
  const to = from + size - 1;
  const label = total === 0 ? "No rows" : `Rows ${count(from + 1)}–${count(Math.min(total, to + 1))} of ${count(total)}`;
  return { page, pages, from, to, label };
}

// ───────────────────────────── Table lines ─────────────────────────────

export interface LedgerLine {
  id: string;
  at: string;
  txnId: string;
  txn: string;
  kind: string;
  kindLabel: string;
  /** A team code, or "Exchange". */
  party: string;
  exchange: boolean;
  ticker: string;
  lot: string;
  cash: string;
  cashSign: -1 | 0 | 1;
  shares: string;
  price: string;
  round: string;
  memo: string;
}

export interface LedgerRefs {
  teams: ReadonlyMap<string, TeamRef>;
  companies: ReadonlyMap<string, CompanyRef>;
  rounds: ReadonlyMap<string, number>;
}

export function ledgerRefs(teams: readonly TeamRef[], companies: readonly CompanyRef[], rounds: readonly RoundRef[]): LedgerRefs {
  return {
    teams: new Map(teams.map((t) => [t.id, t])),
    companies: new Map(companies.map((c) => [c.id, c])),
    rounds: new Map(rounds.map((r) => [r.id, r.number])),
  };
}

export function ledgerLines(rows: readonly LedgerRow[], refs: LedgerRefs): LedgerLine[] {
  return rows.map((r) => {
    const cash = bigCents(r.cash_delta_cents);
    const round = r.round_id ? refs.rounds.get(r.round_id) : undefined;
    return {
      id: String(r.id),
      at: r.created_at,
      txnId: r.txn_id,
      txn: shortTxn(r.txn_id),
      kind: r.kind,
      kindLabel: isLedgerKind(r.kind) ? LEDGER_KIND_LABELS[r.kind] : r.kind,
      party: r.team_id ? (refs.teams.get(r.team_id)?.code ?? "?") : "Exchange",
      exchange: !r.team_id,
      ticker: r.company_id ? companyLabel(refs.companies.get(r.company_id), refs.teams) : "",
      lot: r.lot ?? "",
      cash: cash === 0n ? "" : signedMoney(cash),
      cashSign: cash > 0n ? 1 : cash < 0n ? -1 : 0,
      shares: r.share_delta ? signedCount(r.share_delta) : "",
      price: r.price_cents === null || r.price_cents === undefined ? "" : money(r.price_cents),
      round: round === undefined ? "" : String(round),
      memo: r.memo ?? "",
    };
  });
}

// ───────────────────────────── Books check ─────────────────────────────

/** The columns the books check needs, for every ledger row of the event. */
export interface BooksRow {
  txn_id: string;
  kind: string;
  team_id: string | null;
  company_id: string | null;
  cash_delta_cents: Cents;
  share_delta: number;
}

export interface BooksTeam {
  id: string;
  code: string;
  cash_cents: Cents;
}

export interface BooksResult {
  ok: boolean;
  transactions: number;
  rows: number;
  problems: string[];
}

/** Rows that create shares rather than move them: the issue at the draw (Product's 60,000, the IPO's 35,000, seed 5,000). */
const ISSUING = new Set(["ISSUE", "SEED"]);

/**
 * Every transaction's cash sums to zero; its shares sum to zero per company (except the issue at the draw, which
 * must create exactly 100,000 shares per company); each team's cash equals the sum of its rows' cash, and the
 * exchange's cash equals the sum of the exchange's rows.
 */
export function checkBooks(
  rows: readonly BooksRow[],
  teams: readonly BooksTeam[],
  exchangeCash: Cents,
  companies: readonly CompanyRef[] = [],
): BooksResult {
  const txnCash = new Map<string, { kind: string; cash: bigint }>();
  const txnShares = new Map<string, { txn: string; kind: string; company: string; shares: bigint }>();
  const issued = new Map<string, bigint>();
  const teamCash = new Map<string, bigint>();
  let exchange = 0n;

  for (const r of rows) {
    const cash = bigCents(r.cash_delta_cents);
    const t = txnCash.get(r.txn_id) ?? { kind: r.kind, cash: 0n };
    t.cash += cash;
    txnCash.set(r.txn_id, t);
    if (r.share_delta && r.company_id) {
      if (ISSUING.has(r.kind)) issued.set(r.company_id, (issued.get(r.company_id) ?? 0n) + BigInt(r.share_delta));
      else {
        const k = `${r.txn_id}|${r.company_id}`;
        const s = txnShares.get(k) ?? { txn: r.txn_id, kind: r.kind, company: r.company_id, shares: 0n };
        s.shares += BigInt(r.share_delta);
        txnShares.set(k, s);
      }
    }
    if (r.team_id) teamCash.set(r.team_id, (teamCash.get(r.team_id) ?? 0n) + cash);
    else exchange += cash;
  }

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const codes = new Map(teams.map((t) => [t.id, t.code]));
  const tickers = new Map(companies.map((c) => [c.id, c.ticker ?? `${codes.get(c.product_team_id) ?? "?"}’s company`]));
  const kindLabel = (k: string) => (isLedgerKind(k) ? LEDGER_KIND_LABELS[k] : k);
  const problems: string[] = [];

  for (const [txn, t] of txnCash) {
    if (t.cash !== 0n) problems.push(`Transaction ${shortTxn(txn)} (${kindLabel(t.kind)}): cash is off by ${signedMoney(t.cash)}.`);
  }
  for (const s of txnShares.values()) {
    if (s.shares !== 0n) {
      problems.push(`Transaction ${shortTxn(s.txn)} (${kindLabel(s.kind)}): ${tickers.get(s.company) ?? "a company"}’s shares are off by ${signedCount(Number(s.shares))}.`);
    }
  }
  for (const [company, n] of issued) {
    if (n !== BigInt(RULES.SHARES_PER_COMPANY)) {
      problems.push(`${tickers.get(company) ?? "A company"}: ${count(Number(n))} shares issued, not ${count(RULES.SHARES_PER_COMPANY)}.`);
    }
  }
  for (const t of teams) {
    const sum = teamCash.get(t.id) ?? 0n;
    const cash = bigCents(t.cash_cents);
    if (sum !== cash) problems.push(`${t.code}: cash is ${bigMoney(cash)} but its ledger rows sum to ${bigMoney(sum)}.`);
  }
  for (const id of teamCash.keys()) {
    if (!teamById.has(id)) problems.push("A ledger row names a team that is not in this event.");
  }
  const exch = bigCents(exchangeCash);
  if (exch !== exchange) problems.push(`Exchange: cash is ${bigMoney(exch)} but its ledger rows sum to ${bigMoney(exchange)}.`);

  return { ok: problems.length === 0, transactions: txnCash.size, rows: rows.length, problems };
}

/**
 * The teams' cash and the exchange's, as one comparable value. The books check reads the cash, then every ledger row
 * (several requests), then the cash again: if the two snapshots differ, a transaction committed in between and the
 * read is repeated, so a clearing during the read is never reported as a broken book.
 */
export function cashSnapshot(teams: readonly BooksTeam[], exchangeCash: Cents): string {
  return [...teams]
    .map((t) => `${t.id}:${bigCents(t.cash_cents)}`)
    .sort()
    .concat(`exchange:${bigCents(exchangeCash)}`)
    .join("|");
}

/** The books check as one status line. */
export function booksLine(r: BooksResult): string {
  if (!r.ok) return `The books do not balance: ${r.problems.length === 1 ? "1 problem" : `${count(r.problems.length)} problems`}.`;
  return `The books balance: ${count(r.transactions)} transaction${r.transactions === 1 ? "" : "s"} (${count(r.rows)} row${r.rows === 1 ? "" : "s"}) balance, and every team’s cash and the exchange’s equal the sum of their ledger rows.`;
}

