import { expect, test } from "@playwright/test";
import { STAFF, seedE2eEvent } from "./support/event";
import { loginAsStaff, loginAsTeam } from "./support/login";

test("organisers land on the control panel; a team cannot open it", async ({ page }) => {
  const ev = await seedE2eEvent({ slug: "e2e-smoke", prefix: "A" });
  await loginAsStaff(page, ev, STAFF.lead);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Control panel" })).toBeVisible();

  await page.context().clearCookies();
  await loginAsTeam(page, ev, ev.plan.teams[0]!.code);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/team/);
});
