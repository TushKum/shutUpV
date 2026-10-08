import { expect, test, type Page } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { pitchesReleased } from "./support/game";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

// Ten squads, so nine funds can oversubscribe one company's IPO (9 × 4,000 = 36,000 > 35,000).
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof pitchesReleased>>;
test.beforeAll(async () => {
  test.setTimeout(180_000);
  ev = await seedE2eEvent({ slug: "e2e-rounds", prefix: "H", squads: 10 });
  s = await pitchesReleased(ev); // every IPO price $10.50
  await ev.n.advanceTo("IPO");
});

const panel = (page: Page, title: string | RegExp) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const ticker = (i: number) => `EH${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}`;

test("during the IPO: the book per company against 35,000 shares, with the engine's allocation preview", async ({ page }) => {
  // Funds of squads 2–10 each ask for 4,000 of squad 1's company: 36,000 requested, so 3,880 each (pro rata, down to 10).
  for (const x of s.slice(1)) await ev.n.ok(ev.n.team(x.f_code), "place_ipo_bid", s[0]!.company_id, 4000);
  await ev.n.ok(ev.n.team(s[0]!.f_code), "place_ipo_bid", s[1]!.company_id, 1000);

  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/rounds`);
  const ipo = panel(page, "IPO book");
  await expect(ipo.getByRole("row", { name: new RegExp(`^${ticker(0)}`) }).getByRole("cell")).toHaveText([
    ticker(0),
    "$10.50",
    "9",
    "36,000",
    "103% (oversubscribed)",
    "34,920",
    "80",
  ]);
  await expect(ipo.getByRole("row", { name: new RegExp(`^${ticker(1)}`) }).getByRole("cell")).toHaveText([ticker(1), "$10.50", "1", "1,000", "3%", "1,000", "34,000"]);
  await ipo.getByText(`${ticker(0)} bids · 9 · 36,000 requested`).click();
  await expect(ipo.getByRole("row", { name: new RegExp(`^${s[1]!.f_code}`) }).getByRole("cell")).toHaveText([s[1]!.f_code, "4,000", "3,880"]);

  // A bid placed while the page is open shows up without reloading (bids send no realtime message; the page polls).
  await ev.n.ok(ev.n.team(s[0]!.f_code), "place_ipo_bid", s[2]!.company_id, 500);
  await expect(ipo.getByRole("row", { name: new RegExp(`^${ticker(2)}`) }).getByRole("cell").nth(3)).toHaveText("500");

  // The real allocation (run when the phase advances) gives exactly the previewed numbers.
  await ev.n.advanceTo("ROUNDS_1_4");
  const alloc = await ev.n.q("select qty_allocated from ipo_bids where company_id = $1", [s[0]!.company_id]);
  expect(alloc.map((r) => r.qty_allocated)).toEqual(Array(9).fill(3880));
});

test("the open round: pending orders, a clearing preview that matches the real clearing, and close now", async ({ page }) => {
  await ev.n.openRound(1);
  const [a, b] = [s[0]!.company_id, s[1]!.company_id];
  const f1 = s[0]!.f_code; // holds 1,000 of B from the IPO
  const f2 = s[1]!.f_code; // holds 3,880 of A
  const f3 = s[2]!.f_code; // holds 3,880 of A
  await ev.n.ok(ev.n.team(f1), "place_order", b, "BUY", 2000);
  await ev.n.ok(ev.n.team(f3), "place_order", b, "BUY", 1500);
  await ev.n.ok(ev.n.team(f2), "place_order", a, "SELL", 500);

  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/rounds`);
  const head = panel(page, "Round 1");
  await expect(head.getByText("Open", { exact: true })).toBeVisible();
  await expect(head.getByText("Closes in")).toBeVisible();

  // An order placed while the page is open appears without a reload.
  await ev.n.ok(ev.n.team(f3), "place_order", a, "SHORT", 300);
  const pending = panel(page, "Pending orders · round 1");
  await expect(pending.getByRole("row", { name: new RegExp(`^${ticker(0)}`) }).getByRole("cell")).toHaveText([
    ticker(0),
    "0",
    "500",
    "300",
    "0",
    "−800",
    "−800",
    "$10.50",
  ]);
  await expect(pending.getByRole("row", { name: new RegExp(`^${ticker(1)}`) }).getByRole("cell")).toHaveText([
    ticker(1),
    "3,500",
    "0",
    "0",
    "0",
    "+3,500",
    "+3,500",
    "$10.50",
  ]);
  const orders = pending.getByRole("table").nth(1);
  await expect(orders.getByRole("row")).toHaveCount(5);
  await expect(orders.getByRole("row").nth(1).getByRole("cell").nth(0)).toHaveText(f1);
  await expect(orders.getByRole("row").nth(1).getByRole("cell").nth(4)).toHaveText("$23,100.00"); // 2,000 × $10.50 × 1.10
  await expect(head.getByText("3 funds · 2 companies")).toBeVisible();

  // Preview: A $10.50 × (100,000 − 800) / 100,000 = $10.416 → $10.42; B × 1.035 = $10.8675 → $10.87.
  const preview = panel(page, "Clearing preview · round 1");
  await expect(preview.getByRole("row", { name: new RegExp(`^${ticker(0)}`) }).getByRole("cell")).toHaveText([ticker(0), "$10.50", "$10.42", "−$0.08", "−800", "−800"]);
  await expect(preview.getByRole("row", { name: new RegExp(`^${ticker(1)}`) }).getByRole("cell")).toHaveText([ticker(1), "$10.50", "$10.87", "+$0.37", "+3,500", "+3,500"]);
  await expect(preview.getByText("8 other companies have no orders and keep their prices.")).toBeVisible();
  const fundRow = (code: string) => preview.getByRole("row", { name: new RegExp(`^${code}`) }).getByRole("cell");
  await expect(fundRow(f1).nth(4)).toHaveText("−$21,740.00"); // 2,000 × $10.87
  await expect(fundRow(f2).nth(4)).toHaveText("+$5,210.00"); // 500 × $10.42
  await expect(fundRow(f3).nth(4)).toHaveText("−$13,179.00"); // −1,500 × $10.87 + 300 × $10.42
  await expect(fundRow(f3).nth(6)).toHaveText("$4,689.00"); // collateral 150% × 300 × $10.42
  const cashBefore = await ev.n.q("select code, cash_cents from teams where code = any($1)", [[f1, f2, f3]]);

  await page.getByRole("button", { name: "Close round 1 now" }).click();
  await page.getByRole("button", { name: "Click again to close round 1 now" }).click();
  await expect(page.getByRole("status")).toHaveText("Round 1 cleared: 4 orders filled.");

  // The database's clearing did exactly what the preview showed.
  expect((await ev.n.one("select status from rounds where event_id = $1 and number = 1", [ev.n.eventId])).status).toBe("CLEARED");
  expect((await ev.n.companyByTicker(ticker(0))).market_price).toBe(1042);
  expect((await ev.n.companyByTicker(ticker(1))).market_price).toBe(1087);
  const cashAfter = new Map((await ev.n.q("select code, cash_cents from teams where code = any($1)", [[f1, f2, f3]])).map((r) => [r.code, BigInt(r.cash_cents)]));
  const delta = Object.fromEntries(cashBefore.map((r) => [r.code, Number(cashAfter.get(r.code)! - BigInt(r.cash_cents))]));
  expect(delta).toEqual({ [f1]: -2_174_000, [f2]: 521_000, [f3]: -1_317_900 });

  // The history shows the cleared round; the next round is announced and the button can no longer close anything.
  const history = panel(page, "Cleared rounds");
  await expect(history.getByText(/^Round 1 · cleared \d\d:\d\d:\d\d · 2 companies traded$/)).toBeVisible();
  await expect(history.getByRole("row", { name: new RegExp(`^${ticker(0)}`) }).getByRole("cell")).toHaveText([ticker(0), "$10.50 → $10.42", "−$0.08", "−800", "−800"]);
  await expect(history.getByRole("row", { name: new RegExp(`^${ticker(2)}`) }).getByRole("cell")).toHaveText([ticker(2), "$10.50 → $10.50", "$0.00", "0", "0"]);
  await expect(panel(page, "Next: round 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close round now" })).toBeDisabled();
});

test("close now refuses when the round on screen is no longer the open one", async ({ page }) => {
  await ev.n.openRound(2);
  // The page's realtime messages can be held back, so it keeps showing round 2 while the night moves on.
  let frozen = false;
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (!frozen) ws.send(m);
    });
  });
  await loginAsStaff(page, ev, STAFF.second);
  await page.goto(`/admin/${ev.slug}/rounds`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close round 2 now" })).toBeVisible();
  // Round 2 clears and round 3 opens behind the page's back (no realtime message, no polling: the tab looks hidden).
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
  frozen = true;
  await ev.n.clearRound(2);
  await ev.n.openRound(3);
  await page.getByRole("button", { name: "Close round 2 now" }).click();
  await page.getByRole("button", { name: "Click again to close round 2 now" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ROUND_CHANGED" })).toHaveText(/ROUND_CHANGED: Round 2 is no longer open \(round 3 is\); nothing was closed/);
  expect((await ev.n.one("select status from rounds where event_id = $1 and number = 3", [ev.n.eventId])).status).toBe("OPEN");
});

test("the fairness officer follows the rounds but cannot close one", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/rounds`);
  await expect(panel(page, "Round 3")).toBeVisible();
  await expect(page.getByText("Only organisers close a round early.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Close round/ })).toHaveCount(0);
  await expect(panel(page, "Clearing preview · round 3")).toBeVisible();
  await expect(panel(page, "Cleared rounds").getByText(/^Round 2 · cleared/)).toBeVisible();
});
