import { expect, test, type Locator, type Page } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// A Consulting team's calls (on a phone) and its earnings, through a whole night moved with the real game functions:
// call 1 from the draw, judged at round 4; call 2 from the plan release, judged at the flash tier; call 3 from the
// flash release, judged at the closing price; then settlement pays the bonuses.
//
// Both rescue specs (this one and team-rescue) use the team-code prefix O, and team codes are unique across events:
// the two files take turns (an advisory lock held for the whole file), and each purges the other's event first.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
let turn: pg.PoolClient | undefined;
/** The consultant of squad 1 and its two covered companies, A and B in ticker order. */
let consultant: string;
let A: { id: string; ticker: string };
let B: { id: string; ticker: string };

test.beforeAll(async () => {
  test.setTimeout(420_000);
  turn = await e2ePool().connect();
  await turn.query("select pg_advisory_lock(hashtext('e2e:team-code-prefix:O'))");
  await e2ePool().query("select public.purge_event($1)", ["e2e-team-rescue"]);
  ev = await seedE2eEvent({ slug: "e2e-team-calls", prefix: "O" });
});

test.afterAll(async () => {
  await turn?.query("select pg_advisory_unlock_all()");
  turn?.release();
});

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
const callsOf = async (no: number) =>
  ev.n.q<{ company_id: string; direction: string | null }>("select company_id, direction from calls where consultant_team_id = $1 and call_no = $2", [ev.n.teamId(consultant), no]);
const directionOn = async (no: number, companyId: string) => (await callsOf(no)).find((c) => c.company_id === companyId)?.direction ?? null;

async function phone(page: Page) {
  await page.context().clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, consultant);
  await page.goto("/team/calls");
}

const row = (page: Page, no: number, label: string): Locator => page.getByTestId(`call-${no}-${label}`);

test("before the draw the calls wait for it; after it, call 1 is open on two numbered companies", async ({ page }) => {
  consultant = ev.plan.teams.find((t) => t.track === "CONSULTING")!.code;
  await phone(page);
  await expect(page).toHaveTitle(/Calls/);
  await expect(page.getByRole("main")).toContainText("Your two covered companies are assigned at the squad draw.");

  s = await drawn(ev);
  consultant = s[0]!.c_code;
  await phone(page);
  await expect(page.getByTestId("call-1")).toHaveAttribute("data-stage", "OPEN");
  await expect(page.getByTestId("call-2")).toHaveAttribute("data-stage", "NOT_OPEN");
  await expect(page.getByTestId("call-3")).toHaveAttribute("data-stage", "NOT_OPEN");
  await expect(page.getByRole("main")).toContainText("public from the Reading phase");
  // Before Reading the covered companies are not public: they are numbered.
  const first = row(page, 1, "Covered company 1");
  await expect(first).toContainText("No call yet");
  await first.getByRole("button", { name: "BUY" }).click();
  await expect(first.getByRole("status")).toContainText("Call 1 on Covered company 1: BUY. You can change it until it closes at");
  await expect(first.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByTestId("call-current")).toContainText("Your call: BUY");
  await expect(row(page, 2, "Covered company 1").getByRole("button")).toHaveCount(0);
  await noSideScroll(page);
});

test("in Reading the companies are named; a call can be changed until it is due, then the open page closes it", async ({ page }) => {
  await ev.n.advanceTo("BUILD");
  const letters = "ABC";
  for (const [i, x] of s.entries()) {
    await ev.n.ok(ev.n.team(x.p_code), "save_draft", "PITCH", {
      company_name: `Company ${i + 1}`,
      ticker: `EO${letters[i]}`,
      problem: "Unsafe water in small towns.",
      solution: "Sensors in every tank.",
      customers: "Town councils.",
      business_model: "Yearly subscription.",
      advantage: "Cheaper than lab tests.",
      use_of_seed: "First 100 sensors.",
    }, 0);
    await ev.n.ok(ev.n.team(x.p_code), "submit_submission", "PITCH");
  }
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  const covered = await ev.n.q<{ id: string; ticker: string }>(
    "select c.id, c.ticker from coverage v join companies c on c.id = v.company_id where v.consultant_team_id = $1 order by c.ticker",
    [ev.n.teamId(consultant)],
  );
  [A, B] = [covered[0]!, covered[1]!];
  const firstCalled = (await callsOf(1)).find((c) => c.direction === "BUY")!.company_id;

  await phone(page);
  await expect(page.getByRole("main")).not.toContainText("Covered company");
  const called = firstCalled === A.id ? A : B;
  await expect(row(page, 1, called.ticker).getByTestId("call-current")).toContainText("Your call: BUY");
  // A SELL on the other company, and the first changed to SELL and back to BUY.
  const other = called === A ? B : A;
  await row(page, 1, other.ticker).getByRole("button", { name: "SELL" }).click();
  await expect(row(page, 1, other.ticker).getByTestId("call-current")).toContainText("Your call: SELL");
  await row(page, 1, called.ticker).getByRole("button", { name: "SELL" }).click();
  await expect(row(page, 1, called.ticker).getByTestId("call-current")).toContainText("Your call: SELL");
  await row(page, 1, called.ticker).getByRole("button", { name: "BUY" }).click();
  await expect(row(page, 1, called.ticker).getByTestId("call-current")).toContainText("Your call: BUY");
  // Make A the BUY and B the SELL, whichever was called first.
  if (called !== A) {
    await row(page, 1, A.ticker).getByRole("button", { name: "BUY" }).click();
    await expect(row(page, 1, A.ticker).getByTestId("call-current")).toContainText("Your call: BUY");
    await row(page, 1, B.ticker).getByRole("button", { name: "SELL" }).click();
    await expect(row(page, 1, B.ticker).getByTestId("call-current")).toContainText("Your call: SELL");
  }
  expect([await directionOn(1, A.id), await directionOn(1, B.id)]).toEqual(["BUY", "SELL"]);

  // Due in a few seconds: the open page closes the call by the server clock, then re-reads it.
  await ev.n.q("update deadlines set at = now() + interval '6 seconds' where event_id = $1 and code = 'CALL_1'", [ev.n.eventId]);
  await page.reload();
  await expect(row(page, 1, A.ticker).getByRole("button", { name: "SELL" })).toBeEnabled();
  await expect(page.getByTestId("call-1-due")).toHaveAttribute("data-state", "OPEN");
  await expect(row(page, 1, A.ticker).getByRole("button", { name: "SELL" })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("call-1-due")).toHaveAttribute("data-state", "PASSED");
  await expect(page.getByTestId("call-1")).toHaveAttribute("data-stage", "CLOSED");
  await expect(row(page, 1, A.ticker).getByTestId("call-current")).toContainText("Your call: BUY");
  await expect(row(page, 1, A.ticker).getByTestId("call-current")).toContainText("closed, awaiting judging");
  expect(await ev.n.call(ev.n.team(consultant), "make_call", A.id, 1, "SELL")).toMatchObject({ ok: false, code: "CALL_CLOSED" });
});

test("call 1 is judged at the round 4 price: baseline, judged price, right or wrong, $2,500", async ({ page }) => {
  for (const x of s) await ev.n.judge(x.company_id, "PITCH", [60, 60, 60]);
  await ev.n.org("release_scores", ev.n.eventId, "PITCH");
  await ev.n.advanceTo("IPO");
  await ev.n.advanceTo("ROUNDS_1_4");
  // A fund outside A's squad buys 1,000 A in round 1: +1%, $10.50 → $10.61. B does not move.
  const fund = s.find((x) => x.company_id !== A.id)!.f_code;
  await ev.n.openRound(1);
  await ev.n.ok(ev.n.team(fund), "place_order", A.id, "BUY", 1000);
  await ev.n.clearRound(1);
  // Advancing to the crisis clears rounds 2–4; call 1 is judged when round 4 clears.
  await ev.n.advanceTo("CRISIS");

  await phone(page);
  await expect(page.getByTestId("call-1")).toHaveAttribute("data-stage", "JUDGED");
  await expect(row(page, 1, A.ticker).getByTestId("call-result")).toHaveText("BUY · baseline $10.50 → judged $10.61 · Correct · $2,500.00");
  await expect(row(page, 1, B.ticker).getByTestId("call-result")).toHaveText("SELL · baseline $10.50 → judged $10.50 · Wrong · $0.00");
  await expect(page.getByRole("main")).toContainText("2 of 6");
  await noSideScroll(page);
});

test("call 2 opens at the plan release and is judged at the flash tier; call 3 at the closing price", async ({ page }) => {
  test.setTimeout(240_000);
  // The consultant's squad agrees a fee ($20,000 + 1,000 shares) and signs a deal in time for the bonus.
  const x = s[0]!;
  const fee = (await ev.n.ok(ev.n.team(x.c_code), "propose_fee", 2_000_000, 1000)).fee;
  await ev.n.ok(ev.n.team(x.p_code), "confirm_fee", fee.version);
  await ev.n.ok(ev.n.team(x.c_code), "confirm_fee", fee.version);
  await ev.n.ok(ev.n.team(x.c_code), "edit_deal", null, 750);
  const deal = (await ev.n.ok(ev.n.team(x.f_code), "edit_deal", 6_000_000, null)).deal;
  for (const code of [x.p_code, x.c_code, x.f_code]) await ev.n.ok(ev.n.team(code), "sign_deal", deal.version);

  for (const phase of ["RESCUE_1", "BREAK", "RESCUE_2", "PLANS_PUBLISHED", "VERDICTS"]) await ev.n.advanceTo(phase);
  // No plan was submitted: every plan scores 0 (−20%).
  await ev.n.org("seal_missing_scores", ev.n.eventId, "PLAN");
  await phone(page);
  await expect(page.getByTestId("call-2")).toHaveAttribute("data-stage", "NOT_OPEN");
  await expect(page.getByTestId("call-2")).toContainText("Opens when the plan scores are released.");
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  await ev.n.org("release_scores", ev.n.eventId, "PLAN");
  // The release is broadcast: the open page re-reads itself.
  await expect(page.getByTestId("call-2")).toHaveAttribute("data-stage", "OPEN");
  await row(page, 2, A.ticker).getByRole("button", { name: "BUY" }).click();
  await expect(row(page, 2, A.ticker).getByTestId("call-current")).toContainText("Your call: BUY");
  await row(page, 2, B.ticker).getByRole("button", { name: "SELL" }).click();
  await expect(row(page, 2, B.ticker).getByTestId("call-current")).toContainText("Your call: SELL");

  // The plan bonus is known once the plan scores are released.
  await page.goto("/team/earnings");
  await expect(page.getByTestId("earnings-plan-bonus")).toContainText("Plan bonus: plan score 0");
  await expect(page.getByTestId("earnings-plan-bonus").getByTestId("amount")).toHaveText("−$10,000.00");
  await expect(page.getByTestId("earnings-plan-bonus")).toContainText("no plan submitted on time");

  // Rounds 13–17, no flash answers (0: −5%), the flash tier: call 2 is judged and call 3 opens.
  await ev.n.advanceTo("ROUNDS_13_21");
  for (const r of [13, 14, 15, 16, 17]) {
    await ev.n.openRound(r);
    await ev.n.clearRound(r);
  }
  await ev.n.deadlinePassed("FLASH");
  await ev.n.org("seal_missing_scores", ev.n.eventId, "FLASH");
  await ev.n.org("release_scores", ev.n.eventId, "FLASH");
  await page.goto("/team/calls");
  await expect(page.getByTestId("call-2")).toHaveAttribute("data-stage", "JUDGED");
  // A: $10.61 → crisis $9.02 → plan −20% $7.22 → flash −5% $6.86. B: $10.50 → $8.93 → $7.14 → $6.78.
  await expect(row(page, 2, A.ticker).getByTestId("call-result")).toHaveText("BUY · baseline $7.22 → judged $6.86 · Wrong · $0.00");
  await expect(row(page, 2, B.ticker).getByTestId("call-result")).toHaveText("SELL · baseline $7.14 → judged $6.78 · Correct · $2,500.00");
  await expect(page.getByTestId("call-3")).toHaveAttribute("data-stage", "OPEN");
  await row(page, 3, A.ticker).getByRole("button", { name: "SELL" }).click();
  await expect(row(page, 3, A.ticker).getByTestId("call-current")).toContainText("Your call: SELL");
  await row(page, 3, B.ticker).getByRole("button", { name: "BUY" }).click();
  await expect(row(page, 3, B.ticker).getByTestId("call-current")).toContainText("Your call: BUY");

  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
  // The close: A's closing price (market $6.86 + AI $6.78) ÷ 2 = $6.82; B's (6.78 + 6.78) ÷ 2 = $6.78, equal: wrong.
  await ev.n.advanceTo("CLOSE");
  await expect(page.getByTestId("call-3")).toHaveAttribute("data-stage", "JUDGED");
  await expect(row(page, 3, A.ticker).getByTestId("call-result")).toHaveText("SELL · baseline $6.86 → judged $6.82 · Correct · $2,500.00");
  await expect(row(page, 3, B.ticker).getByTestId("call-result")).toHaveText("BUY · baseline $6.78 → judged $6.78 · Wrong · $0.00");
  await expect(page.getByRole("main")).toContainText("6 of 6");
  await expect(page.getByRole("button", { name: /^(BUY|SELL)$/ })).toHaveCount(0);
  await noSideScroll(page);
});

test("after settlement the earnings are final: fee, fee shares at the closing price, bonuses and calls, paid in cash", async ({ page }) => {
  await ev.n.advanceTo("SETTLEMENT");
  await phone(page);
  await page.goto("/team/earnings");
  const line = (key: string) => page.getByTestId(`earnings-${key}`);
  await expect(line("fee-cash").getByTestId("amount")).toHaveText("$20,000.00");
  // The consultant's own squad company: $10.50 → $8.93 → $7.14 → $6.78, closing $6.78.
  await expect(line("fee-shares")).toContainText("Fee shares: 1,000 × closing price");
  await expect(line("fee-shares").getByTestId("amount")).toHaveText("$6,780.00");
  await expect(line("fee-shares")).toHaveAttribute("data-status", "FINAL");
  await expect(line("deal-bonus").getByTestId("amount")).toHaveText("$5,000.00");
  await expect(line("plan-bonus").getByTestId("amount")).toHaveText("−$10,000.00");
  for (const l of await page.getByRole("list", { name: "Earnings breakdown" }).getByRole("listitem").all()) await expect(l).toHaveAttribute("data-status", "FINAL");
  // $20,000 + $6,780 + $5,000 − $10,000 + 3 × $2,500 = $29,280.
  await expect(page.getByTestId("earnings-secured")).toHaveText("$29,280.00");
  await expect(page.getByText("Final total")).toBeVisible();
  await expect(page.getByTestId("earnings-paid")).toContainText("+$2,500.00");
  // The settlement's own figure agrees: cash + fee shares × closing price.
  const r = await ev.n.one("select final_value_cents from results where team_id = $1", [ev.n.teamId(consultant)]);
  expect(Number(r.final_value_cents)).toBe(2_928_000);
  await noSideScroll(page);
});
