import { expect, test, type Browser, type Page } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The rescue: the crisis, the advisor's fee (Product and Consulting propose and confirm; the default at the deadline)
// and the rescue deal (Consulting's price, the fund's amount, three signatures), through the three teams' screens (the
// Consulting team on a phone). The state is moved with the real game functions.
//
// Both rescue specs (this one and team-calls) use the team-code prefix O, and team codes are unique across events:
// the two files take turns (an advisory lock held for the whole file), and each purges the other's event first.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
let turn: pg.PoolClient | undefined;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  turn = await e2ePool().connect();
  await turn.query("select pg_advisory_lock(hashtext('e2e:team-code-prefix:O'))");
  await e2ePool().query("select public.purge_event($1)", ["e2e-team-calls"]);
  ev = await seedE2eEvent({ slug: "e2e-team-rescue", prefix: "O" });
  s = await trading(ev);
});

test.afterAll(async () => {
  await turn?.query("select pg_advisory_unlock_all()");
  turn?.release();
});

/** Another team's screen (or the same team on another device). */
async function screen(browser: Browser, code: string, width = 1280): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await loginAsTeam(page, ev, code);
  return page;
}

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

/** A two-click button: the first click asks, the second (after the double-click guard) confirms. */
async function twoClicks(page: Page, name: string | RegExp, confirm: string | RegExp) {
  await page.getByRole("button", { name }).click();
  const again = page.getByRole("button", { name: confirm });
  await expect(again).toBeVisible();
  await page.waitForTimeout(600);
  await again.click();
}

test("before the crisis, every team of the squad reads what will happen at the crisis", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, s[0]!.c_code);
  await page.goto("/team/rescue");
  await expect(page).toHaveTitle(/Rescue/);
  const before = page.getByTestId("crisis-before");
  await expect(before).toContainText("multiplied by 0.85 (−15%)");
  await expect(before).toContainText("post-crisis price");
  await expect(before.getByRole("listitem")).toHaveCount(3);
  await expect(before).toContainText("Advisor fee");
  await expect(before).toContainText("$5,000 deal bonus");
  await expect(before).toContainText("capped at 50");
  await expect(page.getByTestId("fee")).toHaveAttribute("data-stage", "BEFORE_CRISIS");
  await expect(page.getByTestId("deal")).toHaveAttribute("data-stage", "BEFORE_CRISIS");
  await expect(page.getByRole("form", { name: "Propose a fee" })).toHaveCount(0);
  await noSideScroll(page);
  // The database refuses a fee before the crisis anyway.
  expect(await ev.n.call(ev.n.team(s[0]!.c_code), "propose_fee", 2_000_000, 0)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
});

test("the fee: a live check, a proposal, confirmations reset by a new proposal, then both confirm and it is paid", async ({ page, browser }) => {
  await ev.n.advanceTo("CRISIS");
  const x = s[0]!;
  // The Consulting team, on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, x.c_code);
  await page.goto("/team/rescue");
  await expect(page.getByTestId("crisis-card")).toBeVisible();
  // IPO $10.50 × 0.85 = $8.925 → $8.93.
  await expect(page.getByTestId("crisis-prices")).toContainText("$8.93");
  await expect(page.getByTestId("crisis-prices")).toContainText("$4.47–$8.93");
  const form = page.getByRole("form", { name: "Propose a fee" });
  await form.getByLabel("Cash (US$)").fill("30000");
  await form.getByLabel("Retained shares (at most 3,000)").fill("1000");
  await expect(form.getByTestId("terms-check")).toContainText("The fee must be worth $10,000 to $35,000 (shares at the IPO price).");
  await expect(form.getByTestId("terms-check")).toContainText("Total value: $40,500.00");
  await expect(form.getByRole("button", { name: "Propose these terms" })).toBeDisabled();
  await form.getByLabel("Cash (US$)").fill("20,000");
  await expect(form.getByTestId("terms-check")).toContainText("Total value: $30,500.00 = $20,000.00 cash + 1,000 shares × IPO price $10.50");
  await form.getByRole("button", { name: "Propose these terms" }).click();
  await expect(form.getByRole("status")).toContainText("Proposed $20,000.00 cash + 1,000 shares (value $30,500.00) as version 2.");
  await expect(page.getByTestId("fee-terms")).toHaveText("$20,000.00 cash + 1,000 shares (value $30,500.00)");
  await expect(page.getByTestId("fee-confirm-CONSULTING")).toContainText("Not confirmed");
  // Proposing the same terms again would only reset the confirmations.
  await expect(form.getByRole("button", { name: "Propose these terms" })).toBeDisabled();
  await expect(form).toContainText("These are the terms on the table.");
  await noSideScroll(page);

  // The Product team sees the proposal and confirms it (two clicks).
  const product = await screen(browser, x.p_code);
  await product.goto("/team/rescue");
  await expect(product.getByTestId("fee-proposal")).toContainText("Proposed by the Consulting team");
  await expect(product.getByTestId("fee-terms")).toHaveText("$20,000.00 cash + 1,000 shares (value $30,500.00)");
  const productProposal = product.getByTestId("fee-proposal");
  await twoClicks(product, "Confirm this fee", "Click again to confirm $20,000.00 cash + 1,000 shares (value $30,500.00)");
  await expect(productProposal.getByRole("status")).toHaveText("You confirmed version 2. The fee is paid when the other team confirms the same version.");
  await expect(product.getByTestId("fee-confirm-PRODUCT")).toContainText("Confirmed");
  await expect(productProposal).toContainText("Waiting for the Consulting team to confirm it.");
  await expect(productProposal.getByRole("button", { name: "Confirmed" })).toBeDisabled();

  // A new proposal resets the confirmations.
  await page.reload();
  await expect(page.getByTestId("fee-confirm-PRODUCT")).toContainText("Confirmed");
  await form.getByLabel("Cash (US$)").fill("22000");
  await expect(form.getByTestId("terms-check")).toContainText("Total value: $32,500.00");
  await form.getByRole("button", { name: "Propose these terms" }).click();
  await expect(form.getByRole("status")).toContainText("as version 3");
  await expect(page.getByTestId("fee-confirm-PRODUCT")).toContainText("Not confirmed");
  await product.reload();
  await expect(product.getByTestId("fee-confirm-PRODUCT")).toContainText("Not confirmed");
  await expect(product.getByTestId("fee-terms")).toHaveText("$22,000.00 cash + 1,000 shares (value $32,500.00)");

  // The terms change again while the Product team's page still shows version 3: its confirmation is refused, the
  // refusal stays on screen and the page shows the new version.
  await ev.n.ok(ev.n.team(x.c_code), "propose_fee", 2_200_000, 1000);
  await twoClicks(product, "Confirm this fee", "Click again to confirm $22,000.00 cash + 1,000 shares (value $32,500.00)");
  await expect(productProposal.getByRole("alert")).toHaveText(
    "VERSION_CONFLICT: Not confirmed: the proposal changed since this page showed it. Review the new terms, then confirm.",
  );
  await expect(productProposal).toContainText("On the table: version 4");
  await expect(product.getByTestId("fee-confirm-PRODUCT")).toContainText("Not confirmed");

  await twoClicks(product, "Confirm this fee", "Click again to confirm $22,000.00 cash + 1,000 shares (value $32,500.00)");
  await expect(productProposal.getByRole("status")).toContainText("You confirmed version 4.");
  await page.reload();
  await twoClicks(page, "Confirm this fee", /Click again to confirm \$22,000\.00/);
  // The second confirmation pays the fee: the page shows what was paid.
  await expect(page.getByTestId("fee")).toHaveAttribute("data-stage", "AGREED");
  await expect(page.getByTestId("fee-outcome")).toContainText("Agreed fee paid at");
  await expect(page.getByTestId("fee-due")).toHaveAttribute("data-state", "CLOSED");
  await expect(page.getByTestId("fee-due")).toContainText("paid");
  await expect(page.getByTestId("fee-outcome")).toContainText("$22,000.00 cash + 1,000 shares (value $32,500.00), from the Product team to the Consulting team.");
  await expect(page.getByRole("form", { name: "Propose a fee" })).toHaveCount(0);
  expect((await ev.n.one("select qty from holdings where team_id = $1 and lot = 'FEE'", [ev.n.teamId(x.c_code)])).qty).toBe(1000);

  // The fund follows it read-only.
  const fund = await screen(browser, x.f_code);
  await fund.goto("/team/rescue");
  await expect(fund.getByTestId("fee-outcome")).toContainText("$22,000.00 cash + 1,000 shares (value $32,500.00)");
  await expect(fund.getByTestId("fee")).toContainText("The fund follows it here; it does not take part.");
  await product.context().close();
  await fund.context().close();
});

test("the fee form closes at the deadline on an open page, and the default $22,500 cash is paid", async ({ page }) => {
  const y = s[1]!;
  await ev.n.q("update deadlines set at = now() + interval '8 seconds' where event_id = $1 and code = 'FEE'", [ev.n.eventId]);
  await loginAsTeam(page, ev, y.p_code);
  await page.goto("/team/rescue");
  const form = page.getByRole("form", { name: "Propose a fee" });
  await form.getByLabel("Cash (US$)").fill("15000");
  await expect(form.getByRole("button", { name: "Propose these terms" })).toBeEnabled();
  await expect(page.getByTestId("fee-due")).toHaveAttribute("data-state", "OPEN");
  // At the deadline the form closes by the server clock; the heartbeat (pg_cron) pays the default.
  await expect(page.getByRole("button", { name: "Propose these terms" })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("fee-due")).toHaveAttribute("data-state", "PASSED");
  await expect(page.getByTestId("fee-outcome")).toContainText("the default fee of $22,500.00 cash was paid", { timeout: 25_000 });
  expect(await ev.n.call(ev.n.team(y.c_code), "propose_fee", 1_500_000, 0)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
});

test("the deal: Consulting's price in the band, the fund's amount, signatures reset by an edit, three signatures execute it", async ({ page, browser }) => {
  const x = s[0]!;
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, x.c_code);
  await page.goto("/team/rescue");
  const deal = page.getByTestId("deal");
  await expect(deal).toHaveAttribute("data-stage", "OPEN");
  await expect(deal).toContainText("($4.47 to $8.93)");
  const priceForm = page.getByRole("form", { name: "Propose the price" });
  await priceForm.getByLabel("Price per share (US$)").fill("4.46");
  await expect(priceForm.getByTestId("terms-check")).toContainText("The price must be 50%–100% of the post-crisis price $8.93: $4.47 to $8.93.");
  await expect(priceForm.getByRole("button", { name: "Propose this price" })).toBeDisabled();
  await priceForm.getByLabel("Price per share (US$)").fill("7.50");
  await expect(priceForm.getByTestId("terms-check")).toContainText("The shares are known once the fund sets the amount.");
  await priceForm.getByRole("button", { name: "Propose this price" }).click();
  await expect(priceForm.getByRole("status")).toContainText("The terms are not complete yet (version 2). Every signature was reset");
  await expect(page.getByTestId("deal-price")).toHaveText("$7.50");
  await expect(page.getByRole("button", { name: /^Sign version/ })).toHaveCount(0);
  await noSideScroll(page);

  // The fund sets the amount and sees the shares and the cash moved.
  const fund = await screen(browser, x.f_code, 390);
  await fund.goto("/team/rescue");
  const amountForm = fund.getByRole("form", { name: "Set the amount" });
  await amountForm.getByLabel("Amount the fund invests (US$)").fill("90000");
  await expect(amountForm.getByTestId("terms-check")).toContainText("The rescue amount must be $40,000 to $80,000.");
  await amountForm.getByLabel("Amount the fund invests (US$)").fill("60000");
  await expect(amountForm.getByTestId("terms-check")).toContainText("8,000 shares at $7.50: cash moved $60,000.00");
  await amountForm.getByRole("button", { name: "Set this amount" }).click();
  await expect(amountForm.getByRole("status")).toContainText("The terms are now 8,000 shares at $7.50 ($60,000.00) (version 3).");
  await expect(fund.getByTestId("deal-shares")).toHaveText("8,000");
  await expect(fund.getByTestId("deal-cash")).toHaveText("$60,000.00");

  // The Product team signs version 3 (two clicks); a new price resets its signature.
  const product = await screen(browser, x.p_code);
  await product.goto("/team/rescue");
  await expect(product.getByRole("form", { name: "Propose the price" })).toHaveCount(0);
  await expect(product.getByRole("form", { name: "Set the amount" })).toHaveCount(0);
  await twoClicks(product, "Sign version 3", "Click again to sign 8,000 shares at $7.50 ($60,000.00)");
  await expect(product.getByTestId("deal-terms").getByRole("status")).toHaveText("You signed version 3. The deal executes when all three teams have signed it.");
  await expect(product.getByTestId("deal-sign-PRODUCT")).toContainText("Signed");
  await expect(product.getByTestId("deal-terms")).toContainText("Waiting for the Consulting team and the fund (Finance).");
  await expect(product.getByRole("button", { name: "Signed version 3" })).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId("deal-sign-PRODUCT")).toContainText("Signed");
  await priceForm.getByLabel("Price per share (US$)").fill("7.00");
  // floor($60,000 ÷ $7.00) = 8,571 shares; 8,571 × $7.00 = $59,997.00.
  await expect(priceForm.getByTestId("terms-check")).toContainText("8,571 shares at $7.00: cash moved $59,997.00");
  await priceForm.getByRole("button", { name: "Propose this price" }).click();
  await expect(priceForm.getByRole("status")).toContainText("The terms are now 8,571 shares at $7.00 ($59,997.00) (version 4).");
  await expect(page.getByTestId("deal-sign-PRODUCT")).toContainText("Not signed");
  await product.reload();
  await expect(product.getByTestId("deal-sign-PRODUCT")).toContainText("Not signed");
  await twoClicks(product, "Sign version 4", "Click again to sign 8,571 shares at $7.00 ($59,997.00)");
  await expect(product.getByTestId("deal-terms").getByRole("status")).toContainText("You signed version 4.");

  // The Consulting team sends its price again while the fund's page still shows version 4: every signature is reset,
  // the fund's signature is refused, the refusal stays on screen and the page shows version 5.
  await fund.reload();
  await expect(fund.getByTestId("deal-sign-PRODUCT")).toContainText("Signed");
  await ev.n.ok(ev.n.team(x.c_code), "edit_deal", null, 700);
  await twoClicks(fund, "Sign version 4", "Click again to sign 8,571 shares at $7.00 ($59,997.00)");
  await expect(fund.getByTestId("deal-terms").getByRole("alert")).toHaveText(
    "VERSION_CONFLICT: Not signed: the terms changed since this page showed them. Review the new terms, then sign.",
  );
  await expect(fund.getByTestId("deal-terms")).toContainText("Terms: version 5");
  await expect(fund.getByTestId("deal-sign-PRODUCT")).toContainText("Not signed");
  await twoClicks(fund, "Sign version 5", "Click again to sign 8,571 shares at $7.00 ($59,997.00)");
  await expect(fund.getByTestId("deal-terms").getByRole("status")).toHaveText("You signed version 5. The deal executes when all three teams have signed it.");
  await noSideScroll(fund);
  await product.reload();
  await twoClicks(product, "Sign version 5", "Click again to sign 8,571 shares at $7.00 ($59,997.00)");
  await expect(product.getByTestId("deal-terms").getByRole("status")).toContainText("You signed version 5.");
  await page.reload();
  await expect(page.getByTestId("deal-sign-PRODUCT")).toContainText("Signed");
  await expect(page.getByTestId("deal-sign-FINANCE")).toContainText("Signed");
  await expect(page.getByTestId("deal-sign-CONSULTING")).toContainText("Not signed");
  await twoClicks(page, "Sign version 5", "Click again to sign 8,571 shares at $7.00 ($59,997.00)");
  // The third signature executes the deal: the page shows what moved.
  await expect(page.getByTestId("deal")).toHaveAttribute("data-stage", "SIGNED");
  await expect(page.getByTestId("deal-outcome")).toContainText(
    "8,571 shares at $7.00 moved from the Product team's retained shares into the fund's squad lot, and $59,997.00 was paid to the company.",
  );
  await expect(page.getByTestId("deal-due")).toContainText("signed");
  await expect(page.getByTestId("deal-bonus")).toHaveAttribute("data-value", "YES");
  await expect(page.getByTestId("deal-bonus")).toContainText("Bonus earned");
  await expect(page.getByTestId("deal-cap")).toContainText("No cap");
  await expect(page.getByRole("form", { name: "Propose the price" })).toHaveCount(0);
  expect((await ev.n.one("select qty, cost_cents from holdings where team_id = $1 and lot = 'SQUAD'", [ev.n.teamId(x.f_code)]))).toEqual({
    qty: 13_571,
    cost_cents: String(5_000_000 + 5_999_700),
  });
  await product.context().close();
  await fund.context().close();
});

test("the consultant's earnings show the fee, the fee shares at the current price and the deal bonus, labelled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, s[0]!.c_code);
  await page.goto("/team/earnings");
  await expect(page).toHaveTitle(/Earnings/);
  const line = (key: string) => page.getByTestId(`earnings-${key}`);
  await expect(line("fee-cash")).toContainText("Agreed fee: cash");
  await expect(line("fee-cash").getByTestId("amount")).toHaveText("$22,000.00");
  await expect(line("fee-cash")).toHaveAttribute("data-status", "FINAL");
  await expect(line("fee-shares")).toContainText("Fee shares: 1,000 × current price");
  await expect(line("fee-shares").getByTestId("amount")).toHaveText("$8,930.00");
  await expect(line("fee-shares")).toHaveAttribute("data-status", "PROJECTION");
  await expect(line("deal-bonus").getByTestId("amount")).toHaveText("$5,000.00");
  await expect(line("plan-bonus")).toHaveAttribute("data-status", "PENDING");
  // Call 1 was judged when round 4 cleared (on the way to the crisis): no calls were made, so both are wrong.
  await expect(page.getByRole("list", { name: "Earnings breakdown" }).getByRole("listitem")).toHaveCount(4 + 6);
  await expect(page.getByTestId("earnings-secured")).toHaveText("$27,000.00");
  await expect(page.getByTestId("earnings-projected")).toHaveText("$35,930.00");
  await noSideScroll(page);
});

test("a deal not fully signed at the deadline: the open page closes, no bonus, the plan is capped", async ({ page }) => {
  const y = s[1]!;
  await ev.n.ok(ev.n.team(y.c_code), "edit_deal", null, 700);
  const d = (await ev.n.ok(ev.n.team(y.f_code), "edit_deal", 5_000_000, null)).deal;
  await ev.n.ok(ev.n.team(y.p_code), "sign_deal", d.version);
  await ev.n.q("update deadlines set at = now() + interval '8 seconds' where event_id = $1 and code in ('DEAL_BONUS', 'DEAL')", [ev.n.eventId]);
  await loginAsTeam(page, ev, y.c_code);
  await page.goto("/team/rescue");
  await expect(page.getByTestId("deal-sign-PRODUCT")).toContainText("Signed");
  await expect(page.getByRole("button", { name: `Sign version ${d.version}` })).toBeEnabled();
  await expect(page.getByTestId("deal-outcome")).toContainText("not fully signed by the deadline", { timeout: 20_000 });
  await expect(page.getByTestId("deal")).toHaveAttribute("data-stage", "CLOSED");
  await expect(page.getByRole("button", { name: /^Sign version/ })).toHaveCount(0);
  await expect(page.getByTestId("deal-cap")).toContainText("Plan capped at 50");
  await expect(page.getByTestId("deal-bonus")).toContainText("No bonus");
  expect(await ev.n.call(ev.n.team(y.c_code), "sign_deal", d.version)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
});

test("a Product or Finance team opening Calls or Earnings is told they are for Consulting", async ({ page }) => {
  await loginAsTeam(page, ev, s[0]!.f_code);
  await page.goto("/team/calls");
  await expect(page.getByRole("main")).toContainText("Consultant calls are made by the Consulting teams.");
  await page.goto("/team/earnings");
  await expect(page.getByRole("main")).toContainText("The earnings breakdown is for the Consulting teams.");
});
