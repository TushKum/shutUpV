import { expect, test, type Page } from "@playwright/test";
import { seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsTeam } from "./support/login";

// Results that used to vanish: an action whose control disappears right after it (the round closed while the order was
// on its way), and a retried order whose first copy was cancelled meanwhile. Also the header once a phase's planned end
// has passed.

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  ev = await seedE2eEvent({ slug: "e2e-team-feedback", prefix: "Z" });
  s = await trading(ev);
  await ev.n.openRound(1);
});

const ticket = (page: Page) => page.getByRole("form", { name: "Order ticket" });
async function asFund(page: Page) {
  await page.context().clearCookies();
  await loginAsTeam(page, ev, s[0]!.f_code);
  await page.goto("/team/trade");
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
}
async function fill(page: Page, qty: string) {
  const t = ticket(page);
  await t.getByLabel("Company").selectOption(s[1]!.company_id as string);
  await t.getByText("BUY", { exact: true }).click();
  await t.getByLabel("Quantity (shares)").fill(qty);
}

test("an order that reaches the exchange after the close is refused, and the refusal stays on screen", async ({ page }) => {
  await asFund(page);
  await fill(page, "100");
  // The round closes 4 s from now; the order is held on its way for 6 s (a slow phone in the last second of a round).
  await ev.n.q("update rounds set closes_at = now() + interval '4 seconds' where event_id = $1 and number = 1", [ev.n.eventId]);
  await page.route("**/team/trade", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await ticket(page).getByRole("button", { name: /^Place BUY 100 / }).click();
  await expect(page.getByTestId("feedback-bar").getByRole("alert")).toContainText("TRADING_HALTED", { timeout: 20_000 });
  await page.unroute("**/team/trade");
  expect((await ev.n.q("select 1 from orders where team_id = $1", [ev.n.teamId(s[0]!.f_code)])).length).toBe(0);
  // Round 1 clears; round 2 is opened for the next test.
  await ev.n.roundReaches(1, "CLEARED");
  await ev.n.openRound(2);
});

test("a retried order whose first copy was cancelled meanwhile says so instead of 'Already placed'", async ({ page }) => {
  await asFund(page);
  await fill(page, "100");
  // The exchange takes the order but the answer is lost on the way back.
  let dropped = false;
  await page.route("**/team/trade", async (route) => {
    if (!dropped && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await ticket(page).getByRole("button", { name: /^Place BUY 100 / }).click();
  await expect(ticket(page).getByRole("alert")).toContainText("NOT_SENT");
  await page.unroute("**/team/trade");
  const placed = await ev.n.one("select id from orders where team_id = $1 and status = 'PENDING'", [ev.n.teamId(s[0]!.f_code)]);
  await ev.n.ok(ev.n.team(s[0]!.f_code), "cancel_order", placed.id); // cancelled on another device
  await ticket(page).getByRole("button", { name: /^Place BUY 100 / }).click();
  await expect(ticket(page).getByRole("alert")).toContainText("ORDER_CHANGED: That order (BUY 100");
  await expect(ticket(page).getByRole("alert")).toContainText("has since been cancelled; nothing new was placed");
  // The next press is a new order.
  await ticket(page).getByRole("button", { name: /^Place BUY 100 / }).click();
  await expect(ticket(page).getByRole("status")).toContainText("Order placed: BUY 100");
  expect((await ev.n.q("select status from orders where team_id = $1 order by created_at", [ev.n.teamId(s[0]!.f_code)])).map((o) => o.status)).toEqual([
    "CANCELLED",
    "PENDING",
  ]);
});

test("a change or a cancellation is confirmed although the row it was made in is redrawn or removed", async ({ page }) => {
  await asFund(page);
  const row = page.getByTestId("open-order").filter({ hasText: "BUY 100" });
  await row.getByLabel(/^New quantity for BUY 100/).fill("150");
  await row.getByRole("button", { name: "Change quantity" }).click();
  await expect(page.getByText("Order changed to 150 shares.")).toBeVisible();
  await page.getByTestId("open-order").filter({ hasText: "BUY 150" }).getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByText("Order cancelled.")).toBeVisible();
  await expect(page.getByTestId("open-order")).toHaveCount(0);
});

test("after a phase's planned end the header says what comes next, not 'ends in now'", async ({ page }) => {
  await ev.n.q("update phases set starts_at = now() - interval '2 hours', ends_at = now() + interval '12 seconds' where event_id = $1 and code = 'ROUNDS_1_4'", [ev.n.eventId]);
  await asFund(page);
  await expect(page.getByTestId("team-phase")).toContainText("ends in");
  await expect(page.getByTestId("team-phase")).toContainText("Crisis next", { timeout: 25_000 });
  await expect(page.getByTestId("team-phase")).not.toContainText("ends in now");
});
