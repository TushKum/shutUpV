import { describe, expect, it } from "vitest";
import {
  EXPORT_KINDS,
  buildLookups,
  csvCell,
  exportFileName,
  fetchPages,
  intCell,
  isExportKind,
  istTime,
  ledgerCsv,
  orderPrices,
  pricesCsv,
  protectFormula,
  quoteField,
  resultsCsv,
  scoresCsv,
  tickerOf,
  toCsv,
  type LedgerExportRow,
  type PriceExportRow,
  type ResultExportRow,
  type ScoreExportRow,
} from "./export";

/** A strict RFC 4180 reader, to check that what the writer produces reads back as the same cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
      } else if (ch === '"') {
        quoted = false;
        i += 1;
        if (i < text.length && text[i] !== "," && text[i] !== "\r") throw new Error(`text after a closing quote at ${i}`);
      } else {
        cell += ch;
        i += 1;
      }
    } else if (ch === '"') {
      if (cell !== "") throw new Error(`a quote inside an unquoted cell at ${i}`);
      quoted = true;
      i += 1;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
    } else if (ch === "\r") {
      if (text[i + 1] !== "\n") throw new Error(`a bare CR at ${i}`);
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 2;
    } else if (ch === "\n") {
      throw new Error(`a bare LF at ${i}`);
    } else {
      cell += ch;
      i += 1;
    }
  }
  if (quoted) throw new Error("an unclosed quote");
  if (cell !== "" || row.length) throw new Error("the last line has no CRLF");
  return rows;
}

describe("protectFormula", () => {
  it.each(["=1+1", "+1", "-5", "@SUM(A1)", "\tx", "\rx", '=HYPERLINK("http://x")'])("prefixes %j with a single quote", (s) => {
    expect(protectFormula(s)).toBe(`'${s}`);
  });

  it.each(["", "AQS", "a=b", " =1", "1-2", "Squad 07 · Finance", "'already"])("leaves %j alone", (s) => {
    expect(protectFormula(s)).toBe(s);
  });
});

describe("quoteField", () => {
  it("leaves a plain field unquoted", () => {
    expect(quoteField("TRADE")).toBe("TRADE");
    expect(quoteField("")).toBe("");
  });

  it("quotes a field with a comma, a quote, CR or LF, doubling the quotes", () => {
    expect(quoteField("a,b")).toBe('"a,b"');
    expect(quoteField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteField("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(quoteField("a\rb")).toBe('"a\rb"');
  });
});

describe("intCell", () => {
  it("writes whole numbers exactly as stored", () => {
    expect(intCell(0)).toBe("0");
    expect(intCell(-0)).toBe("0");
    expect(intCell(1050)).toBe("1050");
    expect(intCell(-2250000)).toBe("-2250000");
    expect(intCell(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
  });

  it("keeps the string and bigint forms of a bigint exact, beyond what a double can hold", () => {
    expect(intCell("9007199254740993")).toBe("9007199254740993");
    expect(intCell(9007199254740993n)).toBe("9007199254740993");
    expect(intCell("-73413000")).toBe("-73413000");
    expect(intCell("007")).toBe("7");
    expect(intCell("-007")).toBe("-7");
    expect(intCell("000")).toBe("0");
    expect(intCell("-0")).toBe("0");
  });

  it("writes null as an empty cell", () => {
    expect(intCell(null)).toBe("");
    expect(intCell(undefined)).toBe("");
  });

  it.each([1.5, Number.NaN, Infinity, 2 ** 53, "1.5", "1e3", "", " 5", "$5", true, {}])("refuses %j rather than round it", (v) => {
    expect(() => intCell(v)).toThrow(/not a whole number/);
  });
});

describe("istTime", () => {
  it("writes a UTC timestamp in IST with its offset, keeping the fraction of a second", () => {
    expect(istTime("2026-10-08T15:35:09.123456+00:00")).toBe("2026-10-08T21:05:09.123456+05:30");
    expect(istTime("2026-10-08T15:35:09+00:00")).toBe("2026-10-08T21:05:09+05:30");
  });

  it("crosses midnight and month ends", () => {
    expect(istTime("2026-10-08T18:45:00Z")).toBe("2026-10-09T00:15:00+05:30");
    expect(istTime("2026-12-31T20:00:00.5Z")).toBe("2027-01-01T01:30:00.5+05:30");
  });

  it("reads other offsets and Postgres' text form", () => {
    expect(istTime("2026-10-08T21:05:09+05:30")).toBe("2026-10-08T21:05:09+05:30");
    expect(istTime("2026-10-08 10:35:09-05")).toBe("2026-10-08T21:05:09+05:30");
    expect(istTime("2026-10-08T15:35:09+0000")).toBe("2026-10-08T21:05:09+05:30");
    expect(istTime(new Date("2026-10-08T15:35:09.120Z"))).toBe("2026-10-08T21:05:09.120+05:30");
  });

  it("writes null as an empty cell and refuses anything else", () => {
    expect(istTime(null)).toBe("");
    expect(istTime("")).toBe("");
    expect(() => istTime("yesterday")).toThrow(/not a timestamp/);
    expect(() => istTime("2026-10-08T15:35:09")).toThrow(/not a timestamp/);
  });
});

describe("csvCell", () => {
  it("writes booleans, text and empty cells", () => {
    expect(csvCell("bool", true)).toBe("true");
    expect(csvCell("bool", false)).toBe("false");
    expect(csvCell("bool", null)).toBe("");
    expect(csvCell("text", null)).toBe("");
    expect(csvCell("text", "AQS")).toBe("AQS");
    expect(csvCell("time", "2026-10-08T15:35:09Z")).toBe("2026-10-08T21:05:09+05:30");
  });

  it("protects a text cell first, then quotes it", () => {
    expect(csvCell("text", '=HYPERLINK("http://x","go"), now')).toBe('"\'=HYPERLINK(""http://x"",""go""), now"');
    expect(csvCell("text", "-$500 refund")).toBe("'-$500 refund");
    expect(csvCell("text", "\tindent")).toBe("'\tindent");
  });

  it("keeps a negative number a number (it was validated as a whole number)", () => {
    expect(csvCell("int", -1500)).toBe("-1500");
    expect(csvCell("int", "-1500")).toBe("-1500");
  });
});

describe("toCsv", () => {
  const columns = [
    { header: "name", kind: "text" as const, get: (r: { name: string | null; cents: number | string | null }) => r.name },
    { header: "cents", kind: "int" as const, get: (r: { name: string | null; cents: number | string | null }) => r.cents },
  ];

  it("writes a header row and one line per row, each ending in CRLF", () => {
    expect(toCsv(columns, [{ name: "A", cents: 1 }, { name: null, cents: null }])).toBe("name,cents\r\nA,1\r\n,\r\n");
  });

  it("writes only the header for no rows", () => {
    expect(toCsv(columns, [])).toBe("name,cents\r\n");
  });

  it("reads back as the same cells (formula cells keep their quote)", () => {
    const rows = [
      { name: 'Reason, with "quotes"\r\nand two lines', cents: "-73413000" },
      { name: "=1+2", cents: 0 },
      { name: "@user", cents: "9007199254740993" },
      { name: "plain", cents: 5 },
    ];
    expect(parseCsv(toCsv(columns, rows))).toEqual([
      ["name", "cents"],
      ['Reason, with "quotes"\r\nand two lines', "-73413000"],
      ["'=1+2", "0"],
      ["'@user", "9007199254740993"],
      ["plain", "5"],
    ]);
  });

  it("fails rather than write a money value it cannot keep exact", () => {
    expect(() => toCsv(columns, [{ name: "x", cents: 10.5 }])).toThrow(/not a whole number/);
  });
});

describe("fetchPages", () => {
  const source = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

  it("reads 1,000 rows at a time until a short page", async () => {
    const rows = source(2345);
    const asked: [number, number][] = [];
    const out = await fetchPages<{ i: number }>(async (from, to) => {
      asked.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    }, "the rows");
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(out).toEqual(rows);
  });

  it("asks once more after an exactly full last page", async () => {
    const rows = source(2000);
    let calls = 0;
    const out = await fetchPages<{ i: number }>(async (from, to) => {
      calls += 1;
      return { data: rows.slice(from, to + 1), error: null };
    }, "the rows");
    expect(calls).toBe(3);
    expect(out).toHaveLength(2000);
  });

  it("returns nothing for an empty table and treats null data as empty", async () => {
    expect(await fetchPages(async () => ({ data: null, error: null }), "the rows")).toEqual([]);
  });

  it("says what could not be read", async () => {
    await expect(fetchPages(async () => ({ data: null, error: { message: "permission denied" } }), "the ledger")).rejects.toThrow(
      "Could not read the ledger: permission denied",
    );
  });
});

describe("kinds and file names", () => {
  it("knows the four exports", () => {
    expect(EXPORT_KINDS).toEqual(["ledger", "prices", "scores", "results"]);
    expect(isExportKind("ledger")).toBe(true);
    expect(isExportKind("flags")).toBe(false);
    expect(isExportKind(undefined)).toBe(false);
  });

  it("names the file <slug>-<kind>.csv", () => {
    expect(exportFileName("night-2026", "prices")).toBe("night-2026-prices.csv");
  });
});

// ───────────────────────────── Per export ─────────────────────────────

const T = { p1: "t-p1", c1: "t-c1", f1: "t-f1", f2: "t-f2" };
const lk = buildLookups(
  [
    { id: T.p1, code: "P01", track: "PRODUCT" },
    { id: T.c1, code: "C01", track: "CONSULTING" },
    { id: T.f1, code: "F01", track: "FINANCE" },
    { id: T.f2, code: "F02", track: "FINANCE" },
  ],
  [
    { id: "co-aqs", ticker: "AQS" },
    { id: "co-snp", ticker: "SNP" },
    { id: "co-new", ticker: null },
  ],
  [
    { id: "r1", number: 1 },
    { id: "r21", number: 21 },
  ],
);

describe("lookups", () => {
  it("writes a company with no ticker yet as an empty cell, and an unknown id as is", () => {
    expect(tickerOf(lk, "co-aqs")).toBe("AQS");
    expect(tickerOf(lk, "co-new")).toBeNull();
    expect(tickerOf(lk, "co-gone")).toBe("co-gone");
    expect(tickerOf(lk, null)).toBeNull();
  });
});

describe("ledgerCsv", () => {
  const base: Omit<LedgerExportRow, "id" | "team_id" | "cash_delta_cents" | "share_delta"> = {
    txn_id: "tx-1",
    kind: "TRADE",
    company_id: "co-aqs",
    lot: "EXCHANGE",
    price_cents: 1082,
    round_id: "r1",
    memo: null,
    created_at: "2026-10-08T18:15:00.000001+00:00",
  };

  it("writes the team code (or Exchange), ticker, round number and exact cents", () => {
    const csv = ledgerCsv(
      [
        { ...base, id: 7, team_id: T.f1, cash_delta_cents: "-2164000", share_delta: 2000 },
        { ...base, id: "8", team_id: null, lot: null, cash_delta_cents: 2164000, share_delta: -2000 },
      ],
      lk,
    );
    expect(parseCsv(csv)).toEqual([
      ["id", "time_ist", "txn_id", "kind", "team", "ticker", "lot", "cash_delta_cents", "share_delta", "price_cents", "round", "memo"],
      ["7", "2026-10-08T23:45:00.000001+05:30", "tx-1", "TRADE", "F01", "AQS", "EXCHANGE", "-2164000", "2000", "1082", "1", ""],
      ["8", "2026-10-08T23:45:00.000001+05:30", "tx-1", "TRADE", "Exchange", "AQS", "", "2164000", "-2000", "1082", "1", ""],
    ]);
  });

  it("protects a memo typed by a person (a correction's reason)", () => {
    const csv = ledgerCsv(
      [{ ...base, id: 9, kind: "CORRECTION", team_id: T.f2, cash_delta_cents: 50000, share_delta: 0, price_cents: null, round_id: null, memo: "=1+2, refund" }],
      lk,
    );
    expect(csv.split("\r\n")[1]).toBe(`9,2026-10-08T23:45:00.000001+05:30,tx-1,CORRECTION,F02,AQS,EXCHANGE,50000,0,,,"'=1+2, refund"`);
  });
});

describe("pricesCsv", () => {
  it("writes the round, ticker, kind, prices before and after and the round's quantities", () => {
    const row: PriceExportRow = {
      id: 3,
      company_id: "co-aqs",
      round_id: "r21",
      kind: "CLEARING",
      market_before: 1050,
      market_after: 1082,
      ai_before: 1050,
      ai_after: 1050,
      buy_qty: 3500,
      sell_qty: 500,
      short_qty: 0,
      cover_qty: 0,
      net_qty: 3000,
      capped_net: 3000,
      tier_bp: null,
      created_at: "2026-10-08T23:30:00Z",
    };
    const ipo: PriceExportRow = { ...row, id: 1, round_id: null, kind: "IPO", market_before: null, ai_before: null, market_after: 1050, ai_after: 1050, buy_qty: 0, sell_qty: 0, net_qty: 0, capped_net: 0, tier_bp: 500 };
    expect(parseCsv(pricesCsv([ipo, row], lk))).toEqual([
      [
        "id",
        "time_ist",
        "round",
        "ticker",
        "kind",
        "market_before_cents",
        "market_after_cents",
        "ai_before_cents",
        "ai_after_cents",
        "buy_qty",
        "sell_qty",
        "short_qty",
        "cover_qty",
        "net_qty",
        "capped_net",
        "tier_bp",
      ],
      ["1", "2026-10-09T05:00:00+05:30", "", "AQS", "IPO", "", "1050", "", "1050", "0", "0", "0", "0", "0", "0", "500"],
      ["3", "2026-10-09T05:00:00+05:30", "21", "AQS", "CLEARING", "1050", "1082", "1050", "1050", "3500", "500", "0", "0", "3000", "3000", ""],
    ]);
  });
});

describe("orderPrices", () => {
  it("keeps the order prices were written in, with each price event's rows by ticker", () => {
    const at = (t: string) => `2026-10-08T${t}+00:00`;
    const rows = [
      { id: "12", company_id: "co-aqs", round_id: "r1", kind: "CLEARING", created_at: at("18:15:00.5") },
      { id: "3", company_id: "co-aqs", round_id: null, kind: "IPO", created_at: at("17:45:00") },
      { id: "10", company_id: "co-snp", round_id: "r1", kind: "CLEARING", created_at: at("18:15:00.5") },
      { id: "2", company_id: "co-snp", round_id: null, kind: "IPO", created_at: at("17:45:00") },
      { id: "11", company_id: "co-new", round_id: "r1", kind: "CLEARING", created_at: at("18:15:00.5") },
      { id: "13", company_id: "co-snp", round_id: "r21", kind: "CLEARING", created_at: at("18:30:00") },
      { id: "14", company_id: "co-aqs", round_id: "r21", kind: "CLEARING", created_at: at("18:30:00") },
      { id: "15", company_id: "co-aqs", round_id: null, kind: "CLOSE", created_at: at("18:30:00") },
      { id: "9007199254740993", company_id: "co-snp", round_id: null, kind: "CLOSE", created_at: at("18:30:00") },
    ];
    expect(orderPrices(rows, lk).map((r) => r.id)).toEqual(["3", "2", "11", "12", "10", "14", "13", "15", "9007199254740993"]);
  });
});

describe("scoresCsv", () => {
  const score = (over: Partial<ScoreExportRow>): ScoreExportRow => ({
    company_id: "co-aqs",
    type: "PITCH",
    run_totals: [64, 66, 68],
    median: 66,
    final_score: 66,
    tier_bp: 500,
    capped: false,
    penalty: 0,
    missing: false,
    status: "RELEASED",
    released_at: "2026-10-08T17:45:00Z",
    ...over,
  });

  it("writes every run, the median, final score, tier, cap, penalty, missing, status and release time", () => {
    expect(parseCsv(scoresCsv([score({})], lk))).toEqual([
      ["ticker", "type", "runs", "median", "final", "tier_bp", "capped", "penalty", "missing", "status", "released_at_ist"],
      ["AQS", "PITCH", "64 66 68", "66", "66", "500", "false", "0", "false", "RELEASED", "2026-10-08T23:15:00+05:30"],
    ]);
  });

  it("sorts by type (pitch, plan, flash), then ticker, and writes a missing score's empty runs and median", () => {
    const rows = parseCsv(
      scoresCsv(
        [
          score({ company_id: "co-snp", type: "FLASH" }),
          score({ company_id: "co-snp", type: "PLAN", run_totals: [70, 80, 90, 85, 60], median: 80, final_score: 50, tier_bp: 0, capped: true, penalty: 10, status: "SEALED", released_at: null }),
          score({ company_id: "co-aqs", type: "PLAN", run_totals: [], median: null, final_score: 0, tier_bp: -2000, missing: true, status: "SEALED", released_at: null }),
          score({ company_id: "co-snp", type: "PITCH" }),
          score({ company_id: "co-aqs", type: "PITCH" }),
        ],
        lk,
      ),
    );
    expect(rows.slice(1).map((r) => `${r[1]} ${r[0]}`)).toEqual(["PITCH AQS", "PITCH SNP", "PLAN AQS", "PLAN SNP", "FLASH SNP"]);
    expect(rows[3]).toEqual(["AQS", "PLAN", "", "", "0", "-2000", "false", "0", "true", "SEALED", ""]);
    expect(rows[4]).toEqual(["SNP", "PLAN", "70 80 90 85 60", "80", "50", "0", "true", "10", "false", "SEALED", ""]);
  });
});

describe("resultsCsv", () => {
  const result = (team_id: string, track: ResultExportRow["track"], rank: number | null, over: Partial<ResultExportRow> = {}): ResultExportRow => ({
    team_id,
    track,
    final_value_cents: "73413000",
    start_value_cents: 68000000,
    return_bp: 796,
    rank,
    eligible: true,
    ...over,
  });

  it("is only a header before settlement", () => {
    expect(resultsCsv([], lk)).toBe("team,track,final_value_cents,start_value_cents,return_bp,rank,eligible\r\n");
  });

  it("sorts by track, then rank (unranked last), then team code, with exact cents", () => {
    const rows = parseCsv(
      resultsCsv(
        [
          result(T.f2, "FINANCE", null, { eligible: false, return_bp: -120 }),
          result(T.f1, "FINANCE", 1, { final_value_cents: 51650000, start_value_cents: 50000000, return_bp: 330 }),
          result(T.c1, "CONSULTING", 1, { return_bp: null }),
          result(T.p1, "PRODUCT", 1),
        ],
        lk,
      ),
    );
    expect(rows.slice(1)).toEqual([
      ["P01", "PRODUCT", "73413000", "68000000", "796", "1", "true"],
      ["C01", "CONSULTING", "73413000", "68000000", "", "1", "true"],
      ["F01", "FINANCE", "51650000", "50000000", "330", "1", "true"],
      ["F02", "FINANCE", "73413000", "68000000", "-120", "", "false"],
    ]);
  });
});
