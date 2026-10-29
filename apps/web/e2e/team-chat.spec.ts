import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The squad chat: closed before the draw; then the three teams of a squad talk live, another squad never sees it, and
// a message from another team pops a toast on any other page. The state is moved with the real game functions.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  ev = await seedE2eEvent({ slug: "e2e-team-chat", prefix: "F" });
});

async function screen(browser: Browser, code: string, width = 1280): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await loginAsTeam(page, ev, code);
  return page;
}

test("before the draw the chat waits for the squads", async ({ page }) => {
  await loginAsTeam(page, ev, ev.plan.teams[0]!.code);
  await page.goto("/team/chat");
  await expect(page.getByRole("main")).toContainText("The squad chat opens at the squad draw");
});

test("the squad's three teams chat live; another squad sees nothing; other pages get a toast", async ({ browser }) => {
  s = await drawn(ev);
  const [x, y] = s;
  const product = await screen(browser, x!.p_code);
  const fund = await screen(browser, x!.f_code, 390);
  const other = await screen(browser, y!.c_code);
  const consulting = await screen(browser, x!.c_code);
  await product.goto("/team/chat");
  await fund.goto("/team/chat");
  await other.goto("/team/chat");
  await consulting.goto("/team/market");
  await expect(product.getByRole("main")).toContainText("No messages yet.");
  await expect(product.getByRole("main")).toContainText("Organisers and the fairness officer can read it too");

  const box = product.getByRole("textbox", { name: "Message" });
  const send = product.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await box.fill("Fee 4%? We can sign by 01:30.");
  await expect(product.getByText("29 / 500 characters")).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue("");
  const mine = product.getByRole("list", { name: "Messages" }).getByRole("article");
  await expect(mine).toHaveCount(1);
  await expect(mine.first()).toContainText("Product team (you)");

  // The fund's phone gets it without a reload, labelled with the sender's track.
  const theirs = fund.getByRole("list", { name: "Messages" }).getByRole("article");
  await expect(theirs).toHaveCount(1);
  await expect(theirs.first()).toContainText("Product team");
  await expect(theirs.first()).toContainText("Fee 4%? We can sign by 01:30.");
  await fund.getByRole("textbox", { name: "Message" }).fill("3%, and we put in $2M.");
  await fund.getByRole("button", { name: "Send" }).click();
  await expect(mine).toHaveCount(2);
  await expect(mine.nth(1)).toContainText("Finance team");
  await expect(fund.locator("html")).toHaveJSProperty("scrollWidth", 390);

  // The consulting team, on another page, is told.
  const toast = consulting.getByTestId("alerts");
  await expect(toast).toContainText("New message in your squad chat.");
  await toast.getByRole("link", { name: "Open" }).click();
  await expect(consulting.getByRole("list", { name: "Messages" }).getByRole("article")).toHaveCount(2);

  // Another squad's chat stays empty.
  await other.reload();
  await expect(other.getByRole("main")).toContainText("No messages yet.");

  // Too long: the button stays off and the counter says so.
  await box.fill("x".repeat(501));
  await expect(send).toBeDisabled();
  await expect(product.getByText("501 / 500 characters")).toBeVisible();

  for (const p of [product, fund, other, consulting]) await p.context().close();
});

test("staff read every chat: the busiest squad first, one squad live, and a search across all of them", async ({ page, browser }) => {
  const [x] = s;
  await loginAsStaff(page, ev, "fairness@example.org");
  await page.goto(`/admin/${ev.slug}/chats`);
  const squads = page.getByRole("list", { name: "Squads" }).getByRole("link");
  await expect(squads).toHaveCount(3);
  await expect(squads.first()).toContainText("Squad 01");
  await expect(squads.first()).toContainText("2 ·");
  await expect(squads.nth(1)).toContainText("quiet");
  await squads.first().click();
  const log = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(log).toHaveCount(2);
  await expect(log.first()).toContainText(x!.p_code);
  await expect(log.first()).toContainText("Fee 4%? We can sign by 01:30.");
  await expect(log.nth(1)).toContainText(x!.f_code);

  // A new message arrives without a reload.
  const consulting = await screen(browser, x!.c_code);
  await consulting.goto("/team/chat");
  await consulting.getByRole("textbox", { name: "Message" }).fill("Agreed: 3%. Proposing now.");
  await consulting.getByRole("button", { name: "Send" }).click();
  await expect(log).toHaveCount(3);
  await expect(log.nth(2)).toContainText(x!.c_code);
  await consulting.context().close();

  // Search every chat; % is matched literally.
  await page.getByRole("textbox", { name: "Search every chat" }).fill("3%");
  await page.getByRole("button", { name: "Search" }).click();
  const hits = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(hits).toHaveCount(2);
  await expect(hits.first()).toContainText("Squad 01");
  await page.getByRole("textbox", { name: "Search every chat" }).fill("nobody wrote this");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No message matches.")).toBeVisible();
});

test("at the awards the chat closes and stays readable", async ({ page }) => {
  await ev.n.q("update events set current_phase = 'AWARDS' where id = $1", [ev.n.eventId]);
  await loginAsTeam(page, ev, s[0]!.c_code);
  await page.goto("/team/chat");
  await expect(page.getByRole("main")).toContainText("The squad chat closed at the awards.");
  await expect(page.getByRole("list", { name: "Messages" }).getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveCount(0);
});
