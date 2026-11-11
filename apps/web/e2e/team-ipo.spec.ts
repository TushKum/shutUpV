import { expect, test, type Page } from "@playwright/test";
import type { PoolClient } from "pg";
import { allocateIpo, mul } from "@msim/engine";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { pitchesReleased } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The finance specs share the team-code prefix R, and team codes (the logins) are unique across events, so only one
// of their events may exist at a time: each spec holds this lock from seeding to its end and first removes the other
// spec's event.
const OURS = ["e2e-team-trade", "e2e-team-ipo"];
let lock: PoolClient | undefined;
async function seedAlone(slug: string, squads = 3): Promise<E2eEvent> {
  lock = await e2ePool().connect();
  await lock.query("select pg_advisory_lock(hashtext('e2e-team-finance-R'))");
  for (const other of OURS) if (other !== slug) await lock.query("select public.purge_event($1)", [other]);
  return seedE2eEvent({ slug, prefix: "R", squads });
}
test.afterAll(async () => {
  await lock?.query("select pg_advisory_unlock(hashtext('e2e-team-finance-R'))");
  lock?.release();
});

// Ten squads (so that one company can be oversubscribed: 9 funds × 4,000 > 35,000): ERA (squad 1), ERB (squad 2), …
// Every IPO price is $10.50 (pitch 60 → +5%). The viewer is squad 1's fund, which may not bid for ERA.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof pitchesReleased>>;
let fund: string;
const ist = (t: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test.beforeAll(async () => {
  test.setTimeout(600_000); // may wait for the other finance spec to finish
  ev = await seedAlone("e2e-team-ipo", 10);
  s = await pitchesReleased(ev);
  fund = s[0]!.f_code;
});

async function as(page: Page, code: string, path: string) {
  await page.context().clearCookies();
  await loginAsTeam(page, ev, code);
  await page.goto(path);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
}
const row = (page: Page, ticker: string) => page.getByTestId(`ipo-${ticker}`);
const bid = async (code: string, companyId: string) =>
  (await ev.n.q("select qty_requested, price from ipo_bids b join teams t on t.id = b.team_id where t.code = $1 and b.company_id = $2", [code, companyId]))[0];
const noSidewaysScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

test("during Reading the fund is told when IPO bids open and close", async ({ page }) => {
  const ipo = (await ev.n.one("select starts_at from phases where event_id = $1 and code = 'IPO'", [ev.n.eventId])).starts_at;
  const due = (await ev.n.one("select at from deadlines where event_id = $1 and code = 'IPO_BIDS'", [ev.n.eventId])).at;
  await as(page, fund, "/team/trade/ipo");
  await expect(page.getByTestId("ipo-state")).toHaveText(
    `IPO bids open with the IPO at ${ist(ipo)} and close at ${ist(due)}, once the pitch scores have set every company's IPO price ($10.00 × (1 + pitch tier)).`,
  );
  await page.goto("/team/trade");
  await expect(page.getByTestId("trading-notice")).toContainText("Trading starts with round 1.");
});

test("IPO phase on a phone: every company but its own at its IPO price, checked as typed, saved, withdrawn", async ({ page }) => {
  await ev.n.advanceTo("IPO");
  await page.setViewportSize({ width: 390, height: 900 });
  await as(page, fund, "/team/trade/ipo");
  await expect(page.getByTestId("ipo-state")).toContainText("IPO bids are open until");
  await expect(page.getByRole("list", { name: "IPO bids" }).getByRole("listitem")).toHaveCount(9);
  await expect(row(page, "ERA")).toHaveCount(0);
  await expect(page.getByText("Your squad's company, ERA, is not offered to you")).toBeVisible();
  await expect(row(page, "ERB")).toContainText("IPO price $10.50");
  await expect(row(page, "ERB").getByTestId("ipo-saved")).toHaveText("No bid");

  const erb = row(page, "ERB");
  await erb.getByLabel("Shares of ERB").fill("5000");
  await expect(erb.getByText("The exchange would refuse this bid: Request 0 to 4,000 shares per company.")).toBeVisible();
  await expect(erb.getByRole("button", { name: "Save bid" })).toBeDisabled();
  await erb.getByRole("button", { name: "Max" }).click();
  await expect(erb.getByLabel("Shares of ERB")).toHaveValue("4000");
  await expect(erb.getByText("4,000 × $10.50 = $42,000.00. All your bids: $42,000.00; cash left at IPO prices $408,000.00.")).toBeVisible();
  await erb.getByRole("button", { name: "Save bid" }).click();
  await expect(row(page, "ERB").getByTestId("ipo-saved")).toHaveText("Your bid: 4,000 shares ($42,000.00)");
  expect(await bid(fund, s[1]!.company_id)).toEqual({ qty_requested: 4000, price: 1050 });
  await expect(page.getByTestId("ipo-committed")).toHaveText("$42,000.00");
  await expect(page.getByTestId("ipo-remaining")).toHaveText("$408,000.00");
  await noSidewaysScroll(page);

  // A zero bid withdraws.
  await row(page, "ERB").getByLabel("Shares of ERB").fill("0");
  await row(page, "ERB").getByRole("button", { name: "Withdraw bid" }).click();
  await expect(row(page, "ERB").getByTestId("ipo-saved")).toHaveText("No bid");
  expect(await bid(fund, s[1]!.company_id)).toEqual({ qty_requested: 0, price: 1050 });
  await row(page, "ERB").getByLabel("Shares of ERB").fill("4,000");
  await row(page, "ERB").getByRole("button", { name: "Save bid" }).click();
  await expect(row(page, "ERB").getByTestId("ipo-saved")).toHaveText("Your bid: 4,000 shares ($42,000.00)");

  // A bid saved on the fund's other device sends no broadcast: the open page re-reads itself within 10 s.
  await ev.n.ok(ev.n.team(fund), "place_ipo_bid", s[3]!.company_id, 100);
  await expect(row(page, "ERD").getByTestId("ipo-saved")).toHaveText("Your bid: 100 shares ($1,050.00)", { timeout: 20_000 });
  await expect(page.getByTestId("ipo-committed")).toHaveText("$43,050.00");
  await ev.n.ok(ev.n.team(fund), "place_ipo_bid", s[3]!.company_id, 0);
  await expect(row(page, "ERD").getByTestId("ipo-saved")).toHaveText("No bid", { timeout: 20_000 });
});

test("the whole book must fit the cash: the preview and Max agree with the database", async ({ page }) => {
  // A fund cannot reach this with real bids (9 × 4,000 × $10.50 < $450,000), so its cash is lowered (test only).
  const cash = (await ev.n.one("select cash_cents from teams where code = $1", [fund])).cash_cents;
  await ev.n.q("update teams set cash_cents = 5000000 where code = $1", [fund]);
  try {
    await as(page, fund, "/team/trade/ipo");
    const erc = row(page, "ERC");
    await erc.getByLabel("Shares of ERC").fill("1000");
    await expect(erc.getByText("The exchange would refuse this bid: Your total requests cost more than your cash at IPO prices.")).toBeVisible();
    expect(await ev.n.call(ev.n.team(fund), "place_ipo_bid", s[2]!.company_id, 762)).toMatchObject({ ok: false, code: "INSUFFICIENT_CASH" });
    // ($50,000 − $42,000) ÷ $10.50 = 761.9…: 761 shares.
    await erc.getByRole("button", { name: "Max" }).click();
    await expect(erc.getByLabel("Shares of ERC")).toHaveValue("761");
    await expect(erc.getByText("cash left at IPO prices $9.50.")).toBeVisible();
    await erc.getByRole("button", { name: "Save bid" }).click();
    await expect(row(page, "ERC").getByTestId("ipo-saved")).toHaveText("Your bid: 761 shares ($7,990.50)");
    expect(await bid(fund, s[2]!.company_id)).toEqual({ qty_requested: 761, price: 1050 });
  } finally {
    await ev.n.q("update teams set cash_cents = $2 where code = $1", [fund, cash]);
  }
});

test("a pause stops the bids and says so; the deadline closes them", async ({ page }) => {
  await as(page, fund, "/team/trade/ipo");
  await ev.n.org("pause_event", ev.n.eventId);
  await expect(page.getByTestId("ipo-state")).toHaveText("The event is paused: IPO bids are refused until it resumes. The deadline moves later by the length of the pause.");
  await expect(page.getByLabel("Shares of ERB")).toHaveCount(0);
  expect(await ev.n.call(ev.n.team(fund), "place_ipo_bid", s[3]!.company_id, 10)).toMatchObject({ ok: false, code: "IPO_CLOSED" });
  await ev.n.org("resume_event", ev.n.eventId);
  await expect(page.getByLabel("Shares of ERB")).toBeVisible();

  // Every other fund that may bids 4,000 for ERB (squad 2's fund may not): 9 × 4,000 = 36,000 for 35,000 shares.
  for (const x of s.slice(2)) await ev.n.ok(ev.n.team(x.f_code), "place_ipo_bid", s[1]!.company_id, 4000);
  await ev.n.deadlinePassed("IPO_BIDS");
  const due = (await ev.n.one("select at from deadlines where event_id = $1 and code = 'IPO_BIDS'", [ev.n.eventId])).at;
  await page.reload();
  await expect(page.getByTestId("ipo-state")).toHaveText(`IPO bids closed at ${ist(due)}. Shares are allocated when round 1 starts; the bids below are final.`);
  await expect(page.getByRole("button", { name: "Save bid" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your IPO bids" })).toContainText("ERB$10.504,000$42,000.00");
});

test("after the allocation on a phone: the shares received and the cash paid, scaled down where oversubscribed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await as(page, fund, "/team/trade/ipo");
  const before = Number((await ev.n.one("select cash_cents from teams where code = $1", [fund])).cash_cents);
  await ev.n.advanceTo("ROUNDS_1_4"); // allocates the IPO and broadcasts
  await expect(page.getByRole("heading", { name: "IPO allocation" })).toBeVisible();

  // The database's allocation is the engine's.
  const book = await ev.n.q("select b.id, b.qty_requested as qty, b.qty_allocated from ipo_bids b where b.company_id = $1 order by b.id", [s[1]!.company_id]);
  const expected = allocateIpo(book.map((b) => ({ id: b.id, qty: b.qty })));
  expect(book.map((b) => b.qty_allocated)).toEqual(expected.map((e) => e.allocated));
  const mine = await ev.n.one("select qty_allocated from ipo_bids b join teams t on t.id = b.team_id where t.code = $1 and b.company_id = $2", [fund, s[1]!.company_id]);
  expect(mine.qty_allocated).toBe(3880); // 4,000 × 35,000 ÷ 36,000 = 3,888.9 → 3,880

  const paid = mul(3880, 1050) + mul(761, 1050);
  await expect(page.getByTestId("allocation-ERB")).toContainText(`ERB3,880${usd(mul(3880, 1050))}4,000$10.50Scaled down: 36,000 requested for 35,000`);
  await expect(page.getByTestId("allocation-ERC")).toContainText("ERC761$7,990.50761$10.50In full");
  await expect(page.getByTestId("ipo-received")).toHaveText("4,641");
  await expect(page.getByTestId("ipo-paid")).toHaveText(usd(paid));
  const after = Number((await ev.n.one("select cash_cents from teams where code = $1", [fund])).cash_cents);
  expect(before - after).toBe(paid);
  await expect(page.getByTestId("team-cash")).toHaveText(usd(after));
  await noSidewaysScroll(page);

  await page.getByRole("navigation", { name: "Trading views" }).getByRole("link", { name: "Positions" }).click();
  await expect(page.getByTestId("position-ERB-EXCHANGE")).toContainText(`ERB Exchange3,880${usd(mul(3880, 1050))}$0.00$10.50$10.50`);
  await expect(page.getByRole("region", { name: "Limits per company" })).toContainText("ERB3,880 of 4,0000 of 2,000");
});
