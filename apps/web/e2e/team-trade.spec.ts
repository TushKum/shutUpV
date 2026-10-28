import { expect, test, type Page } from "@playwright/test";
import type { PoolClient } from "pg";
import { ORDER_MESSAGES, buyReserve, clearingPrice, mulRate, shortCollateral, shortReserve } from "@msim/engine";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { pitchesReleased } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The finance specs share the team-code prefix R, and team codes (the logins) are unique across events, so only one
// of their events may exist at a time: each spec holds this lock from seeding to its end and first removes the other
// spec's event.
const OURS = ["e2e-team-trade", "e2e-team-ipo"];
let lock: PoolClient | undefined;
async function seedAlone(slug: string, squads = 3): Promise<E2eEvent> {
  lock = await e2ePool().connect();
  await lock.query("select pg_advisory_lock(hashtext('e2e-team-finance-R'))");
  for (const other of OURS) if (other !== slug) await lock.query("select public.purge_event($1)", [other]);
  return seedE2eEvent({ slug, prefix: "R", squads });
}
test.afterAll(async () => {
  await lock?.query("select pg_advisory_unlock(hashtext('e2e-team-finance-R'))");
  lock?.release();
});

// Three squads: ERA (squad 1), ERB (squad 2), ERC (squad 3). The viewer is squad 1's fund (before the draw, any fund),
// which may not trade ERA.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof pitchesReleased>>;
let fund: string;
const ist = (t: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const usd = (c: number) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (c: number) => (c > 0 ? `+${usd(c)}` : usd(c));

test.beforeAll(async () => {
  test.setTimeout(600_000); // may wait for the other finance spec to finish
  ev = await seedAlone("e2e-team-trade");
  fund = ev.plan.teams.find((t) => t.track === "FINANCE" && t.code.endsWith("01"))!.code;
});

async function as(page: Page, code: string, path: string) {
  await page.context().clearCookies();
  await loginAsTeam(page, ev, code);
  await page.goto(path);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
}
const ticket = (page: Page) => page.getByRole("form", { name: "Order ticket" });
const preview = (page: Page) => page.getByTestId("order-preview");
const companyId = (i: number) => s[i]!.company_id as string;
async function order(page: Page, i: number, type: "BUY" | "SELL" | "SHORT" | "COVER", qty: string) {
  const t = ticket(page);
  await t.getByLabel("Company").selectOption(companyId(i));
  await t.getByText(type, { exact: true }).click();
  await t.getByLabel("Quantity (shares)").fill(qty);
}
const noSidewaysScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

test("Product and Consulting teams are told they never trade", async ({ page }) => {
  for (const track of ["PRODUCT", "CONSULTING"] as const) {
    const code = ev.plan.teams.find((t) => t.track === track)!.code;
    await as(page, code, "/team/trade");
    await expect(page.getByText("Trading is for the Finance teams: Product and Consulting teams never trade")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Trading views" })).toHaveCount(0);
    await page.goto("/team/trade/positions");
    await expect(page.getByText("Trading is for the Finance teams")).toBeVisible();
  }
});

test("before Reading the fund is told when the companies are listed and when trading starts", async ({ page }) => {
  const at = async (code: string) => ist((await ev.n.one("select starts_at from phases where event_id = $1 and code = $2", [ev.n.eventId, code])).starts_at);
  await as(page, fund, "/team/trade");
  await expect(page.getByRole("navigation", { name: "Trading views" }).getByRole("link")).toHaveText(["Orders", "Positions", "History", "IPO"]);
  await expect(page.getByTestId("trading-notice")).toHaveText(
    `Trading starts with round 1 at ${await at("ROUNDS_1_4")}. The companies are listed at Reading (${await at("READING")}), and IPO bids open with the IPO at ${await at("IPO")}.`,
  );
  await page.goto("/team/trade/positions");
  await expect(page.getByRole("region", { name: "Positions" })).toHaveCount(0);
  await page.goto("/team/trade/history");
  await expect(page.getByText("No orders yet.")).toBeVisible();
});

test("after the IPO, before round 1: why trading is closed and when round 1 opens", async ({ page }) => {
  s = await pitchesReleased(ev);
  fund = s[0]!.f_code; // the lottery decides which fund is in squad 1
  await ev.n.advanceTo("IPO");
  await ev.n.ok(ev.n.team(fund), "place_ipo_bid", companyId(1), 1000);
  await ev.n.advanceTo("ROUNDS_1_4");
  const r1 = await ev.n.one("select status, opens_at from rounds where event_id = $1 and number = 1", [ev.n.eventId]);
  expect(r1.status).toBe("SCHEDULED");
  await as(page, fund, "/team/trade");
  await expect(page.getByTestId("trading-notice")).toContainText(`Trading is closed between rounds. Round 1 opens at ${ist(r1.opens_at)} (in `);
  await expect(ticket(page)).toHaveCount(0);
});

test("round 1 on a phone: live checks, Max, the reserve, place, edit and cancel; the clearing fills at the previewed price", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ev.n.openRound(1);
  await as(page, fund, "/team/trade");
  await expect(page.getByRole("heading", { name: "Order ticket · round 1" })).toBeVisible();
  await expect(page.getByText(/^closes in \d+:\d\d/)).toBeVisible();
  const t = ticket(page);
  // Its own squad's company is never offered.
  await expect(t.getByLabel("Company").locator("option")).toHaveText(["Choose a company…", "ERB · Company 2 · $10.50", "ERC · Company 3 · $10.50"]);
  await expect(page.getByText("Your squad's company, ERA, is not listed")).toBeVisible();

  // BUY: the IPO's 1,000 shares count towards the 4,000 limit.
  await order(page, 1, "BUY", "4000");
  await expect(preview(page)).toHaveText(`The exchange would refuse this order: ${ORDER_MESSAGES.LONG_LIMIT}`);
  await expect(t.getByRole("button", { name: /^Place/ })).toBeDisabled();
  await expect(page.getByLabel("Your position in ERB")).toContainText("Can still buy (4,000 limit)3,000");
  await t.getByRole("button", { name: "Max" }).click();
  await expect(t.getByLabel("Quantity (shares)")).toHaveValue("3000");
  await expect(page.getByTestId("order-reserve")).toHaveText(`Cash reserved until the clearing: ${usd(buyReserve(3000, 1050))} (quantity × price × 1.10).`);
  await t.getByLabel("Quantity (shares)").fill("1.5");
  await expect(preview(page)).toHaveText(`The exchange would refuse this order: ${ORDER_MESSAGES.BAD_QUANTITY}`);
  await t.getByLabel("Quantity (shares)").fill("2,000");
  await expect(page.getByTestId("order-reserve")).toHaveText(`Cash reserved until the clearing: $23,100.00 (quantity × price × 1.10).`);
  await t.getByRole("button", { name: "Place BUY 2,000 ERB" }).click();
  await expect(t.getByText("Order placed: BUY 2,000 ERB. It fills at this round's clearing price")).toBeVisible();
  await expect(t.getByLabel("Quantity (shares)")).toHaveValue("");
  const buy = await ev.n.one("select id, qty, reserve_cents, entry_price, client_ref from orders where team_id = $1 and type = 'BUY'", [ev.n.teamId(fund)]);
  expect([buy.qty, Number(buy.reserve_cents), buy.entry_price]).toEqual([2000, 2_310_000, 1050]);
  expect(buy.client_ref).toMatch(/^[0-9a-f-]{36}\|[0-9a-f-]{36}\|BUY\|2000$/);
  // The same order sent again (a retry after a dropped connection) is not placed twice.
  expect(await ev.n.call(ev.n.team(fund), "place_order", companyId(1), "BUY", 2000, buy.client_ref)).toMatchObject({ ok: true, duplicate: true });
  expect((await ev.n.q("select 1 from orders where team_id = $1 and type = 'BUY'", [ev.n.teamId(fund)])).length).toBe(1);
  await expect(page.getByTestId("reserved")).toHaveText("$23,100.00");

  // SELL: only the shares owned; nothing reserved.
  await order(page, 1, "SELL", "");
  await t.getByRole("button", { name: "Max" }).click();
  await expect(t.getByLabel("Quantity (shares)")).toHaveValue("1000");
  await t.getByLabel("Quantity (shares)").fill("500");
  await expect(page.getByTestId("order-reserve")).toHaveText("Nothing is reserved: selling shares you own is always allowed.");
  await t.getByRole("button", { name: "Place SELL 500 ERB" }).click();
  await expect(t.getByText("Order placed: SELL 500 ERB.")).toBeVisible();

  // SHORT: collateral of quantity × price × 150% × 1.10; COVER needs a short.
  await order(page, 2, "COVER", "1");
  await expect(preview(page)).toHaveText(`The exchange would refuse this order: ${ORDER_MESSAGES.NOT_ENOUGH_SHORT}`);
  await order(page, 2, "SHORT", "2001");
  await expect(preview(page)).toContainText(ORDER_MESSAGES.SHORT_LIMIT);
  await t.getByLabel("Quantity (shares)").fill("1000");
  await expect(page.getByTestId("order-reserve")).toContainText(`Collateral reserved until the clearing: ${usd(shortReserve(1000, 1050))}`);
  await t.getByRole("button", { name: "Place SHORT 1,000 ERC" }).click();
  await expect(t.getByText("Order placed: SHORT 1,000 ERC.")).toBeVisible();
  await expect(page.getByTestId("exposure")).toHaveText("$10,500.00");

  // The open orders: edit (checked as typed) and cancel.
  const open = page.getByTestId("open-order");
  await expect(open).toHaveCount(3);
  const buyRow = open.filter({ hasText: "BUY 2,000 ERB" });
  await buyRow.getByLabel("New quantity for BUY 2,000 ERB").fill("3001");
  await expect(buyRow.getByText(`The exchange would refuse this change: ${ORDER_MESSAGES.LONG_LIMIT}`)).toBeVisible();
  await buyRow.getByLabel("New quantity for BUY 2,000 ERB").fill("2500");
  await expect(buyRow.getByText("2,500 shares reserve $28,875.00")).toBeVisible();
  await buyRow.getByRole("button", { name: "Change quantity" }).click();
  await expect(page.getByTestId("open-order").filter({ hasText: "BUY 2,500 ERB" })).toBeVisible();
  expect(await ev.n.one("select qty, reserve_cents from orders where id = $1", [buy.id])).toEqual({ qty: 2500, reserve_cents: String(buyReserve(2500, 1050)) });
  await open.filter({ hasText: "SELL 500 ERB" }).getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByTestId("open-order")).toHaveCount(2);
  expect((await ev.n.one("select status from orders where team_id = $1 and type = 'SELL'", [ev.n.teamId(fund)])).status).toBe("CANCELLED");
  await noSidewaysScroll(page);

  // The clearing (checked against the engine by the driver) fills every order at its company's new price; the page
  // re-reads itself on the broadcast.
  await ev.n.clearRound(1);
  const erb = clearingPrice(1050, 2500);
  const erc = clearingPrice(1050, -1000);
  expect([erb, erc]).toEqual([1076, 1040]);
  await expect(page.getByTestId("trading-notice")).toContainText("Trading is closed between rounds.");
  await expect(page.getByTestId("open-order")).toHaveCount(0);
  await expect(page.getByTestId("reserved")).toHaveText("$0.00");

  await page.getByRole("navigation", { name: "Trading views" }).getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  const rows = page.getByTestId("history-order");
  await expect(rows.filter({ hasText: "BUY" })).toContainText(["BUY ERB2,500$10.76−$26,900.00Filled$10.50"]);
  await expect(rows.filter({ hasText: "SHORT" })).toContainText(["SHORT ERC1,000$10.40+$10,400.00Filled$10.50"]);
  await expect(rows.filter({ hasText: "SELL" })).toContainText(["SELL ERB500——Cancelled$10.50"]);
  await expect(page.getByText("Cash from fills")).toContainText(signed(-26_900_00 + 10_400_00));
  await noSidewaysScroll(page);
});

test("positions: lots, average cost, value, profit and loss, return, collateral and exposure, as the database has them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await as(page, fund, "/team/trade/positions");
  const team = await ev.n.one("select cash_cents, collateral_cents from teams where code = $1", [fund]);
  const cash = Number(team.cash_cents);
  // $450,000 − $10,500 at the IPO − $26,900 bought + $10,400 shorted.
  expect(cash).toBe(42_300_000);
  const row = (ticker: string, lot: string) => page.getByTestId(`position-${ticker}-${lot}`);
  // 1,000 at $10.50 + 2,500 at $10.76 = $37,400 for 3,500: $10.6857… → $10.69.
  await expect(row("ERB", "EXCHANGE")).toContainText("ERB Exchange3,500$37,660.00+$260.00$10.76$10.69");
  await expect(row("ERC", "SHORT")).toContainText("ERC Short1,000−$10,400.00$0.00$10.40$10.40");
  await expect(row("ERA", "SQUAD")).toContainText("ERA Squad lot5,000$52,500.00+$2,500.00$10.50$10.00");
  const value = cash + 3_766_000 + 5_250_000 - 1_040_000;
  await expect(page.getByTestId("portfolio-value")).toHaveText(usd(value));
  await expect(page.getByTestId("portfolio-gain")).toHaveText(signed(value - 50_000_000));
  // The value chart starts at the fund's opening value and its last step is the value above.
  await expect(page.getByTestId("portfolio-chart").getByRole("img")).toHaveAttribute(
    "aria-label",
    new RegExp(`^Your fund's value by step: Start \\$500,000\\.00, Round \\d+ ${usd(value).replace(/[$.]/g, "\\$&")};`),
  );
  await expect(page.getByTestId("portfolio-return")).toHaveText("+0.55%");
  await expect(page.getByTestId("portfolio-pnl")).toHaveText("+$2,760.00");
  const collateral = mulRate(1000 * 1040, 150, 100);
  expect(Number(team.collateral_cents)).toBe(collateral);
  await expect(page.getByTestId("collateral-locked")).toHaveText(usd(collateral));
  await expect(page.getByTestId("collateral-required")).toHaveText(usd(collateral));
  await expect(page.getByTestId("exposure-of-cap")).toHaveText("$10,400.00 of $250,000.00");
  await expect(page.getByTestId("collateral-status")).toHaveText("Your cash covers your collateral: new buys and shorts are allowed.");
  await expect(page.getByRole("region", { name: "Limits per company" })).toContainText("ERB3,500 of 4,0000 of 2,000");
  await noSidewaysScroll(page);
});

test("round 2 opens on screen; another device's orders reach the page; the database's refusal is shown", async ({ page }) => {
  await as(page, fund, "/team/trade");
  const r2 = await ev.n.one("select opens_at from rounds where event_id = $1 and number = 2", [ev.n.eventId]);
  await expect(page.getByTestId("trading-notice")).toContainText(`Trading is closed between rounds. Round 2 opens at ${ist(r2.opens_at)} (in `);
  // The round opens by the heartbeat and broadcasts: the ticket appears without a reload.
  await ev.n.openRound(2);
  await expect(page.getByRole("heading", { name: "Order ticket · round 2" })).toBeVisible();
  await expect(page.getByTestId("trading-notice")).toHaveCount(0);

  // Another device of the same fund buys 500 ERB: orders send no broadcast, so this page does not know yet.
  const other = await ev.n.ok(ev.n.team(fund), "place_order", companyId(1), "BUY", 500);
  await order(page, 1, "BUY", "100");
  await expect(page.getByTestId("order-reserve")).toBeVisible();
  await ticket(page).getByRole("button", { name: "Place BUY 100 ERB" }).click();
  await expect(ticket(page).getByText(`LONG_LIMIT: ${ORDER_MESSAGES.LONG_LIMIT}`)).toBeVisible();
  // The page re-read itself after the refusal: the other device's order is listed.
  await expect(page.getByTestId("open-order").filter({ hasText: "BUY 500 ERB" })).toBeVisible();
  await expect(page.getByLabel("Your position in ERB")).toContainText("Can still buy (4,000 limit)0");

  // The other device cancels it: this page re-reads itself within 10 s while the round is open, with no action here.
  await ev.n.ok(ev.n.team(fund), "cancel_order", other.order.id);
  await expect(page.getByTestId("open-order")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByLabel("Your position in ERB")).toContainText("Can still buy (4,000 limit)500");
  await expect(ticket(page).getByRole("button", { name: "Place BUY 100 ERB" })).toBeEnabled();
});

test("a pause freezes the round's orders and says why; they can be changed again on resume", async ({ page }) => {
  await as(page, fund, "/team/trade");
  await order(page, 2, "SHORT", "100");
  const shortReserveText = `Collateral reserved until the clearing: ${usd(shortReserve(100, 1040))}`;
  await expect(page.getByTestId("order-reserve")).toContainText(shortReserveText);
  await ticket(page).getByRole("button", { name: "Place SHORT 100 ERC" }).click();
  await expect(ticket(page).getByText("Order placed: SHORT 100 ERC.")).toBeVisible();
  // The reserve the ticket showed is the one the database locked.
  const placed = await ev.n.one("select reserve_cents, entry_price from orders where team_id = $1 and type = 'SHORT' and status = 'PENDING'", [ev.n.teamId(fund)]);
  expect([Number(placed.reserve_cents), placed.entry_price]).toEqual([shortReserve(100, 1040), 1040]);
  const row = page.getByTestId("open-order").filter({ hasText: "SHORT 100 ERC" });
  await expect(row.getByRole("button", { name: "Cancel order" })).toBeVisible();

  await ev.n.org("pause_event", ev.n.eventId);
  await expect(page.getByTestId("trading-notice")).toHaveText(
    "The event is paused: orders are refused until it resumes. Round 2 carries on then, and its closing time moves later by the length of the pause.",
  );
  await expect(ticket(page)).toHaveCount(0);
  await expect(page.getByTestId("open-orders-state")).toHaveText("paused: no changes until the event resumes");
  await expect(row.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  expect(await ev.n.call(ev.n.team(fund), "place_order", companyId(2), "SHORT", 10)).toMatchObject({ ok: false, code: "TRADING_PAUSED" });

  await ev.n.org("resume_event", ev.n.eventId);
  await expect(ticket(page)).toBeVisible();
  await expect(row.getByRole("button", { name: "Cancel order" })).toBeVisible();
  await expect(page.getByTestId("trading-notice")).toHaveCount(0);
});

test("the rate limit is shown, and nothing is placed", async ({ page }) => {
  await as(page, fund, "/team/trade");
  // 20 order actions per 10 seconds per fund: another device uses them up.
  await order(page, 2, "COVER", "10");
  for (let i = 0; i < 25; i++) {
    const r = await ev.n.call(ev.n.team(fund), "cancel_order", "00000000-0000-0000-0000-000000000000");
    if (r.code === "RATE_LIMITED") break;
  }
  await ticket(page).getByRole("button", { name: "Place COVER 10 ERC" }).click();
  await expect(ticket(page).getByText("RATE_LIMITED: Too many order actions. Wait a few seconds.")).toBeVisible();
  expect((await ev.n.q("select 1 from orders where team_id = $1 and type = 'COVER'", [ev.n.teamId(fund)])).length).toBe(0);
});

test("a collateral deficit blocks buys and shorts, never sells and covers", async ({ page }) => {
  // A deficit takes a squeeze over many rounds; here the fund's cash is set below its collateral (test only).
  const team = await ev.n.one("select cash_cents, collateral_cents from teams where code = $1", [fund]);
  expect(Number(team.collateral_cents)).toBeGreaterThan(0);
  await ev.n.q("update teams set cash_cents = collateral_cents - 100 where code = $1", [fund]);
  try {
    await as(page, fund, "/team/trade");
    await expect(page.getByTestId("collateral-blocked")).toContainText("short by $1.00: new buys and shorts are blocked until cash covers it");
    await order(page, 2, "BUY", "1");
    await expect(preview(page)).toHaveText(`The exchange would refuse this order: ${ORDER_MESSAGES.COLLATERAL_DEFICIT}`);
    await order(page, 2, "SHORT", "1");
    await expect(preview(page)).toHaveText(`The exchange would refuse this order: ${ORDER_MESSAGES.COLLATERAL_DEFICIT}`);
    await order(page, 2, "COVER", "10");
    await expect(page.getByTestId("order-reserve")).toHaveText("Nothing is reserved: covering releases more collateral than it costs.");
    await page.goto("/team/trade/positions");
    await expect(page.getByTestId("collateral-status")).toContainText("Blocked: your cash");
  } finally {
    await ev.n.q("update teams set cash_cents = $2 where code = $1", [fund, team.cash_cents]);
  }
});

test("round 2 clears on a phone: the short's average, its value and the collateral at the new price are the database's", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await as(page, fund, "/team/trade/positions");
  await expect(page.getByTestId("position-ERC-SHORT")).toContainText("ERC Short1,000");
  await ev.n.clearRound(2); // checked against the engine's clearRound by the driver; the page re-reads on the broadcast
  const erc = clearingPrice(1040, -100);
  expect(erc).toBe(1039);
  const short = await ev.n.one("select h.qty, h.cost_cents from holdings h join teams t on t.id = h.team_id where t.code = $1 and h.company_id = $2 and h.lot = 'SHORT'", [
    fund,
    companyId(2),
  ]);
  expect([short.qty, Number(short.cost_cents)]).toEqual([1100, 1_040_000 + 100 * erc]);
  // 1,100 short: proceeds $11,439 ($10.40 average), worth −$11,429 at $10.39, so +$10.
  await expect(page.getByTestId("position-ERC-SHORT")).toContainText(`ERC Short1,100−$11,429.00+$10.00$10.39$10.40`);
  const team = await ev.n.one("select collateral_cents from teams where code = $1", [fund]);
  expect(Number(team.collateral_cents)).toBe(shortCollateral(1100, erc));
  await expect(page.getByTestId("collateral-locked")).toHaveText(usd(shortCollateral(1100, erc)));
  await expect(page.getByTestId("collateral-required")).toHaveText(usd(shortCollateral(1100, erc)));
  await expect(page.getByTestId("exposure-of-cap")).toHaveText(`${usd(1100 * erc)} of $250,000.00`);
  await noSidewaysScroll(page);

  await page.getByRole("navigation", { name: "Trading views" }).getByRole("link", { name: "History" }).click();
  const round2 = page.getByRole("region", { name: "Orders of round 2" });
  await expect(round2.getByTestId("history-order").filter({ hasText: "SHORT" })).toContainText(`SHORT ERC100${usd(erc)}+${usd(100 * erc)}Filled$10.40`);
  await expect(round2.getByTestId("history-order").filter({ hasText: "BUY" })).toContainText("BUY ERB500——Cancelled$10.76");
  await noSidewaysScroll(page);
});
