import { expect, test, type Page } from "@playwright/test";
import type { PoolClient } from "pg";
import { formatCents } from "@msim/engine";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The common sections' three specs share the team-code prefix C, and team codes (the logins) are unique across
// events, so only one of their events may exist at a time: each spec holds this lock from seeding to its end and
// first removes the other two specs' events.
const OURS = ["e2e-team-home", "e2e-team-market", "e2e-team-qa"];
let lock: PoolClient | undefined;
async function seedAlone(slug: string): Promise<E2eEvent> {
  lock = await e2ePool().connect();
  await lock.query("select pg_advisory_lock(hashtext('e2e-team-common-C'))");
  for (const other of OURS) if (other !== slug) await lock.query("select public.purge_event($1)", [other]);
  return seedE2eEvent({ slug, prefix: "C" });
}
test.afterAll(async () => {
  await lock?.query("select pg_advisory_unlock(hashtext('e2e-team-common-C'))");
  lock?.release();
});

let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
const ticker = (i: number) => `EC${"ABC"[i]}`;
const ist = (t: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const deadline = async (code: string) => ist((await ev.n.one("select at from deadlines where event_id = $1 and code = $2", [ev.n.eventId, code])).at);
const cashOf = async (code: string) => formatCents(Number((await ev.n.one("select cash_cents from teams where code = $1", [code])).cash_cents));

test.beforeAll(async () => {
  test.setTimeout(600_000); // may wait for another common spec to finish
  ev = await seedAlone("e2e-team-home");
});

const task = (page: Page, key: string) => page.getByTestId(`task-${key}`);
const holdingRows = (page: Page) => page.getByRole("region", { name: "Your holdings" }).locator("tbody tr");
const comingUp = (page: Page) => page.getByRole("list", { name: "Coming up" }).getByRole("listitem");

async function home(page: Page, code: string) {
  await page.context().clearCookies();
  await loginAsTeam(page, ev, code);
  await page.goto("/team");
}

test("before the draw: when it happens, nothing to do yet, no squad and no shares", async ({ page }) => {
  const draw = ist((await ev.n.one("select starts_at from phases where event_id = $1 and code = 'SQUAD_DRAW'", [ev.n.eventId])).starts_at);
  const product = ev.plan.teams.find((t) => t.track === "PRODUCT")!.code;
  await home(page, product);
  await expect(page.getByTestId("home-idle")).toHaveText(`Check in and listen to the briefing. The squad draw is at ${draw}; your squad, company and tasks appear here after it.`);
  await expect(page.getByTestId("home-squad")).toHaveText(`Not drawn yet. Squads are drawn at ${draw}.`);
  await expect(comingUp(page).first()).toContainText(`Squad draw: your squad and company${draw}`);
  await expect(comingUp(page).nth(1)).toContainText(`Problem card pick closes${await deadline("PROBLEM_PICK")}`);
  await expect(comingUp(page).nth(1).getByRole("link", { name: "Problem card pick closes" })).toHaveAttribute("href", "/team/squad");
  await expect(page.getByText("Shares are issued at the squad draw.")).toBeVisible();
  await expect(page.getByTestId("home-cash")).toHaveText("$0.00");
  await expect(page.getByText("No bulletins yet.")).toBeVisible();
});

test("after the draw: each track's tasks with countdowns and links, its squad and its shares", async ({ page }) => {
  s = await drawn(ev);
  const a = s[0]!;
  const pick = await deadline("PROBLEM_PICK");

  await home(page, a.p_code);
  const pickTask = task(page, "PROBLEM_PICK");
  await expect(pickTask.getByRole("heading")).toHaveText("Pick your problem card");
  await expect(pickTask).toHaveAttribute("data-state", "todo");
  await expect(pickTask).toContainText(`Choose one of the three cards dealt to your squad by ${pick}; otherwise the first card is assigned.`);
  await expect(pickTask).toContainText(`Problem card pick · ${pick}`);
  await expect(pickTask.locator(".font-mono").last()).toHaveText(/^\d+:\d\d(:\d\d)?$/); // the live countdown
  await expect(pickTask.getByRole("link", { name: "Open Squad" })).toHaveAttribute("href", "/team/squad");
  await expect(task(page, "PITCH").getByRole("heading")).toHaveText("Write and submit your pitch card");
  await expect(page.getByTestId("home-squad")).toHaveText("Squad 01");
  await expect(page.getByTestId("home-company")).toHaveText("Named, with its ticker, on the pitch card (by the pitch deadline).");
  await expect(page.getByTestId("home-cash")).toHaveText("$50,000.00");
  await expect(holdingRows(page)).toHaveCount(1);
  await expect(holdingRows(page).first().getByRole("cell")).toHaveText(["Your squad's company", "Retained (locked)", "60,000", "—", "—"]);
  await expect(page.getByTestId("home-holdings-value")).toHaveText("—");
  await expect(page.getByText("1 line without a price until the IPO")).toBeVisible();

  // The pick, made: done, and it can still be changed until the deadline.
  await ev.n.ok(ev.n.team(a.p_code), "pick_problem_card", a.dealt_card_ids[1]);
  await page.reload();
  await expect(pickTask).toHaveAttribute("data-state", "done");
  await expect(pickTask).toContainText(`Picked. You can change it until ${pick}.`);

  await home(page, a.c_code);
  const call = task(page, "CALL_1");
  await expect(call.getByRole("heading")).toHaveText("Make call 1 on your two companies");
  await expect(call).toContainText("BUY or SELL against the IPO price: 0 of 2 made.");
  await expect(call.getByRole("link", { name: "Open Calls" })).toHaveAttribute("href", "/team/calls");
  await expect(task(page, "PROBLEM_PICK").getByRole("heading")).toHaveText("Your Product partner picks the problem card");
  await expect(task(page, "PITCH").getByRole("heading")).toHaveText("Help with the pitch card");
  await expect(page.getByText("No shares.")).toBeVisible();

  await home(page, a.f_code);
  await expect(page.getByTestId("home-idle")).toHaveText("Nothing needs doing right now. Watch the bulletins and the market.");
  await expect(comingUp(page).getByRole("link", { name: "IPO bids close" })).toHaveAttribute("href", "/team/trade");
  await expect(page.getByTestId("home-cash")).toHaveText("$450,000.00");
  await expect(page.getByText("Collateral locked").last()).toBeVisible();
  await expect(holdingRows(page).first().getByRole("cell")).toHaveText(["Your squad's company", "Squad lot", "5,000", "—", "—"]);
});

test("Reading and the IPO: read the book, a question waits for its answer, then place IPO bids", async ({ page }) => {
  await ev.n.advanceTo("BUILD");
  await ev.n.deadlinePassed("PROBLEM_PICK"); // 21:10: the pick closes (it stays open until then, whatever the phase)
  const letters = "ABC";
  for (const [i, x] of s.entries()) {
    const p = ev.n.team(x.p_code);
    await ev.n.ok(p, "save_draft", "PITCH", {
      company_name: `Company ${i + 1}`,
      ticker: `EC${letters[i]}`,
      problem: "Unsafe water in small towns.",
      solution: "Sensors in every tank.",
      customers: "Town councils.",
      business_model: "Yearly subscription.",
      advantage: "Cheaper than lab tests.",
      use_of_seed: "First 100 sensors.",
    }, 0);
    await ev.n.ok(p, "submit_submission", "PITCH");
  }
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");

  await home(page, s[1]!.f_code);
  await expect(task(page, "READ").getByRole("link", { name: "Read the pitch book" })).toHaveAttribute("href", "/team/market/book");
  await expect(task(page, "QA").getByRole("heading")).toHaveText("Ask questions on the Q&A board");

  // A fund asks the first company; its Product team's Home counts it at once (the board's broadcast).
  await home(page, s[0]!.p_code);
  await expect(task(page, "QA")).toContainText("No question is waiting for an answer.");
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await ev.n.ok(ev.n.team(s[1]!.f_code), "post_question", s[0]!.company_id, "How many towns have signed?");
  await expect(task(page, "QA")).toContainText("1 question without an answer yet.");
  await expect(task(page, "QA")).toHaveAttribute("data-state", "todo");
  await expect(task(page, "QA").getByRole("link", { name: "Open Q&A" })).toHaveAttribute("href", "/team/qa");
  await expect(page.getByTestId("home-company")).toContainText("Company 1 (ECA)");

  for (const x of s) await ev.n.judge(x.company_id, "PITCH", [60, 60, 60]);
  await ev.n.deadlinePassed("CALL_1");
  await ev.n.org("release_scores", ev.n.eventId, "PITCH");
  await ev.n.advanceTo("IPO");

  const a = s[0]!;
  await home(page, a.f_code);
  const ipo = task(page, "IPO_BIDS");
  await expect(ipo.getByRole("heading")).toHaveText("Place IPO bids");
  await expect(ipo).toContainText(`IPO bids · ${await deadline("IPO_BIDS")}`);
  await expect(ipo.getByRole("link", { name: "Open Trade" })).toHaveAttribute("href", "/team/trade");
  await expect(ipo).toHaveAttribute("data-state", "todo");
  await expect(holdingRows(page).first().getByRole("cell")).toHaveText([ticker(0), "Squad lot", "5,000", "$10.50", "$52,500.00"]);
  await ev.n.ok(ev.n.team(a.f_code), "place_ipo_bid", s[1]!.company_id, 1000);
  await page.reload();
  await expect(ipo).toHaveAttribute("data-state", "done");
  await expect(ipo).toContainText(`1 bid placed; you can change them until ${await deadline("IPO_BIDS")}.`);
});

test("trading: the open round, and holdings per company and lot at market prices, a short as a liability", async ({ page }) => {
  const a = s[0]!;
  await ev.n.advanceTo("ROUNDS_1_4"); // allocates the IPO: 1,000 shares, not oversubscribed
  await ev.n.openRound(1);
  await home(page, a.f_code);
  const round = task(page, "ROUND");
  await expect(round.getByRole("heading")).toHaveText("Trade: round 1 is open");
  await expect(round).toContainText("Round 1 closes");
  await expect(round.getByRole("link", { name: "Open Trade" })).toHaveAttribute("href", "/team/trade");

  await ev.n.ok(ev.n.team(a.f_code), "place_order", s[2]!.company_id, "SHORT", 100);
  await ev.n.clearRound(1);
  await page.reload();
  const price = async (i: number) => Number((await ev.n.one("select market_price from companies where id = $1", [s[i]!.company_id])).market_price);
  const [p0, p1, p2] = [await price(0), await price(1), await price(2)];
  expect([p0, p1, p2]).toEqual([1050, 1050, 1049]); // net −100: −0.1%
  await expect(holdingRows(page)).toHaveCount(3);
  await expect(holdingRows(page).nth(0).getByRole("cell")).toHaveText([ticker(0), "Squad lot", "5,000", "$10.50", "$52,500.00"]);
  await expect(holdingRows(page).nth(1).getByRole("cell")).toHaveText([ticker(1), "Exchange", "1,000", "$10.50", "$10,500.00"]);
  await expect(holdingRows(page).nth(2).getByRole("cell")).toHaveText([ticker(2), "Short", "100", "$10.49", "−$1,049.00"]);
  await expect(page.getByTestId("home-holdings-value")).toHaveText("$61,951.00");
  await expect(page.getByText("A short is shares owed: its value is what covering it would cost now.")).toBeVisible();
  await expect(page.getByTestId("home-cash")).toHaveText(await cashOf(a.f_code));
  const collateral = formatCents(Number((await ev.n.one("select collateral_cents from teams where code = $1", [a.f_code])).collateral_cents));
  expect(collateral).toBe("$1,573.50"); // 150% × 100 × $10.49
  await expect(page.locator("main").getByText(collateral)).toBeVisible();
  await expect(comingUp(page).getByRole("link", { name: "Round 2 opens" })).toHaveAttribute("href", "/team/trade");
});

test("bulletins: every published one newest first with its kind, the latest 3 on Home, live", async ({ page }) => {
  const c = s[0]!.c_code;
  await home(page, c);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Bulletins" }).click();
  await expect(page).toHaveURL(/\/team\/bulletins$/);
  await expect(page.getByText("No bulletins yet.")).toBeVisible();
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Doors open", "Welcome to the night.");
  await expect(page.getByRole("article", { name: "General bulletin: Doors open" })).toBeVisible(); // without a reload
  await ev.n.org("publish_bulletin", ev.n.eventId, "CRISIS", "Supply shock", "Every company is hit at 00:30.");
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Round 2 soon", "Get ready.");
  await ev.n.org("publish_bulletin", ev.n.eventId, "FAIRNESS", "Play fair", "Collusion is flagged.");

  const list = page.getByRole("list", { name: "Bulletins" }).getByRole("article");
  await expect(list).toHaveCount(4);
  await expect(list.getByRole("heading")).toHaveText(["Play fair", "Round 2 soon", "Supply shock", "Doors open"]);
  await expect(page.getByRole("heading", { name: "Bulletins (4)" })).toBeVisible();
  const crisis = page.getByRole("article", { name: /bulletin: Supply shock$/ });
  await expect(crisis).toHaveAttribute("data-kind", "CRISIS");
  await expect(crisis).toHaveCSS("border-left-width", "4px"); // CRISIS and FLASH stand out
  await expect(page.getByRole("article", { name: /bulletin: Round 2 soon$/ })).toHaveCSS("border-left-width", "0px");
  await expect(crisis).toContainText("Every company is hit at 00:30.");

  await page.goto("/team");
  const latest = page.getByRole("list", { name: "Latest bulletins" }).getByRole("article");
  await expect(latest.getByRole("heading")).toHaveText(["Play fair", "Round 2 soon", "Supply shock"]);
  await expect(page.getByRole("link", { name: "All bulletins" })).toHaveAttribute("href", "/team/bulletins");
});

test("the rescue: the fee for Product and Consulting, the deal for all three, each with its own state", async ({ page }) => {
  const a = s[0]!;
  await ev.n.advanceTo("CRISIS");
  const fee = await deadline("FEE");

  await home(page, a.p_code);
  await expect(page.getByRole("list", { name: "What to do now" }).getByRole("heading")).toHaveText([
    "Agree the advisor fee",
    "Sign the rescue deal",
    "Write and submit the rescue plan",
    "Answer questions about your company",
  ]);
  const feeTask = task(page, "FEE");
  await expect(feeTask).toContainText(`Without it, $22,500 cash is paid by default at ${fee}.`);
  await expect(feeTask.getByRole("link", { name: "Open Rescue" })).toHaveAttribute("href", "/team/rescue");

  const proposed = await ev.n.ok(ev.n.team(a.c_code), "propose_fee", 2_000_000, 0);
  await page.reload();
  await expect(feeTask).toContainText(`Terms are on the table: check them and confirm by ${fee}, or propose others.`);
  await ev.n.ok(ev.n.team(a.p_code), "confirm_fee", proposed.fee.version);
  await page.reload();
  await expect(feeTask).toHaveAttribute("data-state", "waiting");
  await expect(feeTask).toContainText(`You confirmed; waiting for your Consulting partner to confirm by ${fee}.`);
  await ev.n.ok(ev.n.team(a.c_code), "confirm_fee", proposed.fee.version);
  await page.reload();
  await expect(feeTask).toHaveAttribute("data-state", "done");
  await expect(feeTask).toContainText("Agreed and paid.");
  await expect(page.getByTestId("home-cash")).toHaveText("$30,000.00");

  await home(page, a.c_code);
  const broker = task(page, "DEAL");
  await expect(broker.getByRole("heading")).toHaveText("Broker the rescue deal");
  await expect(broker).toContainText(`Deal bonus cut-off · ${await deadline("DEAL_BONUS")}`);
  await expect(broker).toContainText("Propose the price per share (50%–100% of the post-crisis price)");
  await expect(page.getByText("No shares.")).toBeVisible(); // a cash-only fee moves no shares
  await expect(page.getByTestId("home-cash")).toHaveText("$20,000.00");

  await home(page, a.f_code);
  const deal = task(page, "DEAL");
  await expect(deal.getByRole("heading")).toHaveText("Set the deal amount and sign");
  await expect(deal).toContainText(`Rescue deal · ${await deadline("DEAL")}`);
  await expect(task(page, "FEE")).toHaveCount(0); // the fee is Product's and Consulting's
});

test("on a phone (390 px) Home and Bulletins fit without sideways scrolling; tables scroll inside their panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page, s[0]!.f_code);
  await expect(task(page, "DEAL")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your holdings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const region = page.getByRole("region", { name: "Your holdings" });
  expect(await region.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  await page.goto("/team/bulletins");
  await expect(page.getByRole("list", { name: "Bulletins" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
