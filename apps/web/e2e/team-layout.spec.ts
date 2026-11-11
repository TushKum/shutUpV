import { expect, test } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-team-layout", prefix: "Y" });
});

const codeOf = (track: "PRODUCT" | "CONSULTING" | "FINANCE") => ev.plan.teams.find((t) => t.track === track)!.code;

test("every track sees its team, where the night is, its cash, and before the game only Home, Bulletins and Judging", async ({ page }) => {
  for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
    const code = codeOf(track);
    await page.context().clearCookies();
    await loginAsTeam(page, ev, code);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(code);
    await expect(page.getByTestId("team-phase")).toContainText("Setup");
    await expect(page.getByTestId("round-label")).toHaveText("Get ready");
    await expect(page.getByTestId("your-job")).toContainText("Your job:");
    const cash = (await ev.n.one("select cash_cents from teams where code = $1", [code])).cash_cents;
    await expect(page.getByTestId("team-cash")).toHaveText(`$${(Number(cash) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    // Icons are decorative (aria-hidden): the buttons' names are the section names.
    const links = page.getByRole("navigation", { name: "Sections" }).getByRole("link");
    await expect(links).toHaveCount(3);
    for (const [i, name] of ["Home", "Bulletins", "Judging"].entries()) await expect(links.nth(i)).toHaveAccessibleName(name);
    await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  }
});

test("focus mode: a page from another round shows a friendly 'not now' card", async ({ page }) => {
  await loginAsTeam(page, ev, codeOf("FINANCE"));
  await page.goto("/team/rescue");
  await expect(page.getByTestId("not-now")).toContainText("Not right now");
  await expect(page.getByTestId("not-now")).toContainText("This opens in Round 2: Crisis & rescue.");
  await page.getByRole("link", { name: /Back to Home/ }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByTestId("not-now")).toHaveCount(0);
});

test("the latest bulletin, a pause and a disqualification show on every page, without a reload", async ({ page }) => {
  const code = codeOf("FINANCE");
  await loginAsTeam(page, ev, code);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Welcome to the market", "Doors open at 20:00.");
  await expect(page.getByTestId("latest-bulletin")).toContainText("Welcome to the market");
  await ev.n.org("set_seed_commitment", ev.n.eventId, "a".repeat(64));
  await ev.n.advanceTo("CHECKIN");
  await expect(page.getByTestId("team-phase")).toContainText("Check-in");
  await ev.n.org("pause_event", ev.n.eventId);
  await expect(page.getByText("The event is paused.")).toBeVisible();
  await ev.n.org("resume_event", ev.n.eventId);
  await ev.n.q("update teams set disqualified = true, disqualified_reason = 'Test only' where code = $1", [code]); // test-only
  await page.reload();
  await expect(page.getByText("Your team has been disqualified by the fairness officer: Test only")).toBeVisible();
  await ev.n.q("update teams set disqualified = false, disqualified_reason = null where code = $1", [code]);
});

test("a team cannot open the control panel, and staff are sent away from the team portal", async ({ page }) => {
  await loginAsTeam(page, ev, codeOf("PRODUCT"));
  await page.goto(`/admin/${ev.slug}`);
  await expect(page).toHaveURL(/\/team$/);
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto("/team");
  await expect(page).toHaveURL(/\/admin/);
});

test("on a phone the header and the tabs fit, and the current tab is in view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAsTeam(page, ev, codeOf("CONSULTING"));
  await page.goto("/team");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const tab = page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Home" });
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(tab).toBeInViewport();
});
