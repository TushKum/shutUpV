import { expect, test, type Page } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-bulletins", prefix: "E" });
});

const bulletinsPage = (page: Page) => page.goto(`/admin/${ev.slug}/bulletins`);
const panel = (page: Page, title: string | RegExp) => page.locator("section").filter({ has: page.getByRole("heading", { name: title }) });
const ist = (at: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

test("an organiser composes and publishes a bulletin with two clicks; it is listed newest first", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await bulletinsPage(page);
  const compose = panel(page, "Compose");
  // The general composer has no FLASH kind: the flash bulletin has its own path.
  await expect(compose.getByLabel("Kind").locator("option")).toHaveText(["General", "Crisis", "Fairness", "System"]);

  await compose.getByLabel("Kind").selectOption("SYSTEM");
  await compose.getByLabel(/^Title/).fill("Wi-Fi is back");
  await compose.getByLabel(/^Body/).fill("Reconnect to the event network.\nOrders placed before the outage stand.");
  await compose.getByRole("button", { name: "Publish bulletin" }).click();
  await expect(compose.getByRole("button", { name: "Click again to publish to every screen" })).toBeVisible();
  expect((await ev.n.one("select count(*)::int as n from bulletins where event_id = $1", [ev.n.eventId])).n).toBe(0);
  await compose.getByRole("button", { name: "Click again to publish to every screen" }).click();
  await expect(compose.getByRole("status")).toHaveText("Published “Wi-Fi is back” to every screen.");
  await expect(compose.getByLabel(/^Title/)).toHaveValue(""); // cleared for the next one

  const row = await ev.n.one("select kind, title, body, published_at from bulletins where event_id = $1", [ev.n.eventId]);
  expect(row).toMatchObject({ kind: "SYSTEM", title: "Wi-Fi is back", body: "Reconnect to the event network.\nOrders placed before the outage stand." });
  expect(row.published_at).not.toBeNull();

  await compose.getByLabel("Kind").selectOption("GENERAL");
  await compose.getByLabel(/^Title/).fill("Round 1 opens at 23:30");
  await compose.getByRole("button", { name: "Publish bulletin" }).click();
  await compose.getByRole("button", { name: "Click again to publish to every screen" }).click();
  await expect(compose.getByRole("status")).toHaveText("Published “Round 1 opens at 23:30” to every screen.");

  const list = page.getByRole("list", { name: "Bulletins" }).getByRole("listitem");
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toContainText("Round 1 opens at 23:30");
  await expect(list.nth(0)).toContainText("General");
  await expect(list.nth(0)).toContainText(/\d\d:\d\d:\d\d/); // published at (IST)
  await expect(list.nth(1)).toContainText("Wi-Fi is back");
  await expect(list.nth(1)).toContainText("System");
  await expect(list.nth(1)).toContainText("Orders placed before the outage stand.");
  await expect(panel(page, /^All bulletins/)).toContainText("All bulletins (2)");
});

test("a refused bulletin keeps what was typed and says why", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await bulletinsPage(page);
  const compose = panel(page, "Compose");
  // A title of spaces passes the browser's "required" check; the server refuses it.
  await compose.getByLabel(/^Title/).fill("   ");
  await compose.getByLabel(/^Body/).fill("Keep this text.");
  await compose.getByRole("button", { name: "Publish bulletin" }).click();
  await compose.getByRole("button", { name: "Click again to publish to every screen" }).click();
  await expect(compose.getByRole("alert")).toHaveText("BAD_BULLETIN: A bulletin needs a title.");
  await expect(compose.getByLabel(/^Body/)).toHaveValue("Keep this text.");
  expect((await ev.n.one("select count(*)::int as n from bulletins where event_id = $1", [ev.n.eventId])).n).toBe(2);
});

test("the flash bulletin: prepared (a draft in the list), published with two clicks only in rounds 13–21, once", async ({ page }) => {
  await ev.n.org("prepare_flash_bulletin", ev.n.eventId, "Interest rates rise", "Investors now want profit within 12 months.");
  await loginAsStaff(page, ev, STAFF.lead);
  await bulletinsPage(page);
  const flash = panel(page, "Flash bulletin");

  const due = (await ev.n.one("select at from deadlines where event_id = $1 and code = 'FLASH_BULLETIN'", [ev.n.eventId])).at as Date;
  await expect(flash.getByText("Flash bulletin due")).toBeVisible();
  await expect(flash.locator("dd").first()).toContainText(ist(due));
  await expect(page.getByTestId("flash-state")).toContainText("not published");
  await expect(page.getByTestId("flash-state")).toContainText("Interest rates rise");
  const list = page.getByRole("list", { name: "Bulletins" }).getByRole("listitem");
  await expect(list.filter({ hasText: "Interest rates rise" })).toContainText("Draft, not published");

  // Not in rounds 13–21 yet: the button is off and says why.
  const publish = flash.getByRole("button", { name: "Publish the flash bulletin" });
  await expect(publish).toBeDisabled();
  await expect(flash.getByText("The flash bulletin is published during rounds 13–21 (04:00).")).toBeVisible();

  await ev.n.q("update events set current_phase = 'ROUNDS_13_21' where id = $1", [ev.n.eventId]); // test-only jump to 04:00
  await page.reload();
  await expect(publish).toBeEnabled();
  await publish.click();
  await flash.getByRole("button", { name: "Click again to publish the flash bulletin" }).click();
  await expect(page.getByTestId("flash-state")).toContainText("Published");
  await expect(flash.getByRole("button", { name: "Publish the flash bulletin" })).toHaveCount(0);
  const row = await ev.n.one("select published_at from bulletins where event_id = $1 and kind = 'FLASH'", [ev.n.eventId]);
  expect(row.published_at).not.toBeNull();
  await expect(list.filter({ hasText: "Interest rates rise" })).not.toContainText("Draft");
  await expect(list.first()).toContainText("Interest rates rise"); // newest first

  // Once only: the database refuses a second publication or a new draft.
  expect(await ev.n.call(ev.n.lead, "publish_flash_bulletin", ev.n.eventId)).toMatchObject({ ok: false, code: "ALREADY_PUBLISHED" });
  expect(await ev.n.call(ev.n.lead, "publish_bulletin", ev.n.eventId, "FLASH", "Another", "x")).toMatchObject({ ok: false, code: "USE_FLASH" });
});

test("the fairness officer reads every bulletin but cannot publish", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await bulletinsPage(page);
  await expect(page.getByText("only organisers publish")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish bulletin" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Publish the flash bulletin/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Bulletins" }).getByRole("listitem")).toHaveCount(3);
});
