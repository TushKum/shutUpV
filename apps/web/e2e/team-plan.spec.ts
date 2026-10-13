import { expect, test, type Browser, type Page } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The squad's shared work after the crisis: the rescue plan co-edited by the Product team (laptop) and the
// Consulting team (phone) — edits to different sections merge, a section both changed asks which text to keep, a
// submit from a screen behind a newer save never overwrites it — its hard deadline and the cap when the deal is not
// signed, then the flash answer.
//
// Both squad specs (this one and team-squad) use the team-code prefix I, and team codes are unique across events:
// the two files take turns (a Postgres advisory lock held for the whole file), and each purges the other's event.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
let turn: pg.PoolClient | undefined;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  turn = await e2ePool().connect();
  await turn.query("select pg_advisory_lock(hashtext('e2e:team-code-prefix:I'))");
  await e2ePool().query("select public.purge_event($1)", ["e2e-team-squad"]);
  ev = await seedE2eEvent({ slug: "e2e-team-plan", prefix: "I" });
  s = await trading(ev);
  await ev.n.advanceTo("CRISIS");
});

test.afterAll(async () => {
  await turn?.query("select pg_advisory_unlock_all()");
  turn?.release();
});

async function screen(browser: Browser, code: string, width = 1280): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await loginAsTeam(page, ev, code);
  return page;
}

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
const planEditor = (page: Page) => page.getByRole("form", { name: "Rescue plan editor" });
/** The squad's saved plan draft, as the database has it. */
const planDraft = (companyId: string) =>
  ev.n.one<{ version: number; content: Record<string, string> }>("select version, content from submission_drafts where company_id = $1 and type = 'PLAN'", [companyId]);
const HHMM = /\d\d:\d\d/;

test("B1: Product and Consulting type in different sections at once and both are kept; a section both changed asks which text to keep", async ({ page, browser }) => {
  test.setTimeout(180_000); // four waits for the other screen's 10-second re-read
  const x = s[0]!;
  await loginAsTeam(page, ev, x.p_code);
  await page.goto("/team/squad/plan");
  await expect(page).toHaveTitle(/Plan/);
  const consulting = await screen(browser, x.c_code, 390);
  await consulting.goto("/team/squad/plan");
  const product = planEditor(page);
  const phone = planEditor(consulting);

  await expect(page.getByTestId("plan-deadline-rule")).toHaveText(
    /^Hard deadline \d\d:\d\d: only a version submitted by then is judged; a late or missing plan scores 0\. Your squad has not submitted a plan yet\.$/,
  );
  await expect(page.getByTestId("plan-cap-rule")).toHaveText(
    /^The deal is not fully signed yet \(0 of 3 signatures\)\. If it is not fully signed by \d\d:\d\d, the plan score is capped at 50\.$/,
  );
  await expect(product.getByTestId("word-total")).toHaveText("0 / 500 words");

  // Both screens type, in different sections; Product saves first (version 1).
  await phone.getByLabel("The new plan").fill("License the sensors to councils.");
  await product.getByLabel("The crisis").fill("Our supplier stopped deliveries.");
  await product.getByRole("button", { name: "Save draft" }).click();
  await expect(product.getByRole("status").filter({ hasText: /^Saved version 1 at/ })).toBeVisible();

  // The phone re-reads every 10 seconds: Product's section is merged in, the phone's own section stays typed, and
  // Save is still offered (it will name version 1).
  await expect(
    phone.getByRole("status").filter({
      hasText: /^Merged the Product team's changes to The crisis \(version 1, saved at \d\d:\d\d:\d\d\)\. Your own changes are still here, not saved yet\./,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(phone.getByLabel("The crisis")).toHaveValue("Our supplier stopped deliveries.");
  await expect(phone.getByLabel("The new plan")).toHaveValue("License the sensors to councils.");
  await expect(phone.getByTestId("draft-conflict")).toHaveCount(0);
  await expect(phone.getByTestId("draft-version")).toContainText("Version 1 · saved by Product at");
  await expect(phone.getByText("Unsaved changes")).toBeVisible();
  await noSideScroll(consulting);
  await phone.getByRole("button", { name: "Save draft" }).click();
  await expect(phone.getByRole("status").filter({ hasText: /^Saved version 2 at/ })).toBeVisible();
  expect(await planDraft(x.company_id)).toMatchObject({
    version: 2,
    content: { crisis: "Our supplier stopped deliveries.", new_plan: "License the sensors to councils." },
  });

  // Product's screen (nothing typed since its save) shows version 2, with both sections.
  await expect(product.getByLabel("The new plan")).toHaveValue("License the sensors to councils.", { timeout: 20_000 });
  await expect(product.getByLabel("The crisis")).toHaveValue("Our supplier stopped deliveries.");
  await expect(product.getByTestId("draft-version")).toContainText("Version 2 · saved by Consulting at");
  await expect(product.getByRole("status").filter({ hasText: /^Updated to version 2, saved by Consulting at/ })).toBeVisible();

  // The same section changed on both screens (and another only by Product): the phone takes Product's other section,
  // shows both texts of the shared one, and waits for a choice before it saves.
  await phone.getByLabel("The money").fill("The fund pays for one year.");
  await product.getByLabel("The money").fill("The rescue covers six months.");
  await product.getByLabel("Risks").fill("Councils may refuse.");
  await product.getByRole("button", { name: "Save draft" }).click();
  await expect(product.getByRole("status").filter({ hasText: /^Saved version 3 at/ })).toBeVisible();
  const conflict = phone.getByTestId("draft-conflict");
  await expect(conflict).toContainText(/The Product team saved version 3 at \d\d:\d\d:\d\d while you were editing\./, { timeout: 20_000 });
  await expect(conflict).toContainText("You both changed The money: choose which text to keep below.");
  const money = phone.getByTestId("conflict-money");
  await expect(money.getByTestId("conflict-mine")).toContainText("The fund pays for one year.");
  await expect(money.getByTestId("conflict-theirs")).toContainText("The rescue covers six months.");
  await expect(money.getByTestId("conflict-theirs")).toContainText("version 3, saved by Product");
  await expect(phone.getByLabel("The money")).toHaveValue("The fund pays for one year.");
  await expect(phone.getByLabel("Risks")).toHaveValue("Councils may refuse.");
  await expect(phone.getByRole("status").filter({ hasText: /^Merged the Product team's changes to Risks \(version 3/ })).toBeVisible();
  await expect(phone.getByRole("button", { name: "Save draft" })).toBeDisabled();
  await expect(phone.getByRole("button", { name: "Save and submit" })).toBeDisabled();
  await noSideScroll(consulting);
  // Keeping the phone's text replaces Product's in that section only.
  await money.getByRole("button", { name: "Keep my text" }).click();
  await expect(phone.getByTestId("draft-conflict")).toHaveCount(0);
  await expect(phone.getByRole("status").filter({ hasText: "You kept your text in The money: your next save replaces their text there." })).toBeVisible();
  await phone.getByRole("button", { name: "Save draft" }).click();
  await expect(phone.getByRole("status").filter({ hasText: /^Saved version 4 at/ })).toBeVisible();
  expect((await planDraft(x.company_id)).content).toMatchObject({
    crisis: "Our supplier stopped deliveries.",
    new_plan: "License the sensors to councils.",
    money: "The fund pays for one year.",
    risks: "Councils may refuse.",
  });
  await expect(product.getByLabel("The money")).toHaveValue("The fund pays for one year.", { timeout: 20_000 });
  await expect(product.getByTestId("draft-version")).toContainText("Version 4 · saved by Consulting at");
  await expect(product.getByTestId("word-total")).toHaveText("18 / 500 words");

  // F2: Product (nothing typed) submits before its re-read has shown Consulting's newer save. The submit is refused,
  // the newer version is shown, and nothing offers to send the old text over it. (Product's tab reports itself
  // hidden meanwhile, so its 10-second re-read cannot show the newer version first.)
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
  await phone.getByLabel("Next three steps").fill("Sign the deal this week.");
  await phone.getByRole("button", { name: "Save draft" }).click();
  await expect(phone.getByRole("status").filter({ hasText: /^Saved version 5 at/ })).toBeVisible();
  await expect(product.getByTestId("draft-version")).toContainText("Version 4 · saved by Consulting at");
  await product.getByRole("button", { name: "Submit", exact: true }).click();
  await product.getByRole("button", { name: "Click again to submit 18 words" }).click();
  await expect(
    product.getByRole("status").filter({ hasText: /^Not submitted: the Consulting team saved version 5, which is shown now\. Check it, then submit\./ }),
  ).toBeVisible();
  await expect(product.getByLabel("Next three steps")).toHaveValue("Sign the deal this week.");
  await expect(product.getByTestId("draft-version")).toContainText("Version 5 · saved by Consulting at");
  await expect(product.getByTestId("draft-conflict")).toHaveCount(0);
  await expect(product.getByRole("button", { name: /Keep my text|Replace/ })).toHaveCount(0);
  await expect(product.getByRole("button", { name: "Saved" })).toBeDisabled();
  expect(await planDraft(x.company_id)).toMatchObject({ version: 5, content: { next_steps: "Sign the deal this week.", money: "The fund pays for one year." } });
  expect(await ev.n.one("select count(*)::int as n from submissions where company_id = $1 and type = 'PLAN'", [x.company_id])).toEqual({ n: 0 });
  await page.evaluate(() => Reflect.deleteProperty(document, "visibilityState"));

  // Product submits what it now sees (two clicks); Consulting's screen shows who submitted.
  await product.getByRole("button", { name: "Submit", exact: true }).click();
  await product.getByRole("button", { name: "Click again to submit 23 words" }).click();
  await expect(product.getByText(/^Submitted at \d\d:\d\d:\d\d \(23 words\)\. This version is the one judged/)).toBeVisible();
  await expect(page.getByTestId("plan-deadline-rule")).toContainText(/Your squad submitted at \d\d:\d\d:\d\d; submit again to replace that version\./);
  await expect(consulting.getByTestId("submitted-versions")).toContainText(/by Product · 23 words Current · judged/, { timeout: 20_000 });

  // Text typed on the phone and not saved survives a reload of the tab.
  await phone.getByLabel("Time to recovery").fill("Nine months.");
  consulting.on("dialog", (d) => void d.accept());
  await consulting.reload();
  await expect(planEditor(consulting).getByLabel("Time to recovery")).toHaveValue("Nine months.");
  await expect(consulting.getByText("Restored the unsaved text you typed on this device. Save it to keep it.")).toBeVisible();
  await expect(planEditor(consulting).getByText("Unsaved changes")).toBeVisible();
  await noSideScroll(consulting);

  await consulting.goto("/team/squad");
  await expect(consulting.getByTestId("status-PLAN")).toContainText("Submitted");
  await expect(consulting.getByTestId("draft-PLAN")).toContainText(/Version 5 · 23 words · saved by your team at/);
  await expect(consulting.getByTestId("submitted-PLAN")).toContainText(/by Product · 23 words · on time · current \(judged\)/);
  await noSideScroll(consulting);
  await consulting.context().close();
});

test("the deal signed in time lifts the cap; near the plan deadline the notice turns red; after it a missing plan scores 0", async ({ page }) => {
  const [x, y] = s;
  // Squad 1 signs its deal: Consulting proposes the price, Finance the amount, all three sign.
  const post = Number((await ev.n.one("select post_crisis_price from companies where id = $1", [x!.company_id])).post_crisis_price);
  await ev.n.ok(ev.n.team(x!.c_code), "edit_deal", null, post);
  const edited = await ev.n.ok(ev.n.team(x!.f_code), "edit_deal", 4_000_000, null);
  for (const code of [x!.p_code, x!.c_code, x!.f_code]) await ev.n.ok(ev.n.team(code), "sign_deal", edited.deal.version);

  await loginAsTeam(page, ev, x!.p_code);
  await page.goto("/team/squad/plan");
  await expect(page.getByTestId("plan-cap-rule")).toHaveText(/^The deal was fully signed at \d\d:\d\d: the plan score is not capped\.$/);

  // Squad 2 has neither a plan nor a deal. The deadlines (03:00) come near.
  await ev.n.q("update deadlines set at = now() + interval '20 seconds' where event_id = $1 and code in ('PLAN', 'DEAL')", [ev.n.eventId]);
  await page.context().clearCookies();
  await loginAsTeam(page, ev, y!.p_code);
  await page.goto("/team/squad/plan");
  const rule = page.getByTestId("plan-deadline-rule");
  await expect(rule).toContainText("Your squad has not submitted a plan yet.");
  await expect(page.getByTestId("plan-rules").locator("div").filter({ has: rule })).toHaveClass(/bg-red-50/);
  await expect(page.getByTestId("plan-cap-rule")).toContainText("If it is not fully signed by");
  await planEditor(page).getByLabel("The crisis").fill("Too late to save.");

  await expect(rule).toHaveText(/^No plan was submitted by \d\d:\d\d: the plan scores 0\.$/, { timeout: 30_000 });
  await expect(page.getByTestId("plan-cap-rule")).toHaveText(/^The deal was not fully signed by \d\d:\d\d: the plan score is capped at 50\.$/);
  await expect(planEditor(page).getByTestId("draft-closed")).toHaveText(/^The rescue plan closed at \d\d:\d\d(:\d\d)?\.$/);
  await expect(planEditor(page).getByTestId("draft-unsaved")).toBeVisible();
  await expect(planEditor(page).getByRole("button", { name: /Save|Submit/ })).toHaveCount(0);
  expect(await ev.n.call(ev.n.team(y!.c_code), "save_draft", "PLAN", { crisis: "Late." }, 0)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  expect(await ev.n.call(ev.n.team(y!.p_code), "submit_submission", "PLAN")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  await page.goto("/team/squad");
  await expect(page.getByTestId("status-PLAN")).toContainText("Not submitted · scores 0");

  await page.context().clearCookies();
  await loginAsTeam(page, ev, x!.p_code);
  await page.goto("/team/squad/plan");
  await expect(page.getByTestId("plan-deadline-rule")).toHaveText(/^The plan closed at \d\d:\d\d\. The version submitted at \d\d:\d\d:\d\d is the one judged\.$/);
  await expect(page.getByTestId("plan-cap-rule")).toContainText("not capped");
  expect(HHMM.test(await page.getByTestId("plan-due").innerText())).toBe(true);
});

test("the flash answer: opens with the bulletin shown next to it, up to 100 words, written by Product or Consulting, closes at 04:15", async ({ page, browser }) => {
  const x = s[0]!;
  // Verdicts: plan scores judged and released, then rounds 13–21.
  await ev.n.advanceTo("VERDICTS");
  await ev.n.judge(x.company_id, "PLAN", [70, 70, 70]);
  await ev.n.org("seal_missing_scores", ev.n.eventId, "PLAN");
  await ev.n.org("release_scores", ev.n.eventId, "PLAN");
  await ev.n.advanceTo("ROUNDS_13_21");

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, x.p_code);
  await page.goto("/team/squad/flash");
  await expect(page).toHaveTitle(/Flash/);
  await expect(page.getByRole("main")).toContainText(/Not published yet: it is planned for \d\d:\d\d\. It appears here as soon as it is out\./);
  const editor = page.getByRole("form", { name: "Flash answer editor" });
  await expect(editor.getByTestId("draft-closed")).toHaveText(/^The flash answer opens when the flash bulletin is published \(planned for \d\d:\d\d\)\.$/);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();

  await ev.n.org("prepare_flash_bulletin", ev.n.eventId, "Interest rates rise", "Investors want profit within 12 months.");
  await ev.n.org("publish_flash_bulletin", ev.n.eventId);
  // The broadcast refreshes the page: the bulletin appears and the answer opens.
  const bulletin = page.getByTestId("flash-bulletin");
  await expect(bulletin).toContainText("Interest rates rise");
  await expect(bulletin).toContainText("Investors want profit within 12 months.");
  await expect(editor.getByTestId("draft-closed")).toHaveCount(0);

  await editor.getByLabel("Our answer").fill(Array.from({ length: 101 }, (_, i) => `w${i}`).join(" "));
  await expect(editor.getByTestId("word-total")).toHaveText("101 / 100 words");
  await expect(editor.getByText("1 word over the limit")).toBeVisible();
  await expect(editor.getByTestId("submit-problem")).toHaveText("Cannot submit yet: At most 100 words (you have 101).");
  await expect(editor.getByRole("button", { name: "Save and submit" })).toBeDisabled();
  await editor.getByLabel("Our answer").fill("We cut costs and sell yearly plans to councils, so we profit in nine months.");
  await expect(editor.getByTestId("word-total")).toHaveText("15 / 100 words");
  await editor.getByRole("button", { name: "Save and submit" }).click();
  await editor.getByRole("button", { name: "Click again to save and submit 15 words" }).click();
  await expect(editor.getByText(/^Submitted at \d\d:\d\d:\d\d \(15 words\)/)).toBeVisible();
  await noSideScroll(page);

  // The Consulting team may write the flash answer too; it sees Product's submission.
  const consulting = await screen(browser, x.c_code);
  await consulting.goto("/team/squad/flash");
  await expect(consulting.getByTestId("flash-bulletin")).toContainText("Interest rates rise");
  const theirs = consulting.getByRole("form", { name: "Flash answer editor" });
  await expect(theirs.getByRole("button", { name: "Submitted" })).toBeDisabled();
  await expect(consulting.getByTestId("submitted-versions")).toContainText("by Product · 15 words Current · judged");
  await theirs.getByLabel("Our answer").fill("We cut costs and sell yearly plans to councils.");
  await theirs.getByRole("button", { name: "Save draft" }).click();
  await expect(theirs.getByRole("status").filter({ hasText: /^Saved version 2 at/ })).toBeVisible();

  // The deadline passes: the open page closes, and the database refuses anyway.
  await ev.n.q("update deadlines set at = now() + interval '12 seconds' where event_id = $1 and code = 'FLASH'", [ev.n.eventId]);
  await consulting.reload();
  await expect(theirs.getByTestId("draft-closed")).toHaveText(/^The flash answer closed at \d\d:\d\d(:\d\d)?\.$/, { timeout: 30_000 });
  await expect(theirs.getByRole("button", { name: /Save|Submit/ })).toHaveCount(0);
  expect(await ev.n.call(ev.n.team(x.c_code), "save_draft", "FLASH", { answer: "Late." }, 2)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  await consulting.goto("/team/squad");
  // The saved draft (version 2) differs from the submitted answer, which is the one judged.
  await expect(consulting.getByTestId("status-FLASH")).toContainText("Submitted");
  await expect(consulting.getByTestId("draft-FLASH")).toContainText("Version 2 · 9 words · saved by your team");
  await expect(consulting.getByTestId("submitted-FLASH")).toContainText("by Product · 15 words · on time · current (judged)");
  await consulting.context().close();
});
