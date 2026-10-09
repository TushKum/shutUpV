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

test("an open console: overdue is noticed live, a double-click is one click, and the console runs the clock", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  // The organiser console calls tick() every second as a backup to pg_cron.
  const tick = page.waitForRequest((r) => r.url().includes("/rest/v1/rpc/tick"));
  await page.goto(`/admin/${ev.slug}`);
  await tick;
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();

  // Rendered before the planned end, still open after it: turning auto-advance on now asks first.
  await ev.n.q("update events set auto_advance = false where id = $1", [ev.n.eventId]);
  await ev.n.q("update phases set starts_at = now() - interval '1 minute', ends_at = now() + interval '4 seconds' where event_id = $1 and code = 'SQUAD_DRAW'", [ev.n.eventId]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Turn auto-advance on" })).not.toHaveAttribute("title");
  await expect(page.getByRole("button", { name: "Turn auto-advance on" })).toHaveAttribute("title", /planned end has passed/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Turn auto-advance on" }).click();
  await expect(page.getByRole("button", { name: /^Click again: this advances to .+ now$/ })).toBeVisible();
  expect((await ev.n.one("select auto_advance from events where id = $1", [ev.n.eventId])).auto_advance).toBe(false);
  // And a one-click request that slips through is refused by the database.
  expect(await ev.n.call(ev.n.lead, "set_auto_advance", ev.n.eventId, true)).toMatchObject({ ok: false, code: "OVERDUE" });
  await ev.n.q("update phases set ends_at = now() + interval '1 hour' where event_id = $1 and code = 'SQUAD_DRAW'", [ev.n.eventId]);

  // A double-click on a two-click button is one click: it arms, it does not pause.
  await page.reload();
  await page.getByRole("button", { name: "Pause" }).dblclick();
  await expect(page.getByRole("button", { name: "Click again to pause the event" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect((await ev.n.one("select paused from events where id = $1", [ev.n.eventId])).paused).toBe(false);
});

test("the Rounds page explains a waiting round as soon as its time comes", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await ev.n.q(
    "update rounds set opens_at = now() + interval '4 seconds', closes_at = now() + interval '1 hour' where event_id = $1 and number = 1",
    [ev.n.eventId],
  );
  await page.goto(`/admin/${ev.slug}/rounds`);
  await expect(page.getByText("Next: round 1")).toBeVisible();
  await expect(page.getByText(/^Round 1 opens when the event advances to Rounds 1–4\./)).toBeVisible({ timeout: 15_000 });
});

test("in Appeals, the Phase page follows the fairness officer's decisions without a reload", async ({ page }) => {
  const [a, b] = ev.plan.teams.filter((t) => t.track === "FINANCE").map((t) => ev.n.teamId(t.code));
  await ev.n.q("update events set current_phase = 'APPEALS' where id = $1", [ev.n.eventId]); // test-only jump
  const flag = await ev.n.one("insert into flags (event_id, kind, team_ids, details) values ($1, 2, $2, '{}'::jsonb) returning id", [ev.n.eventId, [a, b]]);
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(page.getByText("Waiting: Collusion flags are still open for the fairness officer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Advance to Awards" })).toBeDisabled();
  await ev.n.ok(ev.n.fairness, "decide_flag", flag.id, "CLEARED", "No collusion found.");
  await expect(page.getByRole("button", { name: "Advance to Awards" })).toBeEnabled();
  await expect(page.getByText("Waiting:")).toHaveCount(0);
});

test("the fairness officer follows the phase but has no phase controls", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}`);
  await expect(page.getByText("only organisers change the phase")).toBeVisible();
  await expect(page.getByRole("button", { name: /Advance to/ })).toHaveCount(0);
});
