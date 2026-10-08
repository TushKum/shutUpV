// CSV exports of one event (ledger, prices per round, scores, final results). Pure: the route handler reads the rows
// (export-data.ts) and this module turns them into RFC 4180 CSV.
//
// - Money and prices are integer cents, written exactly as stored (bigint columns arrive as numbers or strings;
//   a value that is not a whole number is an error, never rounded).
// - Times are written in IST with the offset ("2026-10-08T21:05:09.123456+05:30"), keeping the stored precision.
// - A text cell that a spreadsheet could run as a formula (it starts with = + - @, a tab or a CR) is prefixed with
//   a single quote. Number cells are whole numbers we validated, so "-1500" stays a number.

import { SUBMISSION_TYPES, TRACKS, type SubmissionType, type Track } from "@msim/engine";

export const EXPORT_KINDS = ["ledger", "prices", "scores", "results"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(v: unknown): v is ExportKind {
  return typeof v === "string" && (EXPORT_KINDS as readonly string[]).includes(v);
}

/** What each export holds, and the table it is read from (its row count is shown on the exports page). */
export const EXPORTS: Record<ExportKind, { title: string; description: string; table: string }> = {
  ledger: {
    title: "Ledger",
    description: "Every ledger entry: team code (or Exchange), kind, ticker, lot, cash and share deltas, price, round, memo and time.",
    table: "ledger_entries",
  },
  prices: {
    title: "Prices per round",
    description: "Every price change: round, ticker, kind (IPO, clearing, crisis, tiers, close), market and AI price before and after, and the round's quantities.",
    table: "round_prices",
  },
  scores: {
    title: "Scores",
    description: "Every company's pitch, plan and flash score: judge runs, median, final score, tier, cap, penalty, missing, status and release time.",
    table: "scores",
  },
  results: {
    title: "Final results",
    description: "Every team's final value, start value, return, rank and eligibility. Empty until settlement (05:00).",
    table: "results",
  },
};

/** "<slug>-<kind>.csv". The slug is [a-z0-9-] (a database check), so it is safe in a header. */
export function exportFileName(slug: string, kind: ExportKind): string {
  return `${slug}-${kind}.csv`;
}

// ───────────────────────────── CSV writer ─────────────────────────────

export type CellKind = "int" | "text" | "bool" | "time";

export interface Column<R> {
  header: string;
  kind: CellKind;
  get: (row: R) => unknown;
}

/** A text cell that starts with = + - @, a tab or a carriage return gets a leading single quote. */
export function protectFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** RFC 4180: a field with a comma, a double quote, CR or LF is quoted, with double quotes doubled. */
export function quoteField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole number, exactly as stored (number, bigint or the string form of a bigint). Empty for null. */
export function intCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`not a whole number: ${value}`);
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const s = value.replace(/^(-?)0+(?=\d)/, "$1");
    return s === "-0" ? "0" : s;
  }
  throw new Error(`not a whole number: ${String(value)}`);
}

const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * A timestamp in IST with its offset, keeping the stored fraction of a second:
 * "2026-10-08T15:35:09.123456+00:00" → "2026-10-08T21:05:09.123456+05:30". Empty for null.
 */
export function istTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(text);
  if (!m) throw new Error(`not a timestamp: ${text}`);
  const [, y, mo, d, h, mi, s, frac = "", zone] = m;
  let offsetMin = 0;
  if (zone !== "Z") {
    const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone!)!;
    offsetMin = (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3] ?? 0));
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMin * 60_000;
  const t = new Date(utc + IST_OFFSET_MS);
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return `${date}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${frac}+05:30`;
}

export function csvCell(kind: CellKind, value: unknown): string {
  switch (kind) {
    case "int":
      return intCell(value);
    case "bool":
      return value === null || value === undefined ? "" : value ? "true" : "false";
    case "time":
      return quoteField(protectFormula(istTime(value)));
    case "text":
      return value === null || value === undefined ? "" : quoteField(protectFormula(String(value)));
  }
}

/** A header row and one row per item, every line ending in CRLF (RFC 4180). */
export function toCsv<R>(columns: readonly Column<R>[], rows: readonly R[]): string {
  const lines = [columns.map((c) => quoteField(protectFormula(c.header))).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.kind, c.get(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

// ───────────────────────────── Paging ─────────────────────────────

export const PAGE_SIZE = 1000;

/**
 * Reads a whole table through PostgREST, which returns at most 1,000 rows per request: asks for rows
 * [from, from + size − 1] until a page comes back short. The query must have a stable order.
 */
export async function fetchPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
  size = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

// ───────────────────────────── Rows and columns per export ─────────────────────────────

type Int = number | string;

export interface Lookups {
  teams: Map<string, { code: string; track: Track }>;
  tickers: Map<string, string | null>;
  rounds: Map<string, number>;
}

export function buildLookups(
  teams: readonly { id: string; code: string; track: Track }[],
  companies: readonly { id: string; ticker: string | null }[],
  rounds: readonly { id: string; number: number }[],
): Lookups {
  return {
    teams: new Map(teams.map((t) => [t.id, { code: t.code, track: t.track }])),
    tickers: new Map(companies.map((c) => [c.id, c.ticker])),
    rounds: new Map(rounds.map((r) => [r.id, r.number])),
  };
}

/** A team's code; a null team is the exchange. An id not found (never expected) is written as is. */
export const teamCode = (lk: Lookups, id: string | null) => (id === null ? "Exchange" : (lk.teams.get(id)?.code ?? id));
/** A company's ticker: empty before it has one; an id not found (never expected) is written as is. */
export const tickerOf = (lk: Lookups, id: string | null) => (id === null ? null : lk.tickers.has(id) ? (lk.tickers.get(id) ?? null) : id);
const roundNo = (lk: Lookups, id: string | null) => (id === null ? null : (lk.rounds.get(id) ?? null));

export interface LedgerExportRow {
  id: Int;
  txn_id: string;
  kind: string;
  team_id: string | null;
  company_id: string | null;
  lot: string | null;
  cash_delta_cents: Int;
  share_delta: Int;
  price_cents: Int | null;
  round_id: string | null;
  memo: string | null;
  created_at: string;
}

export function ledgerCsv(rows: readonly LedgerExportRow[], lk: Lookups): string {
  return toCsv<LedgerExportRow>(
    [
      { header: "id", kind: "int", get: (r) => r.id },
      { header: "time_ist", kind: "time", get: (r) => r.created_at },
      { header: "txn_id", kind: "text", get: (r) => r.txn_id },
      { header: "kind", kind: "text", get: (r) => r.kind },
      { header: "team", kind: "text", get: (r) => teamCode(lk, r.team_id) },
      { header: "ticker", kind: "text", get: (r) => tickerOf(lk, r.company_id) },
      { header: "lot", kind: "text", get: (r) => r.lot },
      { header: "cash_delta_cents", kind: "int", get: (r) => r.cash_delta_cents },
      { header: "share_delta", kind: "int", get: (r) => r.share_delta },
      { header: "price_cents", kind: "int", get: (r) => r.price_cents },
      { header: "round", kind: "int", get: (r) => roundNo(lk, r.round_id) },
      { header: "memo", kind: "text", get: (r) => r.memo },
    ],
    rows,
  );
}

export interface PriceExportRow {
  id: Int;
  company_id: string;
  round_id: string | null;
  kind: string;
  market_before: Int | null;
  market_after: Int;
  ai_before: Int | null;
  ai_after: Int | null;
  buy_qty: Int;
  sell_qty: Int;
  short_qty: Int;
  cover_qty: Int;
  net_qty: Int;
  capped_net: Int;
  tier_bp: Int | null;
  created_at: string;
}

const byId = (a: { id: Int }, b: { id: Int }) => {
  const x = BigInt(a.id);
  const y = BigInt(b.id);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * In the order they were written (by id), with the rows one price event wrote together (the same kind, round and
 * time: a clearing, the IPO, the crisis, a tier, the close) ordered by ticker.
 */
export function orderPrices<R extends Pick<PriceExportRow, "id" | "company_id" | "round_id" | "kind" | "created_at">>(rows: readonly R[], lk: Lookups): R[] {
  const key = (r: R) => `${r.kind}|${r.round_id ?? ""}|${r.created_at}`;
  const byTicker = (a: R, b: R) => (tickerOf(lk, a.company_id) ?? "").localeCompare(tickerOf(lk, b.company_id) ?? "") || byId(a, b);
  const out: R[] = [];
  let group: R[] = [];
  for (const r of [...rows].sort(byId)) {
    if (group.length && key(group[0]!) !== key(r)) {
      out.push(...group.sort(byTicker));
      group = [];
    }
    group.push(r);
  }
  out.push(...group.sort(byTicker));
  return out;
}

export function pricesCsv(rows: readonly PriceExportRow[], lk: Lookups): string {
  return toCsv<PriceExportRow>(
    [
      { header: "id", kind: "int", get: (r) => r.id },
      { header: "time_ist", kind: "time", get: (r) => r.created_at },
      { header: "round", kind: "int", get: (r) => roundNo(lk, r.round_id) },
      { header: "ticker", kind: "text", get: (r) => tickerOf(lk, r.company_id) },
      { header: "kind", kind: "text", get: (r) => r.kind },
      { header: "market_before_cents", kind: "int", get: (r) => r.market_before },
      { header: "market_after_cents", kind: "int", get: (r) => r.market_after },
      { header: "ai_before_cents", kind: "int", get: (r) => r.ai_before },
      { header: "ai_after_cents", kind: "int", get: (r) => r.ai_after },
      { header: "buy_qty", kind: "int", get: (r) => r.buy_qty },
      { header: "sell_qty", kind: "int", get: (r) => r.sell_qty },
      { header: "short_qty", kind: "int", get: (r) => r.short_qty },
      { header: "cover_qty", kind: "int", get: (r) => r.cover_qty },
      { header: "net_qty", kind: "int", get: (r) => r.net_qty },
      { header: "capped_net", kind: "int", get: (r) => r.capped_net },
      { header: "tier_bp", kind: "int", get: (r) => r.tier_bp },
    ],
    orderPrices(rows, lk),
  );
}

export interface ScoreExportRow {
  company_id: string;
  type: SubmissionType;
  run_totals: readonly Int[] | null;
  median: Int | null;
  final_score: Int | null;
  tier_bp: Int | null;
  capped: boolean;
  penalty: Int;
  missing: boolean;
  status: string;
  released_at: string | null;
}

/** By type (pitch, plan, flash), then ticker. */
export function scoresCsv(rows: readonly ScoreExportRow[], lk: Lookups): string {
  const sorted = [...rows].sort(
    (a, b) =>
      SUBMISSION_TYPES.indexOf(a.type) - SUBMISSION_TYPES.indexOf(b.type) ||
      String(tickerOf(lk, a.company_id) ?? "").localeCompare(String(tickerOf(lk, b.company_id) ?? "")),
  );
  return toCsv<ScoreExportRow>(
    [
      { header: "ticker", kind: "text", get: (r) => tickerOf(lk, r.company_id) },
      { header: "type", kind: "text", get: (r) => r.type },
      { header: "runs", kind: "text", get: (r) => (r.run_totals ?? []).map((t) => intCell(t)).join(" ") },
      { header: "median", kind: "int", get: (r) => r.median },
      { header: "final", kind: "int", get: (r) => r.final_score },
      { header: "tier_bp", kind: "int", get: (r) => r.tier_bp },
      { header: "capped", kind: "bool", get: (r) => r.capped },
      { header: "penalty", kind: "int", get: (r) => r.penalty },
      { header: "missing", kind: "bool", get: (r) => r.missing },
      { header: "status", kind: "text", get: (r) => r.status },
      { header: "released_at_ist", kind: "time", get: (r) => r.released_at },
    ],
    sorted,
  );
}

export interface ResultExportRow {
  team_id: string;
  track: Track;
  final_value_cents: Int;
  start_value_cents: Int;
  return_bp: Int | null;
  rank: Int | null;
  eligible: boolean;
}

/** By track (product, consulting, finance), then rank (unranked last), then team code. */
export function resultsCsv(rows: readonly ResultExportRow[], lk: Lookups): string {
  const rankOf = (r: ResultExportRow) => (r.rank === null ? Number.MAX_SAFE_INTEGER : Number(r.rank));
  const sorted = [...rows].sort(
    (a, b) => TRACKS.indexOf(a.track) - TRACKS.indexOf(b.track) || rankOf(a) - rankOf(b) || teamCode(lk, a.team_id).localeCompare(teamCode(lk, b.team_id)),
  );
  return toCsv<ResultExportRow>(
    [
      { header: "team", kind: "text", get: (r) => teamCode(lk, r.team_id) },
      { header: "track", kind: "text", get: (r) => r.track },
      { header: "final_value_cents", kind: "int", get: (r) => r.final_value_cents },
      { header: "start_value_cents", kind: "int", get: (r) => r.start_value_cents },
      { header: "return_bp", kind: "int", get: (r) => r.return_bp },
      { header: "rank", kind: "int", get: (r) => r.rank },
      { header: "eligible", kind: "bool", get: (r) => r.eligible },
    ],
    sorted,
  );
}
