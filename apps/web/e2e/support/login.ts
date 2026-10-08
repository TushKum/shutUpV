// Signs in through the real login page.

import { expect, type Page } from "@playwright/test";
import type { E2eEvent } from "./event";

export async function loginAsStaff(page: Page, ev: E2eEvent, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Organiser" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(ev.password(email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function loginAsTeam(page: Page, ev: E2eEvent, code: string) {
  await page.goto("/login");
  await page.getByLabel("Team code").fill(code);
  await page.getByLabel("Password").fill(ev.password(code));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/team/);
}
