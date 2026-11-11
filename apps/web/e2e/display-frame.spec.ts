import pg from "pg";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { e2eEnv } from "./support/env";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's frame: the display account's way in, the header (phase, round, trading badge, clock), the
// bulletin banner, live updates over the event channel, recovery on its own from a failed read and from a realtime
// drop (no reload), and a takeover that starts on a broadcast, shows a pause on top of it, and gives way to the board
// when it runs out (also after a reload in the middle of it).

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 720 } });

let ev: E2eEvent;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: "e2e-display-frame", prefix: "S" });
});

async function screen(page: Page) {
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.display);
  await page.goto(`/display/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
}

// A mark on the window: still there later means the page was never reloaded (a reload starts a new window).
// `__seen` holds the moments the realtime-drop test records in the page.
type Probe = Window & { __marker?: number; __seen?: { back: number | null; shown: number | null } };
const markWindow = (page: Page) => page.evaluate(() => void ((window as Probe).__marker = 1));
const sameWindow = (page: Page) => page.evaluate(() => (window as Probe).__marker === 1);

test("the display account signs in, picks the event, and sees the frame scaled to the window", async ({ page }) => {
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.display);
  await expect(page).toHaveURL(/\/display/);
  // Several events exist on the test stack, so the operator picks one.
  await page.getByRole("link", { name: new RegExp(`E2E ${ev.slug}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/display/${ev.slug}$`));
  await expect(page.getByTestId("display-phase")).toHaveText("Setup");
  await expect(page.getByTestId("display-trading")).toHaveText("HALTED");
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  // 1920×1080 scaled to a 1280×720 window.
  const box = await page.getByTestId("stage").boundingBox();
  expect(Math.round(box!.width)).toBe(1280);
  expect(Math.round(box!.height)).toBe(720);
});

test("a published bulletin appears in the banner without a reload", async ({ page }) => {
  await screen(page);
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Dinner is served in hall B", "Until 22:00.");
  await expect(page.getByTestId("display-bulletin")).toContainText("Dinner is served in hall B", { timeout: 5000 });
  await expect(page.getByTestId("display-bulletin")).toContainText("GENERAL");
});

test("a failed read shows Reconnecting… and the screen comes back by itself", async ({ page }) => {
  // A read of the frame that fails shows the calm "Reconnecting…" screen instead of an error page, and the screen
  // retries on its own: once reads work again it is back, with the bulletin whose broadcast caused the read, and live
  // again, without anyone reloading it. The failure is made for this event's bulletins only (a restrictive policy
  // that raises for its rows), so specs running alongside are not affected.
  test.setTimeout(120_000);
  await screen(page);
  await markWindow(page);
  const title = "Coffee and fruit in the lobby";
  const db = new pg.Client({ connectionString: e2eEnv().DATABASE_URL });
  await db.connect();
  try {
    await db.query(`
      create or replace function app.e2e_fail_read() returns boolean language plpgsql volatile as $$
      begin raise exception 'e2e: a read that fails'; end $$;
      grant execute on function app.e2e_fail_read() to authenticated;
      drop policy if exists e2e_fail_read on public.bulletins;
      create policy e2e_fail_read on public.bulletins as restrictive for select to authenticated
        using (event_id <> '${ev.n.eventId}'::uuid or app.e2e_fail_read());`);
    // The broadcast makes the screen read itself again (publishing runs as its owner, so it is not affected).
    await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", title, "Until midnight.");
    await expect(page.getByTestId("display-retry")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("display-retry")).toContainText("Reconnecting…");
    await expect(page.getByTestId("stage")).toHaveCount(0);
  } finally {
    await db.query("drop policy if exists e2e_fail_read on public.bulletins; drop function if exists app.e2e_fail_read();").catch(() => undefined);
    await db.end().catch(() => undefined);
  }
  await expect(page.getByTestId("stage")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("display-bulletin")).toContainText(title);
  await expect(page.getByTestId("display-retry")).toHaveCount(0);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  expect(await sameWindow(page), "the screen came back without a reload").toBe(true);
});

test("after a short realtime drop, the screen catches up on what it missed", async ({ page }) => {
  // Broadcasts sent while the realtime connection is down are not replayed. When the channel is back (SUBSCRIBED),
  // the screen reads itself once, so a bulletin published during the drop shows within a few seconds of the
  // reconnect, not only at the 10 s fallback re-read, and without a reload.
  let blocked = false;
  let refused = 0;
  const open: WebSocketRoute[] = [];
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    if (blocked) {
      refused++;
      void ws.close();
      return;
    }
    ws.connectToServer();
    open.push(ws);
  });
  // Live (SUBSCRIBED) means joined and caught up: the screen's own catch-up read when it joined is over, so only
  // the read on reconnect can show the bulletin below.
  await screen(page);
  await markWindow(page);
  const title = "Lost and found is at the desk";
  // Records in the page when the channel came back after the drop and when the banner first showed the bulletin.
  await page.evaluate((t) => {
    const seen: NonNullable<Probe["__seen"]> = ((window as Probe).__seen = { back: null, shown: null });
    let down = false;
    setInterval(() => {
      const live = document.querySelector("[data-realtime]")?.getAttribute("data-realtime") === "SUBSCRIBED";
      if (!live) down = true;
      else if (down && seen.back === null) seen.back = Date.now();
      if (seen.shown === null && document.querySelector("[data-testid=display-bulletin]")?.textContent?.includes(t)) seen.shown = Date.now();
    }, 50);
  }, title);

  // The connection drops, and every attempt to reconnect is refused while `blocked`.
  blocked = true;
  const droppedAt = Date.now();
  for (const ws of open.splice(0)) await ws.close();
  await expect(page.locator("[data-realtime]")).not.toHaveAttribute("data-realtime", "SUBSCRIBED");
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", title, "Ask for Priya.");
  await expect(page.getByTestId("stage")).not.toContainText(title);
  expect(Date.now() - droppedAt, "checked well within the 10 s fallback").toBeLessThan(10_000);
  // At least one reconnect attempt is refused (the first comes about 1 s after the drop); the next one, about 2 s
  // later, goes through, so the outage stays well below the 10 s fallback.
  await expect.poll(() => refused, { intervals: [50] }).toBeGreaterThan(0);

  blocked = false;
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(page.getByTestId("display-bulletin")).toContainText(title, { timeout: 5000 });
  const seen = (await page.evaluate(() => (window as Probe).__seen))!;
  expect(seen.back, "the channel came back").not.toBeNull();
  expect(seen.shown, "the banner showed the bulletin").not.toBeNull();
  // The drop was shorter than the fallback's 10 s, so only the re-read on reconnect can have shown it: after the
  // channel was back (never while it was down), and within 5 s of it.
  expect(seen.back! - droppedAt, "the outage was shorter than the 10 s fallback").toBeLessThan(10_000);
  expect(seen.shown!).toBeGreaterThanOrEqual(seen.back!);
  expect(seen.shown! - seen.back!).toBeLessThan(5000);
  expect(await sameWindow(page), "no reload").toBe(true);
});

test("a pause shows PAUSED and the pause banner; resuming clears them", async ({ page }) => {
  await screen(page);
  await ev.n.org("pause_event", ev.n.eventId);
  await expect(page.getByTestId("display-trading")).toHaveText("PAUSED", { timeout: 5000 });
  await expect(page.getByTestId("display-paused")).toBeVisible();
  await ev.n.org("resume_event", ev.n.eventId);
  await expect(page.getByTestId("display-trading")).toHaveText("HALTED", { timeout: 5000 });
  await expect(page.getByTestId("display-paused")).toHaveCount(0);
});

test("the draw takes over the screen live", async ({ page }) => {
  await screen(page);
  await expect(page.getByTestId("board")).toBeVisible();
  await drawn(ev);
  await expect(page.getByTestId("takeover")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "Squad draw" })).toBeVisible();
  await expect(page.getByTestId("board")).toHaveCount(0);
});

test("a pause shows during a takeover too", async ({ page }) => {
  // The draw takeover (3 minutes) is still up from the test before. A pause puts the amber strip on top of it (it is
  // the topmost element where it sits), the takeover stays; resuming removes the strip.
  await screen(page);
  const takeover = page.getByTestId("takeover");
  const strip = page.getByTestId("display-paused");
  await expect(takeover).toBeVisible();
  await expect(strip).toHaveCount(0);
  await ev.n.org("pause_event", ev.n.eventId);
  await expect(strip).toBeVisible({ timeout: 5000 });
  await expect(takeover).toBeVisible();
  await expect(page.getByRole("heading", { name: "Squad draw" })).toBeVisible();
  const box = (await strip.boundingBox())!;
  const top = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid=display-paused]") !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(top, "the strip is on top of the takeover").toBe(true);
  await ev.n.org("resume_event", ev.n.eventId);
  await expect(strip).toHaveCount(0, { timeout: 5000 });
  await expect(takeover).toBeVisible();
});

test("after a reload in the middle of the draw, the screen shows the rest of it, then the board", async ({ page }) => {
  await screen(page);
  await expect(page.getByTestId("takeover")).toBeVisible();
  // As if the draw had happened 170 s ago: a reload shows the last few seconds of it, then the board.
  await ev.n.q("update events set drawn_at = now() - interval '170 seconds' where id = $1", [ev.n.eventId]);
  await page.reload();
  await expect(page.getByTestId("takeover")).toBeVisible();
  await expect(page.getByTestId("board")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("takeover")).toHaveCount(0);
  await expect(page.getByTestId("display-phase")).toHaveText("Squad draw");
});

test("no team name is ever on the screen before the awards", async ({ page }) => {
  await screen(page);
  const text = await page.getByTestId("stage").innerText();
  for (const t of ev.plan.teams) expect(text, t.code).not.toContain(t.name);
});
