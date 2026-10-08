import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "@msim/engine";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

// Three squads; round 1 cleared with 36 small buys (each fund buys each of the two other companies six times; the
// exchange's side is one row per company), so the ledger has more than one page of 50 rows.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
const ticker = (i: number) => `EM${"ABC"[i]}`;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  ev = await seedE2eEvent({ slug: "e2e-ledger", prefix: "M" });
  s = await trading(ev);
  await ev.n.openRound(1);
  for (const [i, x] of s.entries()) {
    for (const [j, y] of s.entries()) {
      if (i === j) continue;
      for (const qty of [10, 11, 12, 13, 14, 15]) await ev.n.ok(ev.n.team(x.f_code), "place_order", y.company_id, "BUY", qty);
    }
  }
  await ev.n.clearRound(1);
});

const panel = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const ledgerRows = (page: Page) => panel(page, "Ledger").locator("tbody tr");
const total = async () => Number((await ev.n.one("select count(*)::int as n from ledger_entries where event_id = $1", [ev.n.eventId])).n);

test("the full ledger: newest first, filtered by team, kind and ticker, paged; the books balance", async ({ page }) => {
  const n = await total();
  expect(n).toBeGreaterThan(50);
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/ledger`);
  await expect(page.getByTestId("books-check")).toContainText(/^The books balance: \d+ transactions \(\d+ rows\) balance/);
  const pager = page.getByRole("navigation", { name: "Ledger pages", exact: true });
  await expect(pager).toContainText(`Rows 1–50 of ${n} · page 1 of 2`);
  await expect(ledgerRows(page)).toHaveCount(50);
  // Newest first: the first row is the last row written (round 1's clearing).
  const newest = await ev.n.one("select kind, round_id is not null as in_round from ledger_entries where event_id = $1 order by id desc limit 1", [ev.n.eventId]);
  expect(newest).toEqual({ kind: "TRADE", in_round: true });
  await expect(ledgerRows(page).first().getByRole("cell").nth(2)).toHaveText("Trade");
  await expect(ledgerRows(page).first().getByRole("cell").nth(9)).toHaveText("1");

  // Older: the second page ends with the first rows of the night (the funds' starting cash).
  await pager.getByRole("link", { name: "Older →" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation", { name: "Ledger pages", exact: true })).toContainText(`Rows 51–${n} of ${n} · page 2 of 2`);
  await expect(ledgerRows(page)).toHaveCount(n - 50);
  await expect(ledgerRows(page).last().getByRole("cell").nth(2)).toHaveText("Starting cash");

  // One fund's buys of one company: each row with its fill price, cash and shares, newest first.
  const fund = s[0]!.f_code;
  const fills = await ev.n.q("select qty, fill_price from orders where team_id = $1 and company_id = $2 and status = 'FILLED'", [
    ev.n.teamId(fund),
    s[1]!.company_id,
  ]);
  expect(fills.map((f) => f.qty).sort()).toEqual([10, 11, 12, 13, 14, 15]);
  const rows = await ev.n.q("select share_delta, memo from ledger_entries where team_id = $1 and company_id = $2 and kind = 'TRADE' order by id desc", [
    ev.n.teamId(fund),
    s[1]!.company_id,
  ]);
  const price = fills[0]!.fill_price as number; // every order of a round fills at its company's new price
  await page.getByLabel("Team").selectOption(fund);
  await page.getByLabel("Kind").selectOption("Trade");
  await page.getByLabel("Ticker").selectOption(ticker(1));
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(new RegExp(`team=${fund}&kind=TRADE&ticker=${ticker(1)}$`));
  await expect(ledgerRows(page)).toHaveCount(6);
  for (const [i, r] of rows.entries()) {
    await expect(ledgerRows(page).nth(i).getByRole("cell")).toHaveText([
      /^\d\d:\d\d:\d\d$/,
      /^[0-9a-f]{8}$/,
      "Trade",
      fund,
      ticker(1),
      "EXCHANGE",
      formatCents(-r.share_delta * price),
      `+${r.share_delta}`,
      formatCents(price),
      "1",
      r.memo,
    ]);
  }
  await expect(page.getByRole("navigation", { name: "Ledger pages", exact: true })).toContainText("Rows 1–6 of 6");

  // The exchange's side of the share issue at the draw: 35,000 shares per company for the IPO.
  await page.getByLabel("Team").selectOption("Exchange");
  await page.getByLabel("Kind").selectOption("Share issue");
  await page.getByLabel("Ticker").selectOption("All");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(ledgerRows(page)).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(ledgerRows(page).nth(i).getByRole("cell").nth(3)).toHaveText("Exchange");
    await expect(ledgerRows(page).nth(i).getByRole("cell").nth(7)).toHaveText("+35,000");
  }

  // A filter value that matches nothing in this event is named; Clear goes back to the whole ledger.
  await page.goto(`/admin/${ev.slug}/ledger?team=ZZ99`);
  await expect(panel(page, "Ledger")).toContainText("No team ZZ99 in this event.");
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page.getByRole("navigation", { name: "Ledger pages", exact: true })).toContainText(`of ${n} · page 1 of 2`);
});

test("corrections need two people: the requester cannot decide; a second organiser approves and it is applied", async ({ page, browser }) => {
  const [f1, f2] = [s[0]!.f_code, s[1]!.f_code];
  const cashOf = async (code: string) => Number((await ev.n.one("select cash_cents from teams where code = $1", [code])).cash_cents);
  const f1Cash = await cashOf(f1);
  const f2Cash = await cashOf(f2);

  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/ledger/corrections`);
  const form = panel(page, "Request a correction");
  const entry = (i: number) => form.getByRole("group", { name: `Entry ${i}` });

  // Typed dollars with more than 2 decimals are refused before anything is sent; what was typed stays.
  await form.getByLabel("Reason (at least 10 characters)").fill("Refund a fee charged twice");
  await entry(1).getByLabel("Team").selectOption(f1);
  await entry(1).getByLabel("Cash change ($)").fill("12.345");
  await form.getByRole("button", { name: "Request correction" }).click();
  await expect(form.getByRole("alert")).toHaveText("Entry 1: cash change “12.345” has more than 2 decimals; amounts are in whole cents.");
  await expect(form.getByLabel("Reason (at least 10 characters)")).toHaveValue("Refund a fee charged twice");

  // The database refuses a lot that does not fit the team, and says why.
  await entry(1).getByLabel("Team").selectOption(s[0]!.p_code);
  await entry(1).getByLabel("Company (optional)").selectOption(ticker(1));
  await entry(1).getByLabel("Lot").selectOption("SQUAD");
  await entry(1).getByLabel("Cash change ($)").fill("");
  await entry(1).getByLabel("Share change").fill("100");
  await form.getByRole("button", { name: "Request correction" }).click();
  await expect(form.getByRole("alert")).toHaveText(`Refused: a SQUAD lot cannot belong to team ${s[0]!.p_code}`);

  // A valid request with two entries.
  await entry(1).getByLabel("Team").selectOption(f1);
  await entry(1).getByLabel("Company (optional)").selectOption("None");
  await entry(1).getByLabel("Lot").selectOption("None");
  await entry(1).getByLabel("Cash change ($)").fill("12.34");
  await entry(1).getByLabel("Share change").fill("");
  await form.getByRole("button", { name: "Add entry" }).click();
  await entry(2).getByLabel("Team").selectOption(f2);
  await entry(2).getByLabel("Company (optional)").selectOption(ticker(0));
  await entry(2).getByLabel("Lot").selectOption("EXCHANGE");
  await entry(2).getByLabel("Cash change ($)").fill("-0.5");
  await entry(2).getByLabel("Share change").fill("10");
  await form.getByRole("button", { name: "Request correction" }).click();
  await expect(form.getByRole("status")).toHaveText(
    "Correction requested (2 entries). A second organiser or the fairness officer must approve it before it is applied.",
  );
  await expect(form.getByLabel("Reason (at least 10 characters)")).toHaveValue("");
  const stored = await ev.n.one("select reason, entries from corrections where event_id = $1 and status = 'PENDING'", [ev.n.eventId]);
  expect(stored.entries).toEqual([
    { team_id: ev.n.teamId(f1), cash_delta_cents: 1234 },
    { team_id: ev.n.teamId(f2), company_id: s[0]!.company_id, lot: "EXCHANGE", cash_delta_cents: -50, share_delta: 10 },
  ]);

  const pending = panel(page, "Pending corrections").getByRole("listitem", { name: "Pending correction 1" });
  await expect(pending).toContainText("Requested by Event lead");
  await expect(pending).toContainText("“Refund a fee charged twice”");
  await expect(pending.locator("tbody tr").nth(0).getByRole("cell")).toHaveText([f1, "", "", "+$12.34", ""]);
  await expect(pending.locator("tbody tr").nth(1).getByRole("cell")).toHaveText([f2, ticker(0), "EXCHANGE", "−$0.50", "+10"]);
  await expect(pending).toContainText("You requested this correction. A second organiser or the fairness officer must approve or reject it.");
  await expect(pending.getByRole("button", { name: "Approve and apply" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Corrections\s*1 pending/ })).toBeVisible();

  // The second organiser approves (two clicks); the requester's page follows in realtime.
  const other = await browser.newContext();
  const second = await other.newPage();
  await loginAsStaff(second, ev, STAFF.second);
  await second.goto(`/admin/${ev.slug}/ledger/corrections`);
  const theirs = panel(second, "Pending corrections").getByRole("listitem", { name: "Pending correction 1" });
  await theirs.getByRole("button", { name: "Approve and apply" }).click();
  await theirs.getByRole("button", { name: "Click again to apply the correction" }).click();
  await expect(panel(second, "Pending corrections")).toContainText("No correction is waiting for a decision.");
  const history = panel(second, "Decided corrections").locator("tbody tr").first();
  await expect(history.getByRole("cell")).toHaveText([
    /\d\d:\d\d$/,
    "Approved",
    "Refund a fee charged twice",
    `${f1} · +$12.34${f2} · ${ticker(0)} · EXCHANGE · −$0.50 · +10 shares`,
    "Event lead",
    "Exchange desk",
    "",
    /^[0-9a-f]{8}$/,
  ]);
  await expect(panel(page, "Pending corrections")).toContainText("No correction is waiting for a decision.");
  await other.close();

  expect(await cashOf(f1)).toBe(f1Cash + 1234);
  expect(await cashOf(f2)).toBe(f2Cash - 50);
  await page.goto(`/admin/${ev.slug}/ledger?kind=CORRECTION`);
  await expect(ledgerRows(page)).toHaveCount(4);
  await expect(ledgerRows(page).filter({ hasText: f1 }).getByRole("cell").nth(6)).toHaveText("+$12.34");
  await expect(ledgerRows(page).filter({ hasText: f2 }).getByRole("cell").nth(7)).toHaveText("+10");
  await expect(page.getByTestId("books-check")).toContainText("The books balance");
});

test("the fairness officer rejects a correction with a note; only organisers request", async ({ page, browser }) => {
  const lead = await browser.newContext();
  const leadPage = await lead.newPage();
  await loginAsStaff(leadPage, ev, STAFF.lead);
  await leadPage.goto(`/admin/${ev.slug}/ledger/corrections`);
  const form = panel(leadPage, "Request a correction");
  await form.getByLabel("Reason (at least 10 characters)").fill("Bonus paid to the wrong consultant");
  await form.getByRole("group", { name: "Entry 1" }).getByLabel("Team").selectOption(s[2]!.c_code);
  await form.getByRole("group", { name: "Entry 1" }).getByLabel("Cash change ($)").fill("5000");
  await form.getByRole("button", { name: "Request correction" }).click();
  await expect(form.getByRole("status")).toContainText("Correction requested (1 entry)");
  await lead.close();

  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/ledger/corrections`);
  await expect(panel(page, "Request a correction")).toContainText("Only organisers request corrections");
  const pending = panel(page, "Pending corrections").getByRole("listitem", { name: "Pending correction 1" });
  await expect(pending.locator("tbody tr").first().getByRole("cell")).toHaveText([s[2]!.c_code, "", "", "+$5,000.00", ""]);
  await pending.getByLabel("Note on correction 1").fill("The bonus was right");
  await pending.getByRole("button", { name: "Reject" }).click();
  await pending.getByRole("button", { name: "Click again to reject" }).click();
  await expect(panel(page, "Pending corrections")).toContainText("No correction is waiting for a decision.");
  const history = panel(page, "Decided corrections").locator("tbody tr").first();
  await expect(history.getByRole("cell")).toHaveText([
    /\d\d:\d\d$/,
    "Rejected",
    "Bonus paid to the wrong consultant",
    `${s[2]!.c_code} · +$5,000.00`,
    "Event lead",
    "Fairness officer",
    "The bonus was right",
    "",
  ]);
  expect(Number((await ev.n.one("select count(*)::int as n from ledger_entries where event_id = $1 and kind = 'CORRECTION'", [ev.n.eventId])).n)).toBe(4);
});

test("a team whose cash differs from its ledger rows is named in the books check", async ({ page }) => {
  const f3 = s[2]!.f_code;
  const cash = Number((await ev.n.one("select cash_cents from teams where code = $1", [f3])).cash_cents);
  // Test only: break the books directly (no game function can).
  await ev.n.q("update teams set cash_cents = cash_cents + 1 where code = $1", [f3]);
  try {
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/ledger`);
    await expect(page.getByTestId("books-check")).toContainText("The books do not balance: 1 problem.");
    await expect(page.getByTestId("books-check")).toContainText(`${f3}: cash is ${formatCents(cash + 1)} but its ledger rows sum to ${formatCents(cash)}.`);
  } finally {
    await ev.n.q("update teams set cash_cents = cash_cents - 1 where code = $1", [f3]);
  }
});
