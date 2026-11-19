import { expect, test } from "@playwright/test";
import { STAFF, seedE2eEvent } from "./support/event";
import { loginAsStaff, loginAsTeam } from "./support/login";

test("finance data settings are only available to organisers", async ({ browser, baseURL, page }) => {
  test.setTimeout(120_000);
  const event = await seedE2eEvent({ slug: "e2e-finance-settings", prefix: "D" });
  const finance = `/admin/${event.slug}/finance`;
  const settings = `${finance}/data-settings`;

  await page.goto(settings);
  await expect(page).toHaveURL(/\/login\?next=/);
  await loginAsStaff(page, event, STAFF.lead);
  await page.goto(finance);
  await page.getByRole("link", { name: "Data settings" }).click();
  await expect(page.getByRole("heading", { name: "Finance data settings" })).toBeVisible();
  await expect(page.getByLabel("Authorization Header")).toHaveValue("");

  const fairness = await browser.newContext({ baseURL });
  try {
    const viewer = await fairness.newPage();
    await loginAsStaff(viewer, event, STAFF.fairness);
    await viewer.goto(finance);
    await expect(viewer.getByRole("link", { name: "Data settings" })).toHaveCount(0);
    await viewer.goto(settings);
    await expect(viewer).toHaveURL(/\/admin\/?$/);
  } finally {
    await fairness.close();
  }

  const team = await browser.newContext({ baseURL });
  try {
    const participant = await team.newPage();
    await loginAsTeam(participant, event, "DF01");
    await participant.goto(settings);
    await expect(participant).toHaveURL(/\/team(?:\/|$)/);
    await participant.goto("/demo/finance/markets");
    await expect(participant.getByRole("link", { name: "Data settings" })).toHaveCount(0);
    expect((await participant.goto("/demo/finance/api-config"))?.status()).toBe(404);
  } finally {
    await team.close();
  }
});
