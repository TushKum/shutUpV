// The night's main screens in a browser, on the local stack: a team writes its PRD (it saves by itself), sees its
// score and starting price after the reveal; the projector counts down before 23:30 and shows the price board after;
// the leaderboard is live. Each test seeds its own small event.

import { expect, test } from "@playwright/test";
import { STAFF, seedE2eEvent } from "./support/event";
import { building, pricesRevealed } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

test("a team writes its PRD: it saves by itself, and the ticker is claimed", async ({ page }) => {
  const ev = await seedE2eEvent({ slug: "e2e-prd", prefix: "B" });
  await building(ev);
  const code = ev.plan.teams[0]!.code;
  await loginAsTeam(page, ev, code);
  await expect(page.getByTestId("action-bar")).toContainText("Write your PRD");
  await page.goto("/team/build");
  await page.getByLabel("Company name").fill("Masala Labs Bites");
  await page.getByLabel("Ticker").fill("MLBT");
  await page.getByLabel("Problem").fill("Snacks go stale within two days of opening in humid coastal towns.");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 20_000 });
  expect(await ev.n.draftVersion(code, "PRD")).toBeGreaterThan(0);
  expect((await ev.n.company(code)).ticker).toBe("MLBT");
});

test("after the 23:30 reveal: the team's score and starting price; the projector's board; the live leaderboard", async ({ page, browser }) => {
  const ev = await seedE2eEvent({ slug: "e2e-reveal", prefix: "C" });
  await pricesRevealed(ev);
  const code = ev.plan.teams[0]!.code;
  await loginAsTeam(page, ev, code);
  await page.goto("/team/build");
  await expect(page.getByText("$11.20").first()).toBeVisible();
  await page.goto("/team/leaderboard");
  await expect(page.getByTestId("my-row")).toContainText(code);

  const screen = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await loginAsStaff(screen, ev, STAFF.display);
  await screen.goto(`/display/${ev.slug}`);
  await expect(screen.getByTestId("takeover")).toContainText("PRD scores");
  await expect(screen.getByTestId("prices-top")).toBeVisible();
});

test("before the reveal the projector counts down to the next moment of the evening", async ({ page }) => {
  const ev = await seedE2eEvent({ slug: "e2e-evening", prefix: "D" });
  await building(ev);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsStaff(page, ev, STAFF.display);
  await page.goto(`/display/${ev.slug}`);
  await expect(page.getByTestId("evening-schedule")).toContainText("PRD form locks");
  await expect(page.getByTestId("evening-countdown")).toBeVisible();
});
