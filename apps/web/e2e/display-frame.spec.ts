import { expect, test, type Page } from "@playwright/test";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's frame: the display account's way in, the header (phase, round, trading badge, clock), the
// bulletin banner, live updates over the event channel, and a takeover that starts on a broadcast and gives way to
// the board when it runs out (also after a reload in the middle of it).

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 720 } });

let ev: E2eEvent;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: "e2e-display-frame", prefix: "S" });
});

async function screen(page: Page) {
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.display);
  await page.goto(`/display/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
}

test("the display account signs in, picks the event, and sees the frame scaled to the window", async ({ page }) => {
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.display);
  await expect(page).toHaveURL(/\/display/);
  // Several events exist on the test stack, so the operator picks one.
  await page.getByRole("link", { name: new RegExp(`E2E ${ev.slug}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/display/${ev.slug}$`));
  await expect(page.getByTestId("display-phase")).toHaveText("Setup");
  await expect(page.getByTestId("display-trading")).toHaveText("HALTED");
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  // 1920×1080 scaled to a 1280×720 window.
  const box = await page.getByTestId("stage").boundingBox();
  expect(Math.round(box!.width)).toBe(1280);
  expect(Math.round(box!.height)).toBe(720);
});

test("a published bulletin appears in the banner without a reload", async ({ page }) => {
  await screen(page);
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Dinner is served in hall B", "Until 22:00.");
  await expect(page.getByTestId("display-bulletin")).toContainText("Dinner is served in hall B", { timeout: 5000 });
  await expect(page.getByTestId("display-bulletin")).toContainText("GENERAL");
});

test("a pause shows PAUSED and the pause banner; resuming clears them", async ({ page }) => {
  await screen(page);
  await ev.n.org("pause_event", ev.n.eventId);
  await expect(page.getByTestId("display-trading")).toHaveText("PAUSED", { timeout: 5000 });
  await expect(page.getByTestId("display-paused")).toBeVisible();
  await ev.n.org("resume_event", ev.n.eventId);
  await expect(page.getByTestId("display-trading")).toHaveText("HALTED", { timeout: 5000 });
  await expect(page.getByTestId("display-paused")).toHaveCount(0);
});

test("the draw takes over the screen live; after a reload it shows the rest, then the board", async ({ page }) => {
  await screen(page);
  await expect(page.getByTestId("board")).toBeVisible();
  await drawn(ev);
  await expect(page.getByTestId("takeover")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "Squad draw" })).toBeVisible();
  await expect(page.getByTestId("board")).toHaveCount(0);

  // As if the draw had happened 176 s ago: a reload shows the last few seconds of it, then the board.
  await ev.n.q("update events set drawn_at = now() - interval '176 seconds' where id = $1", [ev.n.eventId]);
  await page.reload();
  await expect(page.getByTestId("takeover")).toBeVisible();
  await expect(page.getByTestId("board")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("takeover")).toHaveCount(0);
  await expect(page.getByTestId("display-phase")).toHaveText("Squad draw");
});

test("no team name is ever on the screen before the awards", async ({ page }) => {
  await screen(page);
  const text = await page.getByTestId("stage").innerText();
  for (const t of ev.plan.teams) expect(text, t.code).not.toContain(t.name);
});
