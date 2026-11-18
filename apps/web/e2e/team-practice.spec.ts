import { expect, test } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

// The Round 1 practice market (laptop): before Round 1 it says when it opens; in Round 1 a Finance team trades the
// scripted candlestick market (the Do-this-now task leads there, the chart and the patterns show, a BUY fills and the
// account follows); when Round 1 ends the profit is carried into the real fund and the page shows the result.
//
// The team-code prefix U is shared with display-takeovers.spec.ts: the files take turns (an advisory lock).
let ev: E2eEvent;
let turn: pg.PoolClient | undefined;
let fund = "";

test.beforeAll(async () => {
  test.setTimeout(300_000);
  turn = await e2ePool().connect();
  await turn.query("select pg_advisory_lock(hashtext('e2e:team-code-prefix:U'))");
  await e2ePool().query("select public.purge_event($1)", ["e2e-display-takeovers"]);
  ev = await seedE2eEvent({ slug: "e2e-team-practice", prefix: "U", format: "PRIMUS" });
  fund = ev.plan.teams.find((t) => t.track === "FINANCE")!.code;
});

test.afterAll(async () => {
  await turn?.query("select pg_advisory_unlock_all()");
  turn?.release();
});

test("before Round 1 the practice market says when it opens", async ({ page }) => {
  await loginAsTeam(page, ev, fund);
  await page.goto("/team/trade/practice");
  await expect(page.getByTestId("practice-notice")).toContainText("The practice market opens with Round 1");
});

test("in Round 1 a fund trades the candlestick market and the profit becomes its edge", async ({ page }) => {
  test.setTimeout(240_000);
  await drawn(ev);
  await ev.n.advanceTo("BUILD");
  // The market started ten minutes ago, so the chart has twenty candles.
  await ev.n.q("update phases set started_at = now() - interval '10 minutes' where event_id = $1 and code = 'BUILD'", [ev.n.eventId]);

  await loginAsTeam(page, ev, fund);
  await page.goto("/team");
  await page.getByRole("link", { name: "Open the practice market" }).click();
  await expect(page).toHaveURL(/\/team\/trade\/practice/);
  const term = page.getByTestId("practice-terminal");
  await expect(term).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("practice-tickers").getByRole("button")).toHaveCount(ev.plan.teams.filter((t) => t.track === "PRODUCT").length);
  await expect(page.getByTestId("practice-price")).toContainText("$", { timeout: 20_000 });
  await expect(page.getByTestId("practice-chart").locator("svg rect").first()).toBeVisible({ timeout: 20_000 });
  // The crosshair reads out a candle.
  await page.getByTestId("practice-chart").locator("svg").hover({ position: { x: 300, y: 150 } });
  await expect(page.getByTestId("practice-chart-ohlc")).toContainText("O $");
  await expect(page.getByTestId("practice-chart-patterns")).toBeVisible();

  // A trade.
  await page.getByLabel("Shares").fill("500");
  await page.getByTestId("practice-BUY").click();
  await expect(page.getByTestId("practice-message")).toContainText("BUY 500", { timeout: 15_000 });
  await expect(page.getByTestId("practice-account")).toContainText("long");
  await expect(page.getByTestId("practice-trades")).toContainText("BUY 500");
  // A refusal is shown as it comes.
  await page.getByTestId("practice-SHORT").click();
  await expect(page.getByTestId("practice-message")).toContainText("SELL first");

  // Round 1 ends: the fund's profit (set here to $20,000) is carried into its real cash.
  const teamId = ev.n.teamId(fund);
  await ev.n.q("update practice_accounts set cash_cents = cash_cents + 2000000 where team_id = $1", [teamId]);
  const before = Number((await ev.n.one("select cash_cents from teams where id = $1", [teamId])).cash_cents);
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  const after = Number((await ev.n.one("select cash_cents from teams where id = $1", [teamId])).cash_cents);
  const edge = Number((await ev.n.one("select edge_cents from practice_accounts where team_id = $1", [teamId])).edge_cents);
  expect(edge).toBeGreaterThan(0);
  expect(after - before).toBe(edge);
  await page.goto("/team/trade/practice");
  await expect(page.getByTestId("practice-result")).toContainText("was added to your real cash");
  await expect(page.getByTestId("practice-leaderboard")).toContainText(fund);
});

test("the organiser's track pages: practice standings and edges under Finance, the companies under Product", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}`);
  for (const tab of ["Schedule", "Product", "Consulting", "Finance"]) await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: tab, exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("region", { name: "Practice standings" })).toContainText(fund);
  await expect(page.getByTestId(`fund-${fund}`)).toContainText("+$");
  await page.goto(`/admin/${ev.slug}/product`);
  await expect(page.getByRole("region", { name: "Companies" }).getByRole("row")).toHaveCount(1 + ev.plan.teams.filter((t) => t.track === "PRODUCT").length);
  await page.goto(`/admin/${ev.slug}/consulting`);
  await expect(page.getByRole("region", { name: "Firms" }).getByRole("row")).toHaveCount(1 + ev.plan.teams.filter((t) => t.track === "CONSULTING").length);
  await page.goto(`/admin/${ev.slug}/schedule`);
  await expect(page.getByRole("heading", { name: "Deadlines" })).toBeVisible();
});

test("the live wall: the market from Reading, the clock and the phase on top", async ({ page }) => {
  // The draw's full-screen moment is over.
  await ev.n.q("update events set drawn_at = drawn_at - interval '1 hour' where id = $1", [ev.n.eventId]);
  await loginAsStaff(page, ev, STAFF.display);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/display/${ev.slug}/live`);
  await expect(page.getByTestId("live-wall")).toBeVisible();
  await expect(page.getByTestId("display-phase")).toBeVisible();
  await expect(page.getByTestId("live-prices")).toBeVisible();
});
