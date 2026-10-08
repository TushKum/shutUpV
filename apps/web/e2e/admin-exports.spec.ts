import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// Three squads trading in round 1 (every IPO price $10.50, tickers ELA, ELB, ELC): squad 2's fund buys 1,000 ELA, so
// round 1 clears ELA at $10.61. Then a ledger correction whose reason starts with "=" (a formula, if a spreadsheet
// ran it), with a comma, quotes and a line break.
const REASON = '=HYPERLINK("http://evil.example","refund"), approved by "Asha"\nsecond line';
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: "e2e-exports", prefix: "L" });
  s = await trading(ev);
  await ev.n.openRound(1);
  await ev.n.ok(ev.n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 1000);
  await ev.n.clearRound(1);
  const asked = await ev.n.org("request_correction", ev.n.eventId, REASON, JSON.stringify([{ team_id: ev.n.teamId(s[0]!.f_code), cash_delta_cents: 12345 }]));
  await ev.n.ok(ev.n.second, "decide_correction", asked.correction_id, true);
});

/** A strict RFC 4180 reader (CRLF line ends, quoted fields, doubled quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") throw new Error(`a bare line break at ${i}`);
    else cell += ch;
  }
  if (quoted || cell !== "" || row.length) throw new Error("the CSV does not end with a complete line");
  return rows;
}

/** The CSV as objects keyed by the header. */
async function records(res: APIResponse) {
  expect(res.status()).toBe(200);
  const [header, ...rows] = parseCsv(await res.text());
  return { header: header!, rows: rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]!]))) };
}

const url = (kind: string) => `/admin/${ev.slug}/exports/${kind}`;

test("the exports page lists the four CSVs with their row counts; the ledger downloads complete and exact", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/exports`);
  const ledgerCount = (await ev.n.one("select count(*)::int as n from ledger_entries where event_id = $1", [ev.n.eventId])).n;
  const priceCount = (await ev.n.one("select count(*)::int as n from round_prices where event_id = $1", [ev.n.eventId])).n;
  await expect(page.getByTestId("rows-ledger")).toHaveText(`${ledgerCount.toLocaleString("en-US")} rows now.`);
  await expect(page.getByTestId("rows-prices")).toHaveText(`${priceCount} rows now.`);
  await expect(page.getByTestId("rows-scores")).toHaveText("3 rows now.");
  await expect(page.getByTestId("rows-results")).toHaveText("0 rows now.");
  for (const kind of ["ledger", "prices", "scores", "results"]) {
    await expect(page.getByRole("link", { name: `Download ${ev.slug}-${kind}.csv` })).toBeVisible();
  }

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: `Download ${ev.slug}-ledger.csv` }).click()]);
  expect(download.suggestedFilename()).toBe(`${ev.slug}-ledger.csv`);
  const text = await readFile((await download.path())!, "utf8");
  const [header, ...rows] = parseCsv(text);
  expect(header).toEqual(["id", "time_ist", "txn_id", "kind", "team", "ticker", "lot", "cash_delta_cents", "share_delta", "price_cents", "round", "memo"]);
  expect(rows).toHaveLength(ledgerCount);
  const at = (name: string) => header!.indexOf(name);

  // Exact cents: every team's cash is the sum of its ledger rows, and the exchange's rows balance them.
  const teams = await ev.n.q<{ code: string; cash_cents: string }>("select code, cash_cents from teams where event_id = $1", [ev.n.eventId]);
  for (const t of teams) {
    const sum = rows.filter((r) => r[at("team")] === t.code).reduce((acc, r) => acc + BigInt(r[at("cash_delta_cents")]!), 0n);
    expect(sum, t.code).toBe(BigInt(t.cash_cents));
  }
  expect(rows.some((r) => r[at("team")] === "Exchange")).toBe(true);

  // The round 1 trade: 1,000 ELA at $10.61, in round 1.
  const trade = rows.find((r) => r[at("kind")] === "TRADE" && r[at("team")] === s[1]!.f_code)!;
  expect([trade[at("ticker")], trade[at("lot")], trade[at("share_delta")], trade[at("price_cents")], trade[at("round")]]).toEqual(["ELA", "EXCHANGE", "1000", "1061", "1"]);
  expect(trade[at("cash_delta_cents")]).toBe("-1061000");
  expect(trade[at("time_ist")]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+05:30$/);

  // A person's text that starts with "=" is written with a leading quote, so a spreadsheet shows it rather than running it.
  const corrections = rows.filter((r) => r[at("kind")] === "CORRECTION");
  expect(corrections.map((r) => [r[at("team")], r[at("cash_delta_cents")], r[at("memo")]])).toEqual([
    [s[0]!.f_code, "12345", `'${REASON}`],
    ["Exchange", "-12345", `'${REASON}`],
  ]);
  expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""refund""), approved by ""Asha""\nsecond line"`);
});

test("prices per round: every price change with its round, prices before and after, and quantities", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  const res = await page.request.get(url("prices"));
  expect(res.headers()["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
  expect(res.headers()["content-disposition"]).toBe(`attachment; filename="${ev.slug}-prices.csv"`);
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
  const { rows } = await records(res);
  const brief = rows.map((r) => [r.kind, r.round, r.ticker, r.market_before_cents, r.market_after_cents, r.ai_before_cents, r.ai_after_cents, r.buy_qty, r.net_qty, r.capped_net, r.tier_bp]);
  expect(brief).toEqual([
    ...["ELA", "ELB", "ELC"].map((t) => ["IPO", "", t, "", "1050", "", "1050", "0", "0", "0", "500"]),
    ["CLEARING", "1", "ELA", "1050", "1061", "1050", "1050", "1000", "1000", "1000", ""],
    ["CLEARING", "1", "ELB", "1050", "1050", "1050", "1050", "0", "0", "0", ""],
    ["CLEARING", "1", "ELC", "1050", "1050", "1050", "1050", "0", "0", "0", ""],
  ]); // in the order written, each price event's rows by ticker
});

test("scores: every company's runs, median, final score, tier and release", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness); // the fairness officer can download too
  const res = await page.request.get(url("scores"));
  expect(res.headers()["content-disposition"]).toBe(`attachment; filename="${ev.slug}-scores.csv"`);
  const { header, rows } = await records(res);
  expect(header).toEqual(["ticker", "type", "runs", "median", "final", "tier_bp", "capped", "penalty", "missing", "status", "released_at_ist"]);
  expect(rows.map(({ released_at_ist, ...r }) => ({ ...r, released: /\+05:30$/.test(released_at_ist!) }))).toEqual(
    ["ELA", "ELB", "ELC"].map((ticker) => ({
      ticker,
      type: "PITCH",
      runs: "60 60 60",
      median: "60",
      final: "60",
      tier_bp: "500",
      capped: "false",
      penalty: "0",
      missing: "false",
      status: "RELEASED",
      released: true,
    })),
  );
});

test("final results: only a header before settlement; after it, every team with exact cents", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  const before = await page.request.get(url("results"));
  expect(before.status()).toBe(200);
  expect(await before.text()).toBe("team,track,final_value_cents,start_value_cents,return_bp,rank,eligible\r\n");

  // Test-only: settlement rows as the night's last transaction would write them (playing the night to 05:30 is
  // covered by the database tests).
  const t = (code: string) => ev.n.teamId(code);
  await ev.n.q(
    `insert into results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, rank, eligible) values
       ($1, $2, 'FINANCE', 9007199254740993, 50000000, 180143985, 1, true),
       ($1, $3, 'FINANCE', 49999999, 50000000, 0, null, false),
       ($1, $4, 'PRODUCT', 73413000, 68000000, 796, 1, true)`,
    [ev.n.eventId, t(s[1]!.f_code), t(s[0]!.f_code), t(s[0]!.p_code)],
  );
  try {
    const { rows } = await records(await page.request.get(url("results")));
    expect(rows.map((r) => Object.values(r))).toEqual([
      [s[0]!.p_code, "PRODUCT", "73413000", "68000000", "796", "1", "true"],
      [s[1]!.f_code, "FINANCE", "9007199254740993", "50000000", "180143985", "1", "true"],
      [s[0]!.f_code, "FINANCE", "49999999", "50000000", "0", "", "false"],
    ]);
  } finally {
    await ev.n.q("delete from results where event_id = $1", [ev.n.eventId]);
  }
});

test("a ledger longer than one page (1,000 rows) is exported whole, in order", async ({ page }) => {
  // Test-only: 1,200 ledger rows that move nothing, so the ledger runs past PostgREST's 1,000-row page.
  await ev.n.q(
    `insert into ledger_entries (event_id, txn_id, kind, memo)
     select $1, gen_random_uuid(), 'CORRECTION', '-filler ' || g from generate_series(1, 1200) g`,
    [ev.n.eventId],
  );
  const total = (await ev.n.one("select count(*)::int as n from ledger_entries where event_id = $1", [ev.n.eventId])).n;
  expect(total).toBeGreaterThan(1200);
  await loginAsStaff(page, ev, STAFF.lead);
  const { rows } = await records(await page.request.get(url("ledger")));
  expect(rows).toHaveLength(total);
  const ids = rows.map((r) => BigInt(r.id!));
  expect(ids.every((id, i) => i === 0 || id > ids[i - 1]!)).toBe(true);
  expect(rows.at(-1)!.memo).toBe("'-filler 1200");
});

test("a team is refused (403) and a signed-out visitor is sent to sign in, never given the CSV", async ({ page, playwright }) => {
  await loginAsTeam(page, ev, s[1]!.f_code);
  const team = await page.request.get(url("ledger"));
  expect(team.status()).toBe(403);
  expect(team.headers()["content-disposition"]).toBeUndefined();
  expect(await team.json()).toEqual({ error: "Only organisers and the fairness officer can download exports." });

  const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    const out = await anonymous.get(url("ledger"), { maxRedirects: 0 });
    // The proxy sends a signed-out visitor to /login before the handler runs; the handler itself answers 401.
    expect([307, 401]).toContain(out.status());
    if (out.status() === 307) expect(out.headers()["location"]).toMatch(/^\/login\?next=/);
    expect(out.headers()["content-type"] ?? "").not.toMatch(/text\/csv/);
  } finally {
    await anonymous.dispose();
  }
});

test("an unknown export is 404", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  const unknown = await page.request.get(url("flags"));
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: "No such export: choose ledger, prices, scores, results." });
});
