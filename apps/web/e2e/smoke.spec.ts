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

test("the QR code on a login card fills in the team code; the password may be typed loosely", async ({ page }) => {
  const ev = await seedE2eEvent({ slug: "e2e-smoke", prefix: "A" });
  const code = ev.plan.teams[0]!.code;
  await page.goto(`/login?code=${code.toLowerCase()}`);
  await expect(page.getByLabel("Team code")).toHaveValue(code);
  await expect(page.getByLabel("Password")).toBeFocused();
  // Lower case, spaces instead of dashes: still accepted.
  await page.keyboard.type(ev.password(code).toLowerCase().replaceAll("-", " "));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/team/);
});

test("/api/health reports the database and that it has every migration this build needs", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ app: "ok", database: "ok", schema: "ok" });
});
