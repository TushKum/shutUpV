import { expect, test } from "@playwright/test";
import { seedE2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsTeam } from "./support/login";

test("Finance orders move the read-only Market chart for Product and Consulting", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const event = await seedE2eEvent({ slug: "e2e-market-charts", prefix: "Y" });
  const squads = await trading(event);
  const companyId = squads[0]!.company_id;
  await event.n.openRound(1);

  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  try {
    const [product, consulting] = await Promise.all(contexts.map((context) => context.newPage()));
    const spectators = [product!, consulting!];
    await Promise.all(spectators.map(async (page, index) => {
      await loginAsTeam(page, event, index === 0 ? squads[0]!.p_code : squads[0]!.c_code);
      await page.goto("/team/market");
      await page.getByLabel("Company chart").selectOption(companyId);
      await expect(page.getByTestId("indicative-price")).toContainText("$10.50");
      await expect(page.getByText(/Order ticket/i)).toHaveCount(0);
    }));

    await event.n.ok(event.n.team(squads[1]!.f_code), "place_order", companyId, "BUY", 2_000);
    await Promise.all(spectators.map(async (page) => {
      await expect(page.getByTestId("indicative-price")).toContainText("$10.71");
      await expect(page.getByTestId("trade-chart").getByRole("img")).toHaveAttribute("aria-label", /last \$10\.71/);
    }));

    await event.n.clearRound(1);
    await Promise.all(spectators.map(async (page) => {
      await expect(page.getByTestId("indicative-price")).toHaveCount(0);
      await expect(page.getByTestId("trade-chart").getByRole("img")).toHaveAttribute("aria-label", /last \$10\.71/);
    }));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("a Finance paper fill updates both preview charts in the same browser", async ({ context }) => {
  const product = await context.newPage();
  const consulting = await context.newPage();
  const finance = await context.newPage();
  const spectators = [product, consulting];

  await Promise.all(spectators.map(async (page, index) => {
    await page.addInitScript((track) => sessionStorage.setItem("primus-track-v2", track), index === 0 ? "PRODUCT" : "CONSULTING");
    await page.goto("/demo/trade/event");
    await expect(page.getByText("Paper trading is available in the Finance track.")).toBeVisible();
    await page.getByRole("link", { name: "View market charts" }).click();
    await page.getByLabel("Chart instrument").selectOption("NVDA-P");
    await expect(page.getByTestId("market-candles").getByRole("img")).toHaveAttribute("aria-label", /^NVDA-P/);
    await expect(page.getByRole("button", { name: /buy|sell|new order/i })).toHaveCount(0);
  }));

  await finance.addInitScript(() => sessionStorage.setItem("primus-track-v2", "FINANCE"));
  await finance.goto("/demo/trade/event");
  await finance.getByRole("button", { name: "Pause prices" }).click();
  await finance.getByLabel("Quantity", { exact: true }).fill("1");
  const chart = (page: typeof product) => page.getByTestId("market-candles").getByRole("img");
  const before = await chart(product).getAttribute("aria-label");
  await finance.getByRole("button", { name: "Submit BUY NVDA-P" }).click();
  await expect(finance.getByText("BUY 1 NVDA-P filled.")).toBeVisible();
  await expect(chart(product)).not.toHaveAttribute("aria-label", before!);
  const after = await chart(product).getAttribute("aria-label");
  await expect(chart(consulting)).toHaveAttribute("aria-label", after!);
});
