import { expect, test, type Page } from "@playwright/test";
import type { PoolClient } from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The common sections' three specs share the team-code prefix C, and team codes (the logins) are unique across
// events, so only one of their events may exist at a time: each spec holds this lock from seeding to its end and
// first removes the other two specs' events.
const OURS = ["e2e-team-home", "e2e-team-market", "e2e-team-qa"];
let lock: PoolClient | undefined;
async function seedAlone(slug: string): Promise<E2eEvent> {
  lock = await e2ePool().connect();
  await lock.query("select pg_advisory_lock(hashtext('e2e-team-common-C'))");
  for (const other of OURS) if (other !== slug) await lock.query("select public.purge_event($1)", [other]);
  return seedE2eEvent({ slug, prefix: "C" });
}
test.afterAll(async () => {
  await lock?.query("select pg_advisory_unlock(hashtext('e2e-team-common-C'))");
  lock?.release();
});

// Three squads: ECA (squad 1), ECB (squad 2), ECC (squad 3). The viewer is mostly squad 3's Consulting team.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
const ticker = (i: number) => `EC${"ABC"[i]}`;
const ist = (t: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

test.beforeAll(async () => {
  test.setTimeout(600_000); // may wait for another common spec to finish
  ev = await seedAlone("e2e-team-market");
});

async function as(page: Page, code: string, path: string) {
  await page.context().clearCookies();
  await loginAsTeam(page, ev, code);
  await page.goto(path);
}
const views = (page: Page) => page.getByRole("navigation", { name: "Market views" }).getByRole("link");
const listRow = (page: Page, i: number) => page.getByTestId(`market-${ticker(i)}`).getByRole("cell");
const history = (page: Page) => page.getByRole("region", { name: "Price history" }).locator("tbody tr");
const ledgerRows = (page: Page) => page.getByRole("region", { name: "Public ledger rows" }).locator("tbody tr");
const price = async (i: number) => Number((await ev.n.one("select market_price from companies where id = $1", [s[i]!.company_id])).market_price);

test("before Reading the market says when it opens; nothing about any company is shown", async ({ page }) => {
  const reading = ist((await ev.n.one("select starts_at from phases where event_id = $1 and code = 'READING'", [ev.n.eventId])).starts_at);
  const consulting = ev.plan.teams.find((t) => t.track === "CONSULTING")!.code;
  await as(page, consulting, "/team/market");
  await expect(page.getByText(`The market opens at ${reading} (Reading), when the pitch book goes public. Prices follow at the IPO.`)).toBeVisible();
  await page.goto("/team/market/book");
  await expect(page.getByText("The pitch book goes public when Reading starts.")).toBeVisible();
  await page.goto("/team/market/ECA");
  await expect(page.getByText("The market opens at Reading, when the pitch book goes public.")).toBeVisible();
  await page.goto("/team/ledger");
  await expect(page.getByText("Nothing in the public ledger yet.")).toBeVisible();
});

test("Reading: the listing (no prices yet), the pitch book with every company's template fields", async ({ page }) => {
  s = await drawn(ev);
  await ev.n.advanceTo("BUILD");
  await ev.n.deadlinePassed("PROBLEM_PICK");
  for (const [i, x] of s.entries()) {
    await ev.n.ok(ev.n.team(x.p_code), "save_draft", "PITCH", {
      company_name: `Company ${i + 1}`,
      ticker: ticker(i),
      problem: `Problem of company ${i + 1}.`,
      solution: "Sensors in every tank.",
      customers: "Town councils.",
      business_model: "Yearly subscription.",
      advantage: "Cheaper than lab tests.",
      use_of_seed: "",
    }, 0);
    await ev.n.ok(ev.n.team(x.p_code), "submit_submission", "PITCH");
  }

  // During Build a squad can read its own pitch, but the market stays closed for everyone.
  await as(page, s[0]!.p_code, "/team/market/book");
  await expect(page.getByText("The pitch book goes public when Reading starts.")).toBeVisible();

  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  await as(page, s[2]!.c_code, "/team/market");
  await expect(page.getByRole("heading", { name: "Listed companies (3)" })).toBeVisible();
  await expect(views(page)).toHaveText(["Prices", "Pitch book"]);
  await expect(page.getByText("IPO prices are released at the IPO, with the pitch scores.")).toBeVisible();
  await expect(listRow(page, 0)).toHaveText([ticker(0), "Company 1", "—", "—", "—"]);
  await expect(listRow(page, 2)).toHaveText([ticker(2), "Company 3Yours", "—", "—", "—"]);

  await views(page).getByText("Pitch book").click();
  await expect(page).toHaveURL(/\/team\/market\/book\?type=PITCH$/);
  await expect(page.getByRole("heading", { name: "Pitch book (3 of 3)" })).toBeVisible();
  const eca = page.getByRole("region", { name: `${ticker(0)} pitch book` });
  await expect(eca.getByTestId("submission-PITCH").locator("dt")).toHaveText([
    "The problem",
    "The solution",
    "Customers",
    "How we make money",
    "Our advantage",
    "Use of seed money",
  ]);
  await expect(eca.getByTestId("submission-PITCH").locator("dd").first()).toHaveText("Problem of company 1.");
  await expect(eca.getByTestId("submission-PITCH").locator("dd").last()).toHaveText("(left empty)");
  await expect(page.getByRole("region", { name: `${ticker(2)} pitch book` }).getByText("Your squad")).toBeVisible();
  await expect(page.getByTestId("book-verdict")).toHaveCount(0); // scores are sealed until released

  await page.goto("/team/market/book?type=PLAN");
  await expect(page.getByText("Rescue plans go public when Plans published starts.")).toBeVisible();
  await page.goto("/team/market/book?type=crisis");
  await expect(page.getByText("Crisis cards go public at the crisis, when every company gets one.")).toBeVisible();

  await page.goto(`/team/market/${ticker(1).toLowerCase()}`);
  await expect(page.getByRole("heading", { name: new RegExp(`^${ticker(1)}\\s?Company 2$`) })).toBeVisible();
  await expect(page.getByTestId("submission-PITCH")).toBeVisible();
  await expect(page.getByText("No price yet: prices start at the IPO.")).toBeVisible();
  await expect(page.getByText("Crisis cards go public at the crisis, when every company gets one. Rescue plans go public when Plans published starts.")).toBeVisible();
  await page.goto("/team/market/ZZZZ");
  await expect(page.getByText("No listed company has the ticker ZZZZ.")).toBeVisible();
});

test("the IPO and round 1: IPO prices from the pitch verdicts, the last round's move, the price history", async ({ page }) => {
  const scores = [[66, 66, 66], [85, 85, 85], [45, 45, 45]]; // +5% → $10.50, +10% → $11.00, −5% → $9.50
  for (const [i, x] of s.entries()) await ev.n.judge(x.company_id, "PITCH", scores[i]!);
  await ev.n.deadlinePassed("CALL_1");
  await ev.n.org("release_scores", ev.n.eventId, "PITCH");
  await ev.n.advanceTo("IPO");
  await ev.n.ok(ev.n.team(s[2]!.f_code), "place_ipo_bid", s[0]!.company_id, 1000);
  await ev.n.advanceTo("ROUNDS_1_4");
  await ev.n.openRound(1);
  await ev.n.ok(ev.n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 2000);
  await ev.n.ok(ev.n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 1500);
  await ev.n.ok(ev.n.team(s[2]!.f_code), "place_order", s[0]!.company_id, "SELL", 500);
  await ev.n.clearRound(1);
  expect([await price(0), await price(1), await price(2)]).toEqual([1082, 1100, 950]); // acceptance test 1: $10.50 → $10.82

  await as(page, s[2]!.c_code, "/team/market");
  await expect(page.getByRole("region", { name: "Listed companies" }).locator("th")).toHaveText(["Ticker", "Company", "IPO price", "Market price", "Round 1"]);
  await expect(listRow(page, 0)).toHaveText([ticker(0), "Company 1", "$10.50", "$10.82", "▲ +3.05%"]);
  await expect(listRow(page, 1)).toHaveText([ticker(1), "Company 2", "$11.00", "$11.00", "■ 0%"]);
  await expect(listRow(page, 2)).toHaveText([ticker(2), "Company 3Yours", "$9.50", "$9.50", "■ 0%"]);
  await expect(page.getByText("IPO prices are released at the IPO")).toHaveCount(0);

  await listRow(page, 0).getByRole("link", { name: ticker(0) }).click();
  await expect(page).toHaveURL(new RegExp(`/team/market/${ticker(0)}$`));
  await expect(page.getByTestId("verdict-PITCH")).toHaveText(/^Pitch66\/100\+5% on the IPO price/);
  // Why: the published judge run's points per rubric line and its rationale.
  await page.getByTestId("verdict-PITCH").getByText("Why this score").click();
  await expect(page.getByTestId("verdict-PITCH")).toContainText("Problem and how many people have it25/25");
  await expect(page.getByTestId("verdict-PITCH")).toContainText("One. Two. Three.");
  await expect(history(page)).toHaveCount(2);
  await expect(history(page).nth(0).getByRole("cell")).toHaveText(["IPO price", /^\d\d:\d\d$/, "$10.50", "—", "$10.50", "Pitch tier +5% on $10.00"]);
  await expect(history(page).nth(1).getByRole("cell")).toHaveText([
    "Round 1",
    /^\d\d:\d\d$/,
    "$10.82",
    "+$0.32 (+3.05%)",
    "$10.50",
    "Net +3,000 (buy 3,500 · sell 500 · short 0 · cover 0)",
  ]);
  await page.goto(`/team/market/${ticker(2)}`);
  await expect(page.getByTestId("verdict-PITCH")).toHaveText(/^Pitch45\/100−5% on the IPO price/);
});

test("the crisis: −15% on every price, each company's crisis card, and the crisis cards book", async ({ page }) => {
  await ev.n.advanceTo("CRISIS");
  expect([await price(0), await price(1), await price(2)]).toEqual([920, 935, 808]); // × 0.85, rounded half-up
  const cards = await ev.n.q("select c.ticker, k.category, k.title, k.body from companies c join crisis_cards k on k.id = c.crisis_card_id where c.event_id = $1 order by c.ticker", [ev.n.eventId]);
  expect(cards).toHaveLength(3);

  await as(page, s[2]!.c_code, "/team/market");
  await expect(views(page)).toHaveText(["Prices", "Pitch book", "Crisis cards"]);
  await expect(listRow(page, 0)).toHaveText([ticker(0), "Company 1", "$10.50", "$9.20", "■ 0%"]); // round 4 (cleared unchanged) was the last
  await views(page).getByText("Crisis cards").click();
  await expect(page.getByRole("heading", { name: "Crisis cards (3 of 3)" })).toBeVisible();
  for (const c of cards) {
    const card = page.getByRole("region", { name: `${c.ticker} crisis cards` }).getByTestId("crisis-card");
    await expect(card).toContainText(`Crisis · ${c.category}`);
    await expect(card.getByRole("heading")).toHaveText(c.title);
    await expect(card).toContainText(c.body);
  }

  await page.goto(`/team/market/${ticker(0)}`);
  await expect(page.getByTestId("crisis-card").getByRole("heading")).toHaveText(cards[0]!.title);
  const crisisRow = history(page).filter({ hasText: "Crisis shock" });
  await expect(crisisRow.getByRole("cell")).toHaveText(["Crisis shock", /^\d\d:\d\d$/, "$9.20", "−$1.62 (−14.97%)", "$8.93", "−15% on the market and AI prices"]);
  await expect(page.getByText("Post-crisis price")).toBeVisible();
});

test("the rescue and Plans published: plans with their crisis cards; verdicts once released (final score, tier, capped, missing)", async ({ page }) => {
  // Squad 1 agrees a fee in cash and shares and signs a deal; squads 2 and 3 pay the default fee and sign nothing.
  const [a, b] = [s[0]!, s[1]!];
  const fee = await ev.n.ok(ev.n.team(a.c_code), "propose_fee", 1_000_000, 1000);
  await ev.n.ok(ev.n.team(a.p_code), "confirm_fee", fee.fee.version);
  await ev.n.ok(ev.n.team(a.c_code), "confirm_fee", fee.fee.version);
  await ev.n.ok(ev.n.team(a.c_code), "edit_deal", null, 700);
  const deal = (await ev.n.ok(ev.n.team(a.f_code), "edit_deal", 4_000_000, null)).deal;
  for (const code of [a.p_code, a.c_code, a.f_code]) await ev.n.ok(ev.n.team(code), "sign_deal", deal.version);
  await ev.n.deadlinePassed("FEE");
  await ev.n.ok(ev.n.lead, "tick", ev.n.eventId); // the default fee of $22,500 for squads 2 and 3

  const plan = (text: string) => ({
    crisis: text,
    new_plan: "License the software.",
    money: "Costs $40,000.",
    deal: "$40,000 at $7.00.",
    time_to_recovery: "Nine months.",
    risks: "Partners may refuse.",
    next_steps: "Sign two partners.",
  });
  await ev.n.ok(ev.n.team(a.p_code), "save_draft", "PLAN", plan("Company 1 rebuilds its supply."), 0);
  await ev.n.ok(ev.n.team(a.p_code), "submit_submission", "PLAN");
  await ev.n.ok(ev.n.team(b.c_code), "save_draft", "PLAN", plan("Company 2 changes partners."), 0);
  await ev.n.ok(ev.n.team(b.c_code), "submit_submission", "PLAN");

  // Before Plans published, a squad reads its own plan in its workspace, never on the market.
  await as(page, a.p_code, `/team/market/${ticker(0)}`);
  await expect(page.getByTestId("crisis-card")).toBeVisible();
  await expect(page.getByTestId("submission-PLAN")).toHaveCount(0);

  await ev.n.deadlinePassed("PLAN");
  await ev.n.deadlinePassed("DEAL");
  await ev.n.advanceTo("PLANS_PUBLISHED");
  await as(page, s[2]!.c_code, "/team/market/book?type=PLAN");
  await expect(views(page)).toHaveText(["Prices", "Pitch book", "Crisis cards", "Rescue plans"]);
  await expect(page.getByRole("heading", { name: "Rescue plans (2 of 3)" })).toBeVisible();
  const ecaPlan = page.getByRole("region", { name: `${ticker(0)} rescue plans` });
  await expect(ecaPlan.getByTestId("crisis-card")).toBeVisible();
  await expect(ecaPlan.getByTestId("submission-PLAN").locator("dd").first()).toHaveText("Company 1 rebuilds its supply.");
  await expect(page.getByRole("region", { name: `${ticker(2)} rescue plans` })).toContainText("Nothing was submitted on time.");
  await expect(page.getByTestId("book-verdict")).toHaveCount(0); // plans go public without their scores

  await ev.n.judge(a.company_id, "PLAN", [86, 88, 91]);
  await ev.n.judge(b.company_id, "PLAN", [78, 78, 78]);
  await ev.n.org("seal_missing_scores", ev.n.eventId, "PLAN");
  await page.reload();
  await expect(page.getByTestId("book-verdict")).toHaveCount(0); // sealed, not released
  await ev.n.advanceTo("VERDICTS");
  await ev.n.org("release_scores", ev.n.eventId, "PLAN");
  await page.reload();
  await expect(page.getByTestId("book-verdict")).toHaveText(["88/100+20% on the price", "50/1000% on the price", "0/100−20% on the price"]);
  await expect(page.getByRole("region", { name: `${ticker(1)} rescue plans` })).toContainText(
    "Capped at 50: the rescue deal was not fully signed by the deal deadline (judges' median 78).",
  );
  await expect(page.getByRole("region", { name: `${ticker(2)} rescue plans` })).toContainText("No submission on time: scored 0.");

  await page.goto(`/team/market/${ticker(0)}`);
  await expect(page.getByTestId("verdict-PLAN")).toHaveText(/^Rescue plan88\/100\+20% on the price/);
  await expect(page.getByTestId("submission-PLAN")).toBeVisible();
  const tier = history(page).filter({ hasText: "Plan tier" });
  await expect(tier.getByRole("cell").nth(5)).toHaveText("+20% on the market and AI prices");
  expect(await price(0)).toBe(1104); // acceptance test 4: $9.20 → $11.04
  await expect(tier.getByRole("cell").nth(2)).toHaveText("$11.04");
});

test("flash news: the FLASH bulletin stands out; flash answers and their verdicts go public at the release", async ({ page }) => {
  const [a, b] = [s[0]!, s[1]!];
  await ev.n.advanceTo("ROUNDS_13_21");
  for (const r of [13, 14, 15]) {
    await ev.n.openRound(r);
    await ev.n.clearRound(r);
  }
  await ev.n.org("prepare_flash_bulletin", ev.n.eventId, "Interest rates rise", "Investors want profit within 12 months.");
  await ev.n.org("publish_flash_bulletin", ev.n.eventId);
  await ev.n.ok(ev.n.team(a.p_code), "save_draft", "FLASH", { answer: "Licensing is profitable by month 9." }, 0);
  await ev.n.ok(ev.n.team(a.p_code), "submit_submission", "FLASH");
  await ev.n.ok(ev.n.team(b.c_code), "save_draft", "FLASH", { answer: "We cut costs." }, 0);
  await ev.n.ok(ev.n.team(b.c_code), "submit_submission", "FLASH");

  await as(page, a.p_code, "/team/bulletins");
  const flash = page.getByRole("article", { name: "Flash bulletin: Interest rates rise" });
  await expect(flash).toHaveAttribute("data-kind", "FLASH");
  await expect(flash).toHaveCSS("border-left-width", "4px");
  // Squad 1 can read its own answer in its workspace; the market shows no answer before the release.
  await page.goto(`/team/market/${ticker(0)}`);
  await expect(page.getByTestId("submission-FLASH")).toHaveCount(0);
  await expect(page.getByText("Flash answers go public once the flash scores are released.")).toBeVisible();
  await page.goto("/team/market/book?type=FLASH");
  await expect(page.getByText("Flash answers go public once the flash scores are released.")).toBeVisible();

  await ev.n.deadlinePassed("FLASH");
  for (const r of [16, 17]) {
    await ev.n.openRound(r);
    await ev.n.clearRound(r);
  }
  await ev.n.judge(a.company_id, "FLASH", [80, 80, 80]);
  await ev.n.judge(b.company_id, "FLASH", [55, 55, 55]);
  await ev.n.org("seal_missing_scores", ev.n.eventId, "FLASH");
  await ev.n.org("release_scores", ev.n.eventId, "FLASH");

  await as(page, s[2]!.c_code, "/team/market/book?type=FLASH");
  await expect(views(page)).toHaveText(["Prices", "Pitch book", "Crisis cards", "Rescue plans", "Flash answers"]);
  await expect(page.getByRole("heading", { name: "Flash answers (2 of 3)" })).toBeVisible();
  await expect(page.getByRole("region", { name: `${ticker(0)} flash answers` }).getByTestId("submission-FLASH")).toContainText(
    "Our answerLicensing is profitable by month 9.",
  );
  await page.goto(`/team/market/${ticker(0)}`);
  await expect(page.getByTestId("verdict-FLASH")).toHaveText(/^Flash answer80\/100\+5% on the price/);
  await expect(page.getByRole("list", { name: "Verdicts" }).getByRole("listitem")).toHaveCount(3);
  await expect(history(page).filter({ hasText: "Flash tier" }).getByRole("cell").nth(5)).toHaveText("+5% on the market and AI prices");
});

test("the public ledger: transfers by squad and role, round totals, newest first, filtered and paged; no team codes", async ({ page }) => {
  // Fifty published corrections (each requested by one organiser and approved by another) take the ledger past a page.
  for (let i = 1; i <= 50; i++) {
    const r = await ev.n.org("request_correction", ev.n.eventId, `Rounding refund number ${i}`, JSON.stringify([{ team_id: ev.n.teamId(s[0]!.c_code), cash_delta_cents: 1 }]));
    await ev.n.ok(ev.n.second, "decide_correction", r.correction_id, true, "Checked.");
  }
  const total = Number((await ev.n.one("select count(*)::int as n from public_ledger where event_id = $1", [ev.n.eventId])).n);
  expect(total).toBeGreaterThan(50);

  await as(page, s[2]!.c_code, "/team/ledger");
  const pager = page.getByRole("navigation", { name: "Ledger pages", exact: true });
  await expect(pager).toContainText(`Rows 1–50 of ${total} · page 1 of 2`);
  await expect(ledgerRows(page)).toHaveCount(50);
  await expect(ledgerRows(page).first().getByRole("cell")).toHaveText([/^\d\d:\d\d:\d\d$/, "Correction", "Ledger correction", "—", "—", "—", "—", "Rounding refund number 50 · 1 entry"]);
  await pager.getByRole("link", { name: "Older →" }).click();
  await expect(page).toHaveURL(/page=2$/);
  await expect(ledgerRows(page)).toHaveCount(total - 50);
  // The first rows of the night: the seed money, labelled by squad and role.
  await expect(ledgerRows(page).last().getByRole("cell")).toHaveText([/^\d\d:\d\d:\d\d$/, "Seed money", /^Squad 0\d · Finance → company$/, /^EC[ABC]$/, "$50,000.00", "5,000", "$10.00", ""]);

  await page.getByLabel("Kind").selectOption("Rescue deal");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/[?&]kind=DEAL$/);
  await expect(ledgerRows(page)).toHaveCount(1);
  await expect(ledgerRows(page).first().getByRole("cell")).toHaveText([/^\d\d:\d\d:\d\d$/, "Rescue deal", "Squad 01 · rescue deal", ticker(0), "$39,998.00", "5,714", "$7.00", "Post-crisis price $9.20"]);

  await page.getByLabel("Kind").selectOption("Advisor fee");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(ledgerRows(page).first().getByRole("cell")).toHaveText([/./, "Advisor fee", "Squad 01 · advisor fee", ticker(0), "$10,000.00", "1,000", "—", "Total value $20,500.00 (shares at the IPO price)"]);
  await page.getByLabel("Kind").selectOption("Default fee");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(ledgerRows(page)).toHaveCount(2);
  await expect(ledgerRows(page).getByRole("cell").nth(2)).toHaveText(/^Squad 0[23] · default advisor fee$/);

  await page.getByLabel("Company").selectOption(ticker(0));
  await page.getByLabel("Kind").selectOption("Round totals");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?company=${ticker(0)}&kind=ROUND$`));
  await expect(ledgerRows(page)).toHaveCount(1);
  await expect(ledgerRows(page).first().getByRole("cell")).toHaveText([/./, "Round totals", "Round 1", ticker(0), "—", "+3,000", "$10.82", "buy 3,500 · sell 500 · short 0 · cover 0 · was $10.50"]);
  await page.getByLabel("Kind").selectOption("IPO allocation");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(ledgerRows(page).first().getByRole("cell")).toHaveText([/./, "IPO allocation", "IPO allocation", ticker(0), "$10,500.00", "1,000", "$10.50", "1,000 requested of 35,000 · 1 fund"]);

  // Individual funds' trades are private, and no team is ever named.
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).toHaveURL(/\/team\/ledger$/);
  await page.goto("/team/ledger?page=2");
  await expect(page.locator("main")).not.toContainText(/\bC[PCF]\d\d\b/);
  await page.goto("/team/ledger?kind=TRADE");
  await expect(page.getByText("No ledger kind TRADE.")).toBeVisible();
});

test("on a phone (390 px) the market, a company, a book and the ledger fit; tables scroll inside their panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, s[2]!.c_code, "/team/market");
  for (const path of ["/team/market", `/team/market/${ticker(0)}`, "/team/market/book?type=PLAN", "/team/ledger"]) {
    await page.goto(path);
    await expect(page.locator("main section").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
  const region = page.getByRole("region", { name: "Public ledger rows" });
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // the table scrolls inside its panel
});
