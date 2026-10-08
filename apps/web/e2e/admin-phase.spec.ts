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
  await page.getByRole("button", { name: "Click again to resume the event" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  const before = (await ev.n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [ev.n.eventId])).at as Date;
  await page.getByLabel("Minutes (1–120)").fill("7");
  await page.getByRole("button", { name: "Extend", exact: true }).click();
  await page.getByRole("button", { name: "Click again to extend by 7 min" }).click();
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

test("a two-click button never acts on a target that changed between the clicks", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();

  // Armed for "start Squad draw"; another organiser advances first. The button now names the next phase and is not
  // armed: one more click only asks again, it never skips a phase.
  await page.getByRole("button", { name: "Advance to Squad draw" }).click();
  await expect(page.getByRole("button", { name: "Click again to start Squad draw" })).toBeVisible();
  await ev.n.org("advance_phase", ev.n.eventId, "BRIEFING");
  await expect(page.getByRole("button", { name: /^Advance to / })).not.toHaveText("Advance to Squad draw");
  await expect(page.getByRole("button", { name: /^Click again/ })).toHaveCount(0);
  expect(await ev.n.phase()).toBe("SQUAD_DRAW");

  // Armed for "pause"; another organiser pauses. The click that would have confirmed the pause only arms Resume.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Click again to pause the event" })).toBeVisible();
  await ev.n.org("pause_event", ev.n.eventId);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: "Click again to resume the event" })).toBeVisible();
  expect((await ev.n.one("select paused from events where id = $1", [ev.n.eventId])).paused).toBe(true);
  await page.getByRole("button", { name: "Click again to resume the event" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  // Turning auto-advance on when the planned end has passed advances at once, so it asks first.
  await ev.n.q("update phases set starts_at = now() - interval '2 minutes', ends_at = now() - interval '1 minute' where event_id = $1 and code = 'SQUAD_DRAW'", [ev.n.eventId]);
  await page.reload();
  await page.getByRole("button", { name: "Turn auto-advance on" }).click();
  await expect(page.getByRole("button", { name: /^Click again: this advances to .+ now$/ })).toBeVisible();
  expect(await ev.n.phase()).toBe("SQUAD_DRAW");
  await ev.n.q("update phases set ends_at = now() + interval '1 hour' where event_id = $1 and code = 'SQUAD_DRAW'", [ev.n.eventId]);
});

test("the fairness officer follows the phase but has no phase controls", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.getByText("only organisers change the phase")).toBeVisible();
  await expect(page.getByRole("button", { name: /Advance to/ })).toHaveCount(0);
});
