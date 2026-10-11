import { expect, test, type Browser, type Page } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The squad's shared work after the crisis: the rescue plan co-edited by the Product team (laptop) and the
// Consulting team (phone), its hard deadline and the cap when the deal is not signed, then the flash answer.
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
const HHMM = /\d\d:\d\d/;

test("Product and Consulting co-edit the plan: each sees the other's saves; typed text is never overwritten", async ({ page, browser }) => {
  test.setTimeout(150_000); // three waits for the other screen's 10-second re-read
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

  await product.getByLabel("The crisis").fill("Our supplier stopped deliveries.");
  await product.getByRole("button", { name: "Save draft" }).click();
  await expect(product.getByRole("status").filter({ hasText: /^Saved version 1 at/ })).toBeVisible();

  // The Consulting screen re-reads while the plan is open: nothing typed there, so the new version is shown.
  await expect(phone.getByLabel("The crisis")).toHaveValue("Our supplier stopped deliveries.", { timeout: 20_000 });
  await expect(phone.getByTestId("draft-version")).toContainText("Version 1 · saved by Product at");
  await expect(phone.getByRole("status").filter({ hasText: /^Updated to version 1, saved by Product at/ })).toBeVisible();

  // Both type; Product saves first. Consulting's typed text stays, and the newer version is offered.
  await phone.getByLabel("The new plan").fill("License the sensors to councils.");
  await product.getByLabel("The money").fill("The rescue covers six months.");
  await product.getByRole("button", { name: "Save draft" }).click();
  await expect(product.getByRole("status").filter({ hasText: /^Saved version 2 at/ })).toBeVisible();
  const conflict = phone.getByTestId("draft-conflict");
  await expect(conflict).toContainText(/The Product team saved version 2 at \d\d:\d\d:\d\d while you were editing\./, { timeout: 20_000 });
  await expect(phone.getByLabel("The new plan")).toHaveValue("License the sensors to councils.");
  await expect(phone.getByRole("button", { name: "Save draft" })).toBeDisabled();
  await conflict.getByText("See their version").click();
  await expect(conflict).toContainText("The rescue covers six months.");
  await noSideScroll(consulting);

  // Load theirs (Consulting's text is set aside), then add Consulting's part again and save on top of version 2.
  await conflict.getByRole("button", { name: "Load their version" }).click();
  await expect(phone.getByLabel("The money")).toHaveValue("The rescue covers six months.");
  await expect(phone.getByLabel("The new plan")).toHaveValue("");
  await expect(phone.getByTestId("draft-stash")).toContainText("License the sensors to councils.");
  await phone.getByLabel("The new plan").fill("License the sensors to councils.");
  await phone.getByTestId("draft-stash").getByRole("button", { name: "Discard it" }).click();
  await expect(phone.getByTestId("draft-stash")).toHaveCount(0);
  await phone.getByRole("button", { name: "Save draft" }).click();
  await expect(phone.getByRole("status").filter({ hasText: /^Saved version 3 at/ })).toBeVisible();
  await expect(phone.getByTestId("draft-version")).toContainText("Version 3 · saved by your team");

  await expect(product.getByLabel("The new plan")).toHaveValue("License the sensors to councils.", { timeout: 20_000 });
  await expect(product.getByTestId("draft-version")).toContainText("Version 3 · saved by Consulting at");
  await expect(product.getByTestId("word-total")).toHaveText("14 / 500 words");

  // Consulting submits (two clicks); Product's screen shows who submitted.
  await phone.getByRole("button", { name: "Submit", exact: true }).click();
  await phone.getByRole("button", { name: "Click again to submit 14 words" }).click();
  await expect(phone.getByText(/^Submitted at \d\d:\d\d:\d\d \(14 words\)\. This version is the one judged/)).toBeVisible();
  await expect(page.getByTestId("submitted-versions")).toContainText(/by Consulting · 14 words Current · judged/, { timeout: 20_000 });
  await expect(page.getByTestId("plan-deadline-rule")).toContainText(/Your squad submitted at \d\d:\d\d:\d\d; submit again to replace that version\./);

  // Text typed on the phone and not saved survives a reload of the tab.
  await phone.getByLabel("Risks").fill("Councils may refuse.");
  consulting.on("dialog", (d) => void d.accept());
  await consulting.reload();
  await expect(planEditor(consulting).getByLabel("Risks")).toHaveValue("Councils may refuse.");
  await expect(consulting.getByText("Restored the unsaved text you typed on this device. Save it to keep it.")).toBeVisible();
  await expect(planEditor(consulting).getByText("Unsaved changes")).toBeVisible();
  await noSideScroll(consulting);

  await consulting.goto("/team/squad");
  await expect(consulting.getByTestId("status-PLAN")).toContainText("Submitted");
  await expect(consulting.getByTestId("draft-PLAN")).toContainText(/Version 3 · 14 words · saved by your team at/);
  await expect(consulting.getByTestId("submitted-PLAN")).toContainText(/by your team · 14 words · on time · current \(judged\)/);
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
