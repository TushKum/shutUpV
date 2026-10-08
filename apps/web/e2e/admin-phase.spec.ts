import { expect, test } from "@playwright/test";
import { sha256Hex } from "@msim/engine";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-phase", prefix: "B" });
});

test("an organiser advances, pauses, extends and toggles auto-advance; the gate is explained", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.getByText("Waiting: Publish the seed commitment before the event starts.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Advance to Check-in" })).toBeDisabled();

  await ev.n.org("set_seed_commitment", ev.n.eventId, sha256Hex(sha256Hex("e2e-phase")));
  await page.reload();
  const advance = page.getByRole("button", { name: "Advance to Check-in" });
  await advance.click();
  await page.getByRole("button", { name: "Click again to start Check-in" }).click();
  await expect(page.getByRole("button", { name: "Advance to Briefing" })).toBeVisible();
  expect(await ev.n.phase()).toBe("CHECKIN");

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Click again to pause the event" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("PAUSED").first()).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  const before = (await ev.n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [ev.n.eventId])).at as Date;
  await page.getByLabel("Minutes (1–120)").fill("7");
  await page.getByRole("button", { name: "Extend", exact: true }).click();
  await expect(page.locator("form").filter({ hasText: "Minutes (1–120)" }).getByRole("status")).toHaveText("Done.");
  const after = (await ev.n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [ev.n.eventId])).at as Date;
  expect((after.getTime() - before.getTime()) / 60_000).toBeCloseTo(7, 3);

  await page.getByRole("button", { name: "Turn auto-advance on" }).click();
  await expect(page.getByRole("button", { name: "Turn auto-advance off" })).toBeVisible();
  await page.getByRole("button", { name: "Turn auto-advance off" }).click();
  await expect(page.getByRole("button", { name: "Turn auto-advance on" })).toBeVisible();
});

test("the console follows the night in realtime: a change made elsewhere appears without reloading", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.second);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Advance to Briefing" })).toBeVisible();
  await ev.n.org("advance_phase", ev.n.eventId, "CHECKIN"); // another organiser, elsewhere
  await expect(page.getByRole("button", { name: "Advance to Squad draw" })).toBeVisible();
});

test("the fairness officer follows the phase but has no phase controls", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.getByText("only organisers change the phase")).toBeVisible();
  await expect(page.getByRole("button", { name: /Advance to/ })).toHaveCount(0);
});
