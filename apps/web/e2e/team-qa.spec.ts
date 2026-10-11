import { expect, test, type Page } from "@playwright/test";
import type { PoolClient } from "pg";
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

// Three squads: ECA (squad 1), ECB (squad 2), ECC (squad 3). Squad 2's fund asks ECA; ECA's Product team answers.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
const ticker = (i: number) => `EC${"ABC"[i]}`;
const ist = (t: string | Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const QUESTION = "How many towns have signed a contract so far?";
const ANSWER = "Twelve towns have signed, and four more are close.";

test.beforeAll(async () => {
  test.setTimeout(600_000); // may wait for another common spec to finish
  ev = await seedAlone("e2e-team-qa");
});

async function as(page: Page, code: string, path = "/team/qa") {
  await page.context().clearCookies();
  await loginAsTeam(page, ev, code);
  await page.goto(path);
}
const threads = (page: Page) => page.getByRole("list", { name: "Questions and answers" }).getByTestId("qa-thread");
const waiting = (page: Page) => page.getByRole("list", { name: "Questions waiting for your answer" }).getByRole("listitem");

test("before Reading the board is closed and says when it opens; nobody can post", async ({ page }) => {
  const reading = ist((await ev.n.one("select starts_at from phases where event_id = $1 and code = 'READING'", [ev.n.eventId])).starts_at);
  const fund = ev.plan.teams.find((t) => t.track === "FINANCE")!.code;
  await as(page, fund);
  await expect(page.getByText(`The Q&A board opens at ${reading} (Reading) with the pitch book.`)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("Reading: a fund asks (the length is checked as it types); the question is public and shown without its team", async ({ page }) => {
  s = await drawn(ev);
  await ev.n.advanceTo("BUILD");
  await ev.n.deadlinePassed("PROBLEM_PICK");
  for (const [i, x] of s.entries()) {
    await ev.n.ok(ev.n.team(x.p_code), "save_draft", "PITCH", {
      company_name: `Company ${i + 1}`,
      ticker: ticker(i),
      problem: "Unsafe water.",
      solution: "Sensors.",
      customers: "Councils.",
      business_model: "Subscription.",
      advantage: "Cheaper.",
      use_of_seed: "Sensors.",
    }, 0);
    await ev.n.ok(ev.n.team(x.p_code), "submit_submission", "PITCH");
  }
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  const close = ist((await ev.n.one("select starts_at from phases where event_id = $1 and code = 'CLOSE'", [ev.n.eventId])).starts_at);

  const fund = s[1]!.f_code;
  await as(page, fund);
  await expect(page.getByTestId("qa-open")).toContainText(`Open until the close (${close}, in `);
  const ask = page.getByRole("form", { name: "Ask a question" });
  const post = ask.getByRole("button", { name: "Post question" });
  await expect(ask.getByText("0 / 1,000 characters")).toBeVisible();
  await expect(post).toBeDisabled();
  await ask.getByLabel("Company").selectOption({ label: `${ticker(0)} · Company 1` });
  await ask.getByLabel("Question").fill("x".repeat(1001));
  await expect(ask.getByText("1,001 / 1,000 characters")).toBeVisible();
  await expect(post).toBeDisabled();
  await ask.getByLabel("Question").fill(QUESTION);
  await expect(ask.getByText(`${QUESTION.length} / 1,000 characters`)).toBeVisible();
  await post.click(); // one click: a question moves no money, price or score
  await expect(ask.getByRole("status")).toHaveText("Question posted. It is public on the board, shown without your team.");
  await expect(ask.getByLabel("Question")).toHaveValue(""); // an accepted post clears the form

  await expect(threads(page)).toHaveCount(1);
  await expect(threads(page).first()).toContainText(`${ticker(0)}A fund asked`);
  await expect(threads(page).first()).toContainText(QUESTION);
  await expect(threads(page).first()).toContainText("No answer yet");
  const stored = await ev.n.one("select asker_team_id, body from qa_questions where event_id = $1", [ev.n.eventId]);
  expect(stored).toEqual({ asker_team_id: ev.n.teamId(fund), body: QUESTION });

  // Consulting reads the board; it neither asks nor answers. No page names the fund that asked.
  await as(page, s[2]!.c_code);
  await expect(threads(page).first()).toContainText(QUESTION);
  await expect(page.getByRole("form")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(fund);
});

test("the Product team answers its own company's questions, with a live word counter (up to 100 words); it shows up live", async ({ browser, page }) => {
  // The asking fund watches the board in another browser.
  const watcher = await (await browser.newContext()).newPage();
  await loginAsTeam(watcher, ev, s[1]!.f_code);
  await watcher.goto("/team/qa");
  await expect(watcher.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();

  await as(page, s[0]!.p_code);
  await expect(page.getByRole("heading", { name: "Waiting for your answer (1)" })).toBeVisible();
  await expect(waiting(page).first()).toContainText(QUESTION);
  await expect(page.getByRole("form", { name: "Ask a question" })).toHaveCount(0); // funds ask; companies answer
  const form = waiting(page).first().getByRole("form");
  const box = form.getByLabel("Your answer (up to 100 words, public)");
  const words = form.getByTestId("answer-words");
  const post = form.getByRole("button", { name: "Post answer" });
  await expect(words).toHaveText("0 / 100 words");
  await expect(post).toBeDisabled();
  await box.fill(Array.from({ length: 101 }, (_, i) => `word${i}`).join(" "));
  await expect(words).toHaveText("101 / 100 words");
  await expect(form.getByText("Answers are at most 100 words (this one has 101).")).toBeVisible();
  await expect(post).toBeDisabled();
  await box.fill(`${ANSWER} — ok?`); // a dash alone is not a word (the engine's count, as the database's)
  await expect(words).toHaveText("10 / 100 words");
  await box.fill(ANSWER);
  await expect(words).toHaveText("9 / 100 words");
  await post.click();
  await expect(page.getByRole("heading", { name: "Waiting for your answer (0)" })).toBeVisible();
  await expect(page.getByText(`No question to ${ticker(0)} is waiting for an answer.`)).toBeVisible();
  const thread = threads(page).first();
  await expect(thread).toContainText(`${ticker(0)} answered`);
  await expect(thread).toContainText("9 words");
  await expect(thread).toContainText(ANSWER);
  await expect(thread.getByText("Add another answer")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(s[1]!.f_code);

  // The fund's open board shows the answer without a reload, attributed to the company.
  await expect(watcher.getByTestId("qa-thread").first()).toContainText(`${ticker(0)} answered`);
  await expect(watcher.getByTestId("qa-thread").first()).toContainText(ANSWER);
  await watcher.context().close();

  // Another company's Product team cannot answer ECA's questions.
  await as(page, s[1]!.p_code);
  await expect(page.getByRole("heading", { name: "Waiting for your answer (0)" })).toBeVisible();
  await expect(threads(page).first().getByRole("form")).toHaveCount(0);
  await expect(threads(page).first().getByText("Add another answer")).toHaveCount(0);
});

test("questions per company, newest first, 25 a page", async ({ page }) => {
  // 27 more questions from the three funds (each within its 10 a minute): 28 in all, 10 of them to ECB.
  const asks: [number, number][] = [];
  for (let i = 0; i < 10; i++) asks.push([0, 1]); // squad 1's fund asks ECB
  for (let i = 0; i < 10; i++) asks.push([2, 0]); // squad 3's fund asks ECA
  for (let i = 0; i < 7; i++) asks.push([1, 2]); // squad 2's fund asks ECC
  for (const [k, [fund, company]] of asks.entries()) {
    await ev.n.ok(ev.n.team(s[fund]!.f_code), "post_question", s[company]!.company_id, `Question ${k + 1} to ${ticker(company)}?`);
  }

  await as(page, s[2]!.c_code);
  const pager = page.getByRole("navigation", { name: "Question pages", exact: true });
  await expect(pager).toContainText("Questions 1–25 of 28 · page 1 of 2");
  await expect(threads(page)).toHaveCount(25);
  await expect(threads(page).first()).toContainText(`Question 27 to ${ticker(2)}?`); // newest first
  await pager.getByRole("link", { name: "Older →" }).click();
  await expect(page).toHaveURL(/page=2$/);
  await expect(threads(page)).toHaveCount(3);
  await expect(threads(page).last()).toContainText(QUESTION); // the first question of the night

  await page.getByLabel("Company").selectOption(ticker(1));
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?company=${ticker(1)}$`));
  await expect(page.getByRole("navigation", { name: "Question pages", exact: true })).toContainText("Questions 1–10 of 10");
  await expect(threads(page)).toHaveCount(10);
  for (const t of await threads(page).all()) await expect(t).toContainText(`${ticker(1)}A fund asked`);
  await page.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).toHaveURL(/\/team\/qa$/);
  await page.goto("/team/qa?company=ZZZ");
  await expect(page.getByText("No listed company has the ticker ZZZ.")).toBeVisible();
});

test("a refusal from the database is shown as it comes, and what was typed stays", async ({ page }) => {
  // ECA has answered as often as it may in a minute (10 answers; the database counts them).
  const product = ev.n.team(s[0]!.p_code);
  const q1 = (await ev.n.one("select id from qa_questions where event_id = $1 and body = $2", [ev.n.eventId, QUESTION])).id;
  for (let i = 0; i < 11; i++) {
    const r = await ev.n.call(product, "answer_question", q1, `Follow-up number ${i + 1}.`);
    if (r.code === "RATE_LIMITED") break;
    expect(r).toMatchObject({ ok: true });
  }
  await as(page, s[0]!.p_code);
  const item = waiting(page).filter({ hasText: `Question 11 to ${ticker(0)}?` });
  const box = item.getByLabel("Your answer (up to 100 words, public)");
  await box.fill("We sell to councils.");
  await item.getByRole("button", { name: "Post answer" }).click();
  await expect(item.getByRole("alert")).toHaveText("RATE_LIMITED: Too many answers in a minute.");
  await expect(box).toHaveValue("We sell to councils.");
});

test("on a phone (390 px) the board and the answer form fit without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, s[0]!.p_code);
  await expect(waiting(page).first().getByRole("button", { name: "Post answer" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await as(page, s[1]!.f_code);
  await expect(page.getByRole("form", { name: "Ask a question" }).getByRole("button", { name: "Post question" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("at the close the board hard-closes: a form still open is refused by the database; everything stays readable", async ({ page }) => {
  await as(page, s[1]!.f_code);
  const ask = page.getByRole("form", { name: "Ask a question" });
  await ask.getByLabel("Company").selectOption({ label: `${ticker(0)} · Company 1` });
  await ask.getByLabel("Question").fill("Is this too late?");
  // Test-only: jump to the close without the broadcast, so the open form is stale (the night would take hours).
  await ev.n.q("update events set current_phase = 'CLOSE' where id = $1", [ev.n.eventId]);
  const before = (await ev.n.one("select count(*)::int as n from qa_questions where event_id = $1", [ev.n.eventId])).n;
  await ask.getByRole("button", { name: "Post question" }).click();
  // The refusal refreshes the page, which now shows the board closed.
  await expect(page.getByText("The Q&A board closed at the close. Every question and answer stays readable.")).toBeVisible();
  expect((await ev.n.one("select count(*)::int as n from qa_questions where event_id = $1", [ev.n.eventId])).n).toBe(before);
  await expect(page.getByRole("form")).toHaveCount(0);
  await expect(threads(page)).toHaveCount(25);
  await as(page, s[0]!.p_code);
  await expect(page.getByRole("heading", { name: /Waiting for your answer/ })).toHaveCount(0);
  await expect(page.getByText("Add another answer")).toHaveCount(0);
});
