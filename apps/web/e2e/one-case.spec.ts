import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// One case for every squad: the organiser uploads the one-card decks from seed/one-case through the content page, the
// draw gives every squad that card already chosen, and the Product and Consulting teams see "The case" with no pick.
let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-one-case", prefix: "X" });
});

const SEED_DIR = join(__dirname, "..", "..", "..", "seed", "one-case");
const file = (name: string) => ({ name, mimeType: "text/csv", buffer: readFileSync(join(SEED_DIR, name)) });
const panel = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const shots = process.env.ONE_CASE_SHOTS;

test("the organiser uploads the one-case decks", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/content`);
  for (const [title, button, name] of [
    ["Problem deck", "Upload the problem deck", "problem-cards.csv"],
    ["Crisis deck", "Upload the crisis deck", "crisis-cards.csv"],
  ] as const) {
    const section = panel(page, title);
    await section.getByLabel(/^CSV file/).setInputFiles(file(name));
    await section.getByRole("button", { name: button }).click();
  }
  await expect(panel(page, "Problem deck").getByText(/^1 card: every squad plays this same case/)).toBeVisible();
  await expect(panel(page, "Problem deck")).toContainText("The Hostel Kitchen");
  await expect(panel(page, "Crisis deck")).toContainText("The food-safety rule");
  expect((await ev.n.q("select count(*)::int as c from problem_cards where event_id = $1", [ev.n.eventId]))[0]!.c).toBe(1);
  expect((await ev.n.q("select count(*)::int as c from crisis_cards where event_id = $1", [ev.n.eventId]))[0]!.c).toBe(1);
  if (shots) await page.screenshot({ path: `${shots}/1-admin-content.png`, fullPage: true });
});

test("after the draw every squad has the case, already chosen; teams see it with nothing to pick", async ({ page, browser }) => {
  const s = await drawn(ev);
  const card = (await ev.n.one("select id from problem_cards where event_id = $1", [ev.n.eventId])).id;
  for (const x of s) expect(x).toMatchObject({ dealt_card_ids: [card], chosen_card_id: card, chosen_by_default: false });

  await loginAsTeam(page, ev, s[0]!.p_code);
  await page.goto("/team/squad");
  const problem = page.getByTestId("squad-problem");
  await expect(problem).toContainText("The Hostel Kitchen");
  await expect(problem).toContainText("Every squad");
  await expect(problem).toContainText("Every squad plays this same case tonight. There is nothing to pick.");
  await expect(problem).not.toContainText("Pick closes");
  if (shots) await page.screenshot({ path: `${shots}/2-team-squad.png`, fullPage: true });

  await page.getByRole("link", { name: "Read the case" }).click();
  await expect(page).toHaveURL(/\/team\/squad\/problem$/);
  await expect(page.getByRole("heading", { name: "The case" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Same case for every squad");
  await expect(page.getByRole("button", { name: /Pick this card/ })).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/3-team-case.png`, fullPage: true });

  // Another squad's Consulting team sees the same case.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Kolkata" });
  const phone = await ctx.newPage();
  await loginAsTeam(phone, ev, s[2]!.c_code);
  await phone.goto("/team/squad/problem");
  await expect(phone.getByRole("main")).toContainText("The Hostel Kitchen");
  await expect(phone.getByRole("button", { name: /Pick this card/ })).toHaveCount(0);
  if (shots) await phone.screenshot({ path: `${shots}/4-consulting-phone.png`, fullPage: true });
  await ctx.close();

  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/lottery`);
  await expect(page.getByRole("main")).toContainText("The Hostel Kitchen");
  if (shots) await page.screenshot({ path: `${shots}/5-admin-lottery.png`, fullPage: true });
});
