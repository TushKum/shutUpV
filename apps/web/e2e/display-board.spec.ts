import { expect, test, type Page } from "@playwright/test";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn, pitchesReleased } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's ticker board: the holding message before Reading, the companies with their IPO prices, a round's
// clearing arriving live (new price, change since the IPO price, the arrow), paging 25 tiles at a time by the server
// clock with more than 25 companies, and never a team's name or code on the screen.

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1920, height: 1080 } });

const SLUG = "e2e-display-board";
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof pitchesReleased>>;
const ist = (t: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: SLUG, prefix: "T" });
});

async function screen(page: Page) {
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.display);
  await page.goto(`/display/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(page.getByTestId("board")).toBeVisible();
}

/** The takeovers (the draw, the pitch verdicts) as if they had run an hour ago, so the board shows. */
async function pastTakeovers() {
  await ev.n.q("update events set drawn_at = now() - interval '1 hour' where id = $1 and drawn_at is not null", [ev.n.eventId]);
  await ev.n.q("update scores set released_at = released_at - interval '1 hour' where event_id = $1 and released_at is not null", [ev.n.eventId]);
}

async function noTeamNames(page: Page) {
  const text = await page.getByTestId("stage").innerText();
  for (const t of ev.plan.teams) {
    expect(text, t.code).not.toContain(t.name);
    expect(text, t.code).not.toContain(t.code);
  }
}

const tile = (page: Page, ticker: string) => page.getByTestId(`tile-${ticker}`);
const tickers = (page: Page) => page.getByTestId("tile-ticker");

test("before Reading the board says when the companies are listed", async ({ page }) => {
  const reading = (await ev.n.one("select starts_at from phases where event_id = $1 and code = 'READING'", [ev.n.eventId])).starts_at;
  await screen(page);
  await expect(page.getByTestId("board-waiting")).toHaveText("Companies are listed here from the Reading phase.");
  await expect(page.getByTestId("board-reading")).toHaveText(`Reading is planned to start at ${ist(reading)}`);
  await expect(page.locator("[data-testid^=tile-]")).toHaveCount(0);
  await noTeamNames(page);
});

test("after the pitch scores: every company at its IPO price ($10.50 for 60 points), 0%, no arrow yet, one page", async ({ page }) => {
  s = await pitchesReleased(ev);
  await pastTakeovers();
  await screen(page);
  await expect(tickers(page)).toHaveText(["ETA", "ETB", "ETC"]);
  for (const [i, t] of ["ETA", "ETB", "ETC"].entries()) {
    await expect(tile(page, t).getByTestId("tile-name")).toHaveText(`Company ${i + 1}`);
    await expect(tile(page, t).getByTestId("tile-price")).toHaveText("$10.50");
    await expect(tile(page, t).getByTestId("tile-change")).toHaveText("0%");
    await expect(tile(page, t).getByTestId("tile-move")).toHaveCount(0);
  }
  await expect(page.getByTestId("board-legend")).toHaveText("% change since the IPO price");
  await expect(page.getByTestId("board-page")).toHaveCount(0); // 3 companies: one page, no paging
  await expect(page.getByTestId("board-waiting")).toHaveCount(0);
  await noTeamNames(page);
});

test("a round clears: the board updates live with the new price, the change since IPO and the arrow", async ({ page }) => {
  await ev.n.advanceTo("IPO");
  await ev.n.advanceTo("ROUNDS_1_4");
  await screen(page);
  await expect(tile(page, "ETA").getByTestId("tile-price")).toHaveText("$10.50");
  await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));

  await ev.n.openRound(1);
  await ev.n.ok(ev.n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 3000); // net +3,000: +3%
  await ev.n.ok(ev.n.team(s[0]!.f_code), "place_order", s[1]!.company_id, "SHORT", 1000); // net −1,000: −1%
  await ev.n.clearRound(1);

  // $10.50 → $10.82: (1082 − 1050) × 10,000 ÷ 1050 = 304.76 → +3.05%.
  await expect(tile(page, "ETA").getByTestId("tile-price")).toHaveText("$10.82", { timeout: 5000 });
  await expect(tile(page, "ETA").getByTestId("tile-change")).toHaveText("+3.05%");
  await expect(tile(page, "ETA").getByTestId("tile-change")).toHaveClass(/text-emerald-400/);
  await expect(tile(page, "ETA").getByTestId("tile-move")).toHaveAttribute("data-move", "UP");
  await expect(tile(page, "ETA").getByTestId("tile-move")).toHaveText("▲");
  // $10.50 → $10.40: −95.24 → −0.95%.
  await expect(tile(page, "ETB").getByTestId("tile-price")).toHaveText("$10.40");
  await expect(tile(page, "ETB").getByTestId("tile-change")).toHaveText("−0.95%");
  await expect(tile(page, "ETB").getByTestId("tile-change")).toHaveClass(/text-red-500/);
  await expect(tile(page, "ETB").getByTestId("tile-move")).toHaveAttribute("data-move", "DOWN");
  await expect(tile(page, "ETB").getByTestId("tile-move")).toHaveText("▼");
  // Not traded: unchanged.
  await expect(tile(page, "ETC").getByTestId("tile-price")).toHaveText("$10.50");
  await expect(tile(page, "ETC").getByTestId("tile-change")).toHaveText("0%");
  await expect(tile(page, "ETC").getByTestId("tile-move")).toHaveAttribute("data-move", "FLAT");
  await expect(tile(page, "ETC").getByTestId("tile-move")).toHaveText("▬");
  await expect(page.getByTestId("board-legend")).toHaveText("% change since the IPO price · ▲ ▼ ▬ round 1’s move");

  // The tiles that moved light up for a few seconds after the clearing, then settle.
  await expect(tile(page, "ETA")).toHaveAttribute("data-lit", "true");
  await expect(tile(page, "ETB")).toHaveAttribute("data-lit", "true");
  await expect(tile(page, "ETC")).not.toHaveAttribute("data-lit", "true");
  await expect(page.locator("[data-lit=true]")).toHaveCount(0, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true); // no reload
  const prices = await ev.n.q("select ticker, market_price from companies where event_id = $1 order by ticker", [ev.n.eventId]);
  expect(prices).toEqual([
    { ticker: "ETA", market_price: 1082 },
    { ticker: "ETB", market_price: 1040 },
    { ticker: "ETC", market_price: 1050 },
  ]);
  await noTeamNames(page);
});

/** Waits until the server clock (this machine's) is in an even or odd 20-s slot with at least 8 s of it left. */
async function waitForSlot(page: Page, parity: 0 | 1) {
  for (;;) {
    const t = Date.now();
    if (Math.floor(t / 20_000) % 2 === parity && 20_000 - (t % 20_000) > 8_000) return;
    await page.waitForTimeout(250);
  }
}

test("more than 25 companies: 25 tiles to a page, a new page every 20 s by the server clock, also after a reload", async ({ page }) => {
  test.setTimeout(180_000);
  ev = await seedE2eEvent({ slug: SLUG, prefix: "T", squads: 26 }); // replaces the 3-squad event
  await drawn(ev);
  await ev.n.advanceTo("READING"); // every company gets a default ticker: ZAAB … ZAAZ, ZABA (squads 1–26)
  await pastTakeovers();
  await screen(page);
  const all = (await ev.n.q("select ticker from companies where event_id = $1 order by ticker collate \"C\"", [ev.n.eventId])).map((r) => r.ticker);
  expect(all).toHaveLength(26);

  await expect(page.getByTestId("board-page")).toHaveText("1 / 2", { timeout: 25_000 });
  await expect(tickers(page)).toHaveText(all.slice(0, 25));
  await expect(page.getByTestId("tile-pending")).toHaveCount(25); // IPO prices come with the pitch scores
  await expect(page.getByTestId("board-legend")).toHaveText("IPO prices are set when the pitch scores are released.");

  await expect(page.getByTestId("board-page")).toHaveText("2 / 2", { timeout: 25_000 });
  await expect(tickers(page)).toHaveText(all.slice(25));
  expect(all[25]).toBe("ZABA");

  // A reload in the middle of page 2 stays on page 2 (the page comes from the server clock, not from the reload).
  await waitForSlot(page, 1);
  await page.reload();
  await expect(page.getByTestId("board-page")).toHaveText("2 / 2", { timeout: 5000 });
  await expect(tickers(page)).toHaveText(["ZABA"]);
  await waitForSlot(page, 0);
  await page.reload();
  await expect(page.getByTestId("board-page")).toHaveText("1 / 2", { timeout: 5000 });
  await noTeamNames(page);
});
