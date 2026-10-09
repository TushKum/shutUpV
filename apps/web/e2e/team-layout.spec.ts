import { expect, test } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-team-layout", prefix: "Y" });
});

const codeOf = (track: "PRODUCT" | "CONSULTING" | "FINANCE") => ev.plan.teams.find((t) => t.track === track)!.code;

test("every track sees its team, where the night is, its cash and the sections of its track", async ({ page }) => {
  const expected = {
    PRODUCT: ["Home", "Squad", "Rescue", "Market", "Q&A", "Ledger", "Bulletins"],
    CONSULTING: ["Home", "Squad", "Rescue", "Calls", "Earnings", "Market", "Q&A", "Ledger", "Bulletins"],
    FINANCE: ["Home", "Trade", "Rescue", "Market", "Q&A", "Ledger", "Bulletins"],
  } as const;
  for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
    const code = codeOf(track);
    await page.context().clearCookies();
    await loginAsTeam(page, ev, code);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(code);
    await expect(page.getByTestId("team-phase")).toContainText("Setup");
    const cash = (await ev.n.one("select cash_cents from teams where code = $1", [code])).cash_cents;
    await expect(page.getByTestId("team-cash")).toHaveText(`$${(Number(cash) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveText([...expected[track]]);
    await expect(page.getByText("Collateral locked")).toHaveCount(track === "FINANCE" ? 1 : 0);
    await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  }
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
