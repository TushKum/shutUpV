import { expect, test, type Page } from "@playwright/test";
import { seedE2eEvent, type E2eEvent } from "./support/event";
import { pitchesReleased } from "./support/game";
import { loginAsTeam } from "./support/login";

// A PRIMUS event's Round 2 as each track sees it: the banner names the crisis and shows its steps with the one that
// is on now, "Do this now" follows the team through hiring, writing and rating, and the crisis room is numbered steps.

let ev: E2eEvent;
const SHOTS = process.env.SHOTS;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(900); // the title's decode animation
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-primus-guidance", prefix: "", format: "PRIMUS" });
});

const step = (page: Page, key: string) => page.getByTestId("crisis-steps").first().locator(`[data-step=${key}]`);

test("Round 2: the banner, the tasks and the crisis room lead each track through a crisis", async ({ page }) => {
  test.setTimeout(240_000);
  const n = ev.n;
  const [a] = await pitchesReleased(ev);
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  await n.deadlinePassed("REVEAL_1");
  await n.ok(n.lead, "tick", n.eventId);
  await n.ok(n.team(a!.c_code), "save_firm_profile", "Food and campus operations", ["operations", "food safety"], "From $500 per crisis", 50000, "");

  // ── Product: Home says to hire a firm; the banner shows crisis 1 and its steps.
  await loginAsTeam(page, ev, a!.p_code);
  await expect(page.getByTestId("round-label")).toHaveText("Round 2 of 3 · Four crises");
  await expect(page.getByTestId("round-banner").getByRole("heading", { level: 2 })).toHaveText("Crisis 1 of 4");
  await expect(page.getByTestId("your-job")).toContainText("In each crisis: hire a firm, write your plan, then rate the firm.");
  await expect(step(page, "CARD")).toHaveAttribute("data-state", "done");
  await expect(step(page, "HIRE")).toHaveAttribute("data-state", "now");
  await expect(step(page, "HIRE")).toContainText("Hire a firm");
  await expect(step(page, "WORK")).toHaveAttribute("data-state", "later");
  const hire = page.getByTestId("task-HIRE");
  await expect(hire).toHaveAttribute("data-state", "todo");
  await expect(hire).toContainText("Hire a consulting firm");
  await expect(page.getByTestId("task-PLAN_K")).toContainText("Write and submit your plan for crisis 1");
  await shot(page, "01-product-home");

  // The crisis room: four numbered steps; hiring is the one to do now.
  await hire.getByRole("link", { name: "Choose a firm" }).click();
  await expect(page).toHaveURL(/\/team\/crisis$/);
  await expect(page.getByTestId("your-job")).toHaveCount(0); // the one-line banner on work pages
  await expect(page.getByTestId("round-label")).toHaveText("Round 2 of 3 · Four crises");
  await expect(page.getByTestId("step-card")).toContainText("Read your crisis card");
  await expect(page.getByTestId("step-hire")).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("step-plan")).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("step-rate")).toHaveAttribute("data-state", "closed");
  await shot(page, "02-product-crisis-room");
  const firm = page.getByTestId(`firm-${a!.c_code}`);
  await firm.getByText("Make an offer").click();
  await firm.getByLabel("Cash ($)").fill("500");
  await firm.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByTestId("step-hire")).toContainText("Offer sent. Waiting for the firm to answer");
  await shot(page, "03-product-offer-sent");

  // ── Consulting: an offer to answer; accepting makes the memo the task.
  await page.context().clearCookies();
  await loginAsTeam(page, ev, a!.c_code);
  await expect(page.getByTestId("your-job")).toContainText("In each crisis: win clients, then write an advice memo for each one.");
  await expect(step(page, "HIRE")).toContainText("Win clients");
  await expect(page.getByTestId("task-OFFERS")).toContainText("Answer 1 offer");
  await shot(page, "04-firm-home");
  await page.getByTestId("task-OFFERS").getByRole("link", { name: "See the offers" }).click();
  await expect(page.getByTestId("step-profile")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("step-offers")).toHaveAttribute("data-state", "now");
  await shot(page, "05-firm-crisis-room");
  await page.getByTestId("offer").getByRole("button", { name: "Accept" }).click();
  await page.getByTestId("offer").getByRole("button", { name: "Click again to accept these terms" }).click();
  await expect(page.getByTestId("step-clients")).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("client")).toContainText("Memo not sent");
  await shot(page, "06-firm-client");
  await page.goto("/team");
  await expect(page.getByTestId(`task-ADVICE_${a!.company_id}`)).toContainText("Write your advice memo for");

  // ── Product again: hired (done); after the due time, rating is the task.
  await page.context().clearCookies();
  await loginAsTeam(page, ev, a!.p_code);
  await expect(page.getByTestId("task-HIRE")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("task-HIRE")).toContainText(`You hired ${a!.c_code} for $500.00.`);
  await n.ok(n.team(a!.p_code), "save_draft", "CRISIS_1", { impact: "Half our boxes fail the new test.", response: "Serve inside two hours." }, 0);
  await n.ok(n.team(a!.p_code), "submit_submission", "CRISIS_1");
  await n.ok(n.team(a!.c_code), "save_draft_for", a!.company_id, "ADVICE_1", { diagnosis: "The late box is at risk.", advice: "Phase the chillers." }, 0);
  await n.ok(n.team(a!.c_code), "submit_for", a!.company_id, "ADVICE_1");
  await n.deadlinePassed("HIRE_1");
  await n.deadlinePassed("DUE_1");
  await n.ok(n.lead, "tick", n.eventId);
  await page.goto("/team");
  await expect(step(page, "RATE")).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("task-RATE_1")).toContainText("Rate your firm for crisis 1");
  await shot(page, "07-product-home-rate");
  await page.getByTestId("task-RATE_1").getByRole("link", { name: "Rate the firm" }).click();
  await expect(page.getByTestId("step-hire")).toContainText("The firm sent its memo, so the fee was paid.");
  await expect(page.getByTestId("step-plan")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("step-rate")).toHaveAttribute("data-state", "now");
  await page.getByTestId("rate-1").getByRole("button", { name: "★★★★★" }).click();
  await expect(page.getByTestId("step-rate")).toHaveAttribute("data-state", "done");
  await shot(page, "08-product-rated");

  // Scores released: Home's report card shows the plan's score, the price move and the stars given.
  await expect(page.getByTestId("crisis-report")).toHaveCount(0); // not on the crisis room
  await n.deadlinePassed("RATE_1");
  await n.ok(n.lead, "tick", n.eventId);
  await n.judge(a!.company_id, "CRISIS_1", [85, 85, 85]);
  await n.org("seal_missing_scores", n.eventId, "CRISIS_1");
  await n.org("release_scores", n.eventId, "CRISIS_1");
  await page.goto("/team");
  const line = page.getByTestId("report-1");
  await expect(line).toHaveAttribute("data-state", "scored");
  await expect(line).toContainText("85/100");
  await expect(line).toContainText("price +20%");
  await expect(line).toContainText("Your firm: ★★★★★");
  await expect(page.getByTestId("report-2")).toHaveAttribute("data-state", "later");
  await line.scrollIntoViewIfNeeded();
  await shot(page, "10-product-report-card");

  // ── Finance: reads the cards and trades.
  await page.context().clearCookies();
  await loginAsTeam(page, ev, a!.f_code);
  await expect(page.getByTestId("your-job")).toContainText("Read each crisis, then trade");
  await expect(page.getByTestId("task-CARDS")).toContainText("Read the crisis 1 cards");
  await page.goto("/team/crisis");
  await expect(page.getByTestId("fund-todo")).toContainText("Read each company's crisis card");
  await shot(page, "09-fund-crisis-room");
});
