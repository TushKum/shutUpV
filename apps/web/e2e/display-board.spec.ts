import { expect, test, type Page } from "@playwright/test";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn, pitchesReleased, trading } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's ticker board: the holding message before Reading, the companies with their IPO prices, a round's
// clearing arriving live (new price, change since the IPO price, the arrow), paging 25 tiles at a time by the server
// clock with more than 25 companies, and never a team's name or code on the screen. The header's round countdown
// stands still during a pause, and the paused round stays the open round past its planned close.

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
  // The news ticker: round 1's movers by ticker, never a team.
  const ticker = page.getByTestId("news-ticker");
  await expect(ticker).toContainText("Round 1 ▲ETA +3.05%");
  await expect(ticker).toContainText("Round 1 ▼ETB −0.95%");

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

  // Each check runs early in its page's 20-s slot, so the page cannot turn in the middle of it.
  await waitForSlot(page, 0);
  await expect(page.getByTestId("board-page")).toHaveText("1 / 2");
  await expect(tickers(page)).toHaveText(all.slice(0, 25));
  await expect(page.getByTestId("tile-pending")).toHaveCount(25); // IPO prices come with the pitch scores
  await expect(page.getByTestId("board-legend")).toHaveText("IPO prices are set when the pitch scores are released.");

  await waitForSlot(page, 1);
  await expect(page.getByTestId("board-page")).toHaveText("2 / 2");
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

const round = (page: Page) => page.getByTestId("display-round");
/** The header's countdown (the line under "Round N closes in"). */
const roundTime = (page: Page) => round(page).locator("p").nth(1);
/** A time left under an hour as countdown() in lib/format.ts writes it: whole seconds, "4:05". */
const mmss = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const secondsOf = (text: string) => {
  const [m, sec] = text.split(":").map(Number);
  return m! * 60 + sec!;
};

test("a pause freezes the round countdown on the big screen, and the paused round stays the open round past its planned close", async ({ page }) => {
  // While paused the header shows the time round 1 had left when the pause began, standing still; a planned close
  // that passes during the pause leaves round 1 the open round (not "Round 2 opens"); on resume its close has moved
  // later by the length of the pause, so the countdown carries on from the time it had left. Last: it leaves the
  // round open with a minute to go.
  test.setTimeout(180_000);
  ev = await seedE2eEvent({ slug: SLUG, prefix: "T" }); // replaces the 26-squad event
  await trading(ev);
  await pastTakeovers();
  await ev.n.openRound(1);
  await ev.n.q("update rounds set closes_at = now() + interval '5 minutes' where event_id = $1 and number = 1", [ev.n.eventId]);
  await screen(page);
  await expect(page.getByTestId("display-trading")).toHaveText("OPEN");
  await expect(round(page)).toContainText("Round 1 closes in");
  await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));

  await ev.n.org("pause_event", ev.n.eventId);
  await expect(page.getByTestId("display-trading")).toHaveText("PAUSED");
  await expect(page.getByTestId("display-paused")).toBeVisible();
  await expect(round(page)).toContainText("Round 1 is paused with");
  // The time left when the pause began, worked out from the same two timestamps the screen reads (event_status).
  const t = await ev.n.one(
    "select to_json(r.closes_at) #>> '{}' as closes, to_json(e.paused_at) #>> '{}' as paused from rounds r join events e on e.id = r.event_id where e.id = $1 and r.number = 1",
    [ev.n.eventId],
  );
  const frozen = mmss(Date.parse(t.closes) - Date.parse(t.paused));
  expect(secondsOf(frozen)).toBeGreaterThan(180); // about 5 min: the close was set 5 min ahead just before
  await expect(roundTime(page)).toHaveText(frozen);
  // A fixed wait on purpose: what is proven is that the countdown does not move while time passes. Read once, not
  // retried, so a countdown that ticked would fail here.
  await page.waitForTimeout(3000);
  expect(await roundTime(page).innerText()).toBe(frozen);
  expect(await roundTime(page).innerText()).not.toBe("0:00");

  // The planned close passes during the pause: the pause began 2 min ago and the round was to close 1 min ago, so it
  // had 1:00 left (one statement, so both times come from the same now()). The round opened before the pause.
  await ev.n.q(
    `with e as (update events set paused_at = now() - interval '2 minutes' where id = $1 returning id)
     update rounds set opens_at = now() - interval '3 minutes', closes_at = now() - interval '1 minute' where event_id = $1 and number = 1`,
    [ev.n.eventId],
  );
  const before = (await ev.n.one("select closes_at from rounds where event_id = $1 and number = 1", [ev.n.eventId])).closes_at as Date;
  expect(before.getTime()).toBeLessThan(Date.now());
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Back in a minute", "The market is paused.");
  await expect(page.getByTestId("display-bulletin")).toContainText("Back in a minute"); // the screen has read itself again
  await expect(round(page)).toContainText("Round 1 is paused with");
  await expect(roundTime(page)).toHaveText("1:00");
  await expect(round(page)).not.toContainText("opens"); // not "Round 2 opens / after the pause"
  await expect(page.getByTestId("display-trading")).toHaveText("PAUSED");
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true); // live, no reload
  // A fresh load (the server's render) says the same.
  await page.reload();
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(round(page)).toContainText("Round 1 is paused with");
  await expect(roundTime(page)).toHaveText("1:00");
  expect((await ev.n.one("select status from rounds where event_id = $1 and number = 1", [ev.n.eventId])).status).toBe("OPEN"); // the tick waits

  await ev.n.org("resume_event", ev.n.eventId);
  await expect(page.getByTestId("display-trading")).toHaveText("OPEN");
  await expect(page.getByTestId("display-paused")).toHaveCount(0);
  await expect(round(page)).toContainText("Round 1 closes in");
  const left = await roundTime(page).innerText();
  await expect.poll(() => roundTime(page).innerText(), { timeout: 10_000 }).not.toBe(left); // it moves again
  // It carries on from the 1:00 it had left (less the moments since the resume; a second over for the clock offset).
  expect(secondsOf(left)).toBeGreaterThanOrEqual(40);
  expect(secondsOf(left)).toBeLessThanOrEqual(61);
  const after = await ev.n.one("select status, closes_at, extract(epoch from closes_at - now())::float as left_s from rounds where event_id = $1 and number = 1", [
    ev.n.eventId,
  ]);
  expect(after.status).toBe("OPEN");
  expect((after.closes_at as Date).getTime() - before.getTime()).toBeGreaterThanOrEqual(120_000); // moved by the pause (2 min and a bit)
  expect(after.left_s).toBeGreaterThan(0);
  expect(after.left_s).toBeLessThanOrEqual(60);
  await noTeamNames(page);
});
