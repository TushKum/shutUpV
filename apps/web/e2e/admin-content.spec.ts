import { expect, test, type Page } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { commit, seedOf } from "./support/game";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-content", prefix: "G" });
});

const contentPage = (page: Page) => page.goto(`/admin/${ev.slug}/content`);
const panel = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const csvFile = (name: string, text: string, mimeType = "text/csv") => ({ name, mimeType, buffer: Buffer.from(text, "utf8") });

async function upload(page: Page, title: string, button: string, file: ReturnType<typeof csvFile>) {
  const section = panel(page, title);
  await section.getByLabel(/^CSV file/).setInputFiles(file);
  await section.getByRole("button", { name: button }).click();
  return section;
}

const PROBLEMS = [
  "number,sector,title,body",
  '1,Water,Unsafe water in small towns,"Tanks are checked rarely; contamination is found late."',
  "2,Food,Hostel food waste,Hostels throw away a large share of the food they cook.",
  '3,Health,Clinic stock-outs,"Rural clinics run out of basic medicines, often for weeks."',
  "4,Transport,Last-mile buses,Students wait an hour for the last bus.",
  "5,Energy,Diesel generators,Shops run diesel generators through every power cut.",
  "6,Finance,Informal credit,Street vendors borrow at 10% a week.",
].join("\n");

test("the problem deck: expected columns, parse errors by row, the database's refusal, then a deck that replaces the old one", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await contentPage(page);
  const problems = panel(page, "Problem deck");
  await expect(problems.getByText("number,sector,title,body", { exact: true })).toBeVisible();
  await expect(problems.getByText("Can be replaced")).toBeVisible();
  await expect(problems.getByText(/^5 cards\. .* at least 5 \(squads \+ 2\)\.$/)).toBeVisible(); // the seeded deck, 3 squads
  const before = await ev.n.q("select number, title from problem_cards where event_id = $1 order by number", [ev.n.eventId]);

  await upload(page, "Problem deck", "Upload the problem deck", csvFile("deck.csv", "number,sector,title\n1,Water,Unsafe water\n"));
  await expect(problems.getByRole("alert")).toHaveText("BAD_CSV: Missing column: body. Expected columns: number, sector, title, body.");

  await upload(page, "Problem deck", "Upload the problem deck", csvFile("deck.csv", "number,sector,title,body\n1,a,t,b\nseven,a,t,b\n"));
  await expect(problems.getByRole("alert")).toHaveText("BAD_CSV: Problem CSV row 3: bad number");

  await upload(page, "Problem deck", "Upload the problem deck", csvFile("deck.xlsx", "PK…", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
  await expect(problems.getByRole("alert")).toHaveText("BAD_FILE: “deck.xlsx” is not a .csv file.");

  // Too large: refused in the browser, before it is sent (the server would refuse a body over 1 MB outright).
  await upload(page, "Problem deck", "Upload the problem deck", csvFile("big.csv", `number,sector,title,body\n${"x".repeat(1200 * 1024)}`));
  await expect(problems.getByRole("alert")).toHaveText("BAD_FILE: The file is 1,201 KB; the limit is 512 KB.");
  await expect(page.getByRole("heading", { name: "Problem deck", exact: true })).toBeVisible();

  // Parses, but 4 cards are too few for 3 squads: the game function refuses it.
  await upload(page, "Problem deck", "Upload the problem deck", csvFile("deck.csv", PROBLEMS.split("\n").slice(0, 5).join("\n")));
  await expect(problems.getByRole("alert")).toHaveText("BAD_DECK: The deck needs at least 5 cards (squads + 2) and at most 999.");
  expect(await ev.n.q("select number, title from problem_cards where event_id = $1 order by number", [ev.n.eventId])).toEqual(before);

  await upload(page, "Problem deck", "Upload the problem deck", csvFile("problem-cards.csv", `﻿${PROBLEMS}\r\n`));
  await expect(problems.getByRole("status")).toHaveText("Uploaded 6 problem cards; the previous deck was replaced.");
  const rows = problems.locator("tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(2)).toContainText("3HealthClinic stock-outsRural clinics run out of basic medicines, often for weeks.");
  await expect(problems.getByText(/^6 cards\./)).toBeVisible();
  expect((await ev.n.q("select number, sector, title from problem_cards where event_id = $1 order by number", [ev.n.eventId])).at(-1)).toEqual({
    number: 6,
    sector: "Finance",
    title: "Informal credit",
  });
});

test("the crisis deck: a repeated category and number is named by row; a good deck is stored", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await contentPage(page);
  const crisis = panel(page, "Crisis deck");
  await expect(crisis.getByText("category,number,title,body", { exact: true })).toBeVisible();
  await expect(crisis.getByText("10 cards in 10 categories.", { exact: false })).toBeVisible(); // the seeded deck

  await upload(page, "Crisis deck", "Upload the crisis deck", csvFile("crisis.csv", "category,number,title,body\nRegulation,1,A ban,Stop.\nRegulation,,Another ban,Stop again.\n"));
  await expect(crisis.getByRole("alert")).toHaveText("BAD_CSV: Row 3: “Regulation #1” is already on row 2; each category and number pair must be unique.");

  const deck = [
    "category,number,title,body",
    "Regulation,1,A new rule bans how you operate,The college bans your delivery model from next month.",
    'Regulation,2,Licence suspended,"Your licence is suspended pending review, for 60 days."',
    "Data breach,1,Customer data leaked,A supplier leaked your customer list.",
    "Data breach,2,Ransomware,Your systems are locked for a week.",
  ].join("\n");
  await upload(page, "Crisis deck", "Upload the crisis deck", csvFile("crisis-cards.csv", deck));
  await expect(crisis.getByRole("status")).toHaveText("Uploaded 4 crisis cards in 2 categories; the previous deck was replaced.");
  const rows = crisis.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Data breach1Customer data leaked");
  await expect(rows.nth(3)).toContainText("Regulation2Licence suspended");
  expect((await ev.n.one("select count(*)::int as n from crisis_cards where event_id = $1", [ev.n.eventId])).n).toBe(4);
});

test("the flash bulletin: exactly one row; prepared, hidden until published; uploading again replaces it", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await contentPage(page);
  const flash = panel(page, "Flash bulletin");
  await expect(flash.getByText("title,body", { exact: true })).toBeVisible();
  await expect(page.getByTestId("flash-bulletin")).toHaveText("No flash bulletin prepared yet.");

  await upload(page, "Flash bulletin", "Upload the flash bulletin", csvFile("flash.csv", "title,body\nRates rise,One.\nRates fall,Two.\n"));
  await expect(flash.getByRole("alert")).toHaveText("BAD_CSV: Flash bulletin CSV: exactly one row after the header (found 2)");

  await upload(page, "Flash bulletin", "Upload the flash bulletin", csvFile("flash.csv", 'title,body\nRates rise,"Investors want profit, soon."\n'));
  await expect(flash.getByRole("status")).toHaveText("Flash bulletin prepared: “Rates rise”. Publish it under Bulletins at 04:00.");
  await upload(page, "Flash bulletin", "Upload the flash bulletin", csvFile("flash.csv", 'title,body\nInterest rates rise,"Investors now want profit within 12 months."\n'));
  await expect(flash.getByRole("status")).toHaveText("Flash bulletin prepared: “Interest rates rise”. Publish it under Bulletins at 04:00.");
  await expect(page.getByTestId("flash-bulletin")).toContainText("not published");
  await expect(page.getByTestId("flash-bulletin")).toContainText("Interest rates rise");
  expect(await ev.n.q("select title, published_at from bulletins where event_id = $1 and kind = 'FLASH'", [ev.n.eventId])).toEqual([
    { title: "Interest rates rise", published_at: null },
  ]);
});

test("the fairness officer reads the content but has no upload forms", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await contentPage(page);
  await expect(page.getByText("only organisers upload it")).toBeVisible();
  await expect(panel(page, "Problem deck").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByLabel(/^CSV file/)).toHaveCount(0); // nothing is locked yet: the forms are hidden for the role
  await expect(page.getByText("Can be replaced")).toHaveCount(3);
});

test("each piece of content locks once used: both decks at the draw, the flash bulletin when published", async ({ page }) => {
  await commit(ev);
  await ev.n.advanceTo("SQUAD_DRAW");
  await ev.n.org("run_lottery", ev.n.eventId, seedOf(ev), "4"); // draws from the 6-card deck uploaded above

  await loginAsStaff(page, ev, STAFF.lead);
  await contentPage(page);
  const problems = panel(page, "Problem deck");
  await expect(problems.getByText("Locked: the problem deck is fixed once the lottery has been drawn.")).toBeVisible();
  await expect(problems.getByRole("button", { name: "Upload the problem deck" })).toHaveCount(0);
  await expect(problems.locator("tbody tr")).toHaveCount(6);
  // From the draw on, organisers know the seed, and with it which crisis category each squad would get.
  await expect(panel(page, "Crisis deck").getByText("Locked: the crisis deck is fixed once the lottery has been drawn.")).toBeVisible();
  await expect(panel(page, "Crisis deck").getByRole("button", { name: "Upload the crisis deck" })).toHaveCount(0);
  await expect(panel(page, "Flash bulletin").getByRole("button", { name: "Upload the flash bulletin" })).toBeVisible();

  await ev.n.q("update events set current_phase = 'ROUNDS_13_21' where id = $1", [ev.n.eventId]); // test-only jump to 04:00
  await ev.n.org("publish_flash_bulletin", ev.n.eventId);
  await page.reload();
  await expect(panel(page, "Flash bulletin").getByText("Locked: the flash bulletin has been published.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Upload the/ })).toHaveCount(0);
  await expect(page.getByTestId("flash-bulletin")).toContainText("Published");
  await expect(page.getByText("Can be replaced")).toHaveCount(0);
});
