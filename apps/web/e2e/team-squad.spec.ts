import { expect, test, type Browser, type Page } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

// The squad workspace: the overview, the problem card pick and the pitch card, through the Product and Consulting
// teams' screens (a phone for the pitch). The state is moved with the real game functions.
//
// Both squad specs (this one and team-plan) use the team-code prefix I, and team codes are unique across events: the
// two files take turns (a Postgres advisory lock held for the whole file), and each purges the other's event first.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
let turn: pg.PoolClient | undefined;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  turn = await e2ePool().connect();
  await turn.query("select pg_advisory_lock(hashtext('e2e:team-code-prefix:I'))");
  await e2ePool().query("select public.purge_event($1)", ["e2e-team-plan"]);
  ev = await seedE2eEvent({ slug: "e2e-team-squad", prefix: "I" });
});

test.afterAll(async () => {
  await turn?.query("select pg_advisory_unlock_all()");
  turn?.release();
});

const codeOf = (track: "PRODUCT" | "CONSULTING" | "FINANCE") => ev.plan.teams.find((t) => t.track === track)!.code;

/** A second screen (another team, or the same team on another device). */
async function screen(browser: Browser, code: string, width = 1280): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await loginAsTeam(page, ev, code);
  return page;
}

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

async function dealtTitles(squadNo: number): Promise<string[]> {
  const sq = await ev.n.squad(squadNo);
  const rows = await ev.n.q<{ id: string; title: string }>("select id, title from problem_cards where id = any($1)", [sq.dealt_card_ids]);
  return (sq.dealt_card_ids as string[]).map((id) => rows.find((r) => r.id === id)!.title);
}

test("a Finance team is pointed to Rescue and Trade; before the draw the workspace waits for it", async ({ page }) => {
  await loginAsTeam(page, ev, codeOf("FINANCE"));
  await page.goto("/team/squad");
  const main = page.getByRole("main");
  await expect(main).toContainText("The squad workspace is for the Product and Consulting teams.");
  await expect(main.getByRole("link", { name: "Rescue" })).toHaveAttribute("href", "/team/rescue");
  await expect(main.getByRole("link", { name: "Trade" })).toHaveAttribute("href", "/team/trade");
  await page.goto("/team/squad/pitch");
  await expect(main).toContainText("The squad workspace is for the Product and Consulting teams.");

  await page.context().clearCookies();
  await loginAsTeam(page, ev, codeOf("PRODUCT"));
  await page.goto("/team/squad");
  await expect(main).toContainText("The squads are formed at the squad draw. Your squad workspace opens then.");
});

test("after the draw: the overview, and the Product team picks a problem card with two clicks; Consulting sees it read-only", async ({ page, browser }) => {
  s = await drawn(ev);
  const [x] = s;
  const titles = await dealtTitles(1);
  await loginAsTeam(page, ev, x!.p_code);
  await page.goto("/team/squad");
  await expect(page.getByRole("heading", { name: "Squad 01" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Squad teams" })).toContainText(`Your team · ${x!.p_code}`);
  // Partners' codes are not readable by a team (RLS), so they are not shown.
  await expect(page.getByRole("list", { name: "Squad teams" })).not.toContainText(x!.c_code);
  await expect(page.getByTestId("squad-company")).toContainText("No name or ticker claimed yet");
  await expect(page.getByTestId("squad-problem")).toContainText("Not picked yet.");
  await expect(page.getByTestId("status-PITCH")).toContainText("Not started");
  await expect(page.getByTestId("status-PLAN")).toContainText("Not open yet");
  await expect(page.getByTestId("status-FLASH")).toContainText("Not open yet");

  await page.getByRole("link", { name: "Pick a card" }).click();
  await expect(page).toHaveURL(/\/team\/squad\/problem$/);
  await expect(page).toHaveTitle(/Problem card/);
  await expect(page.getByTestId("pick-due")).toHaveAttribute("data-state", "open");
  for (const [i, t] of titles.entries()) await expect(page.getByRole("listitem", { name: `Card ${i + 1}: ${t}` })).toBeVisible();
  const second = page.getByRole("listitem", { name: `Card 2: ${titles[1]}` });
  await second.getByRole("button", { name: "Pick this card" }).click();
  await expect(second.getByRole("button", { name: `Click again to pick “${titles[1]}”` })).toBeVisible();
  await second.getByRole("button", { name: `Click again to pick “${titles[1]}”` }).click();
  await expect(second).toContainText("Picked");
  expect((await ev.n.squad(1)).chosen_card_id).toBe((await ev.n.squad(1)).dealt_card_ids[1]);
  // It can be changed until the pick closes.
  await expect(page.getByRole("listitem", { name: `Card 1: ${titles[0]}` }).getByRole("button", { name: "Pick this card instead" })).toBeVisible();

  await page.goto("/team/squad");
  await expect(page.getByTestId("squad-problem")).toContainText(`${titles[1]}`);
  await expect(page.getByTestId("squad-problem")).toContainText("Picked");

  const consulting = await screen(browser, x!.c_code);
  await consulting.goto("/team/squad/problem");
  await expect(consulting.getByRole("listitem", { name: `Card 2: ${titles[1]}` })).toContainText("Picked");
  await expect(consulting.getByRole("button", { name: /Pick this card/ })).toHaveCount(0);
  await expect(consulting.getByRole("main")).toContainText("The Product team picks the card; you see its pick here.");
  // The database refuses a pick from the Consulting team anyway.
  const refused = await ev.n.call(ev.n.team(x!.c_code), "pick_problem_card", (await ev.n.squad(1)).dealt_card_ids[0]);
  expect(refused).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
  await consulting.context().close();
});

test("no pick by the deadline: the open page closes the pick and shows the first card chosen by default", async ({ page }) => {
  const y = s[1]!;
  const titles = await dealtTitles(2);
  await loginAsTeam(page, ev, y.p_code);
  await page.goto("/team/squad/problem");
  await expect(page.getByRole("button", { name: "Pick this card" })).toHaveCount(3);
  await ev.n.deadlinePassed("PROBLEM_PICK");
  // The page re-reads while the pick can change (no realtime message for a pick or a default).
  const first = page.getByRole("listitem", { name: `Card 1: ${titles[0]}` });
  await expect(first).toContainText("Chosen by default", { timeout: 25_000 });
  await expect(page.getByRole("button", { name: /Pick this card/ })).toHaveCount(0);
  await expect(page.getByTestId("pick-due")).toHaveAttribute("data-state", "passed");
  await expect.poll(async () => (await ev.n.squad(2)).chosen_by_default, { timeout: 10_000 }).toBe(true);
  await expect(page.getByRole("main")).toContainText("No card was picked before the pick closed, so the first card dealt was chosen by default.");
  expect(await ev.n.call(ev.n.team(y.p_code), "pick_problem_card", (await ev.n.squad(2)).dealt_card_ids[1])).toMatchObject({
    ok: false,
    code: "DEADLINE_PASSED",
  });
  await page.goto("/team/squad");
  await expect(page.getByTestId("squad-problem")).toContainText(titles[0]!);
  await expect(page.getByTestId("squad-problem")).toContainText("Chosen by default");
});

test("the pitch card on a phone: template fields, live word counts, save, a save from another device, submit with two clicks", async ({ page }) => {
  await ev.n.advanceTo("BUILD");
  const x = s[0]!;
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsTeam(page, ev, x.p_code);
  await page.goto("/team/squad/pitch");
  await expect(page).toHaveTitle(/Pitch/);
  const editor = page.getByRole("form", { name: "Pitch card editor" });
  await expect(editor.getByTestId("draft-version")).toContainText("Not saved yet.");
  await expect(editor.getByTestId("submit-problem")).toHaveText("Cannot submit yet: Write something before submitting.");

  await editor.getByLabel("The problem").fill("Unsafe water in small towns.");
  await expect(editor.getByTestId("words-problem")).toHaveText("5 words");
  await expect(editor.getByTestId("word-total")).toHaveText("5 / 400 words");
  await expect(editor.getByTestId("submit-problem")).toHaveText("Cannot submit yet: Enter the company name (up to 60 characters).");
  await editor.getByLabel("Company name").fill("Aqua Sense");
  // The ticker field keeps capital letters only; 3 or 4 of them.
  await editor.getByLabel("Ticker").fill("a-q");
  await expect(editor.getByLabel("Ticker")).toHaveValue("AQ");
  await expect(editor.getByTestId("submit-problem")).toHaveText("Cannot submit yet: The ticker is 3 or 4 letters, e.g. AQS.");
  await expect(editor.getByRole("button", { name: "Save and submit" })).toBeDisabled();
  await editor.getByLabel("Ticker").fill("aqs");
  await expect(editor.getByLabel("Ticker")).toHaveValue("AQS");
  await expect(editor.getByTestId("submit-problem")).toHaveCount(0);
  await editor.getByLabel("The solution").fill("Cheap sensors in every tank, read by phone.");
  await expect(editor.getByTestId("word-total")).toHaveText("13 / 400 words");
  await expect(editor.getByText("Unsaved changes")).toBeVisible();
  await noSideScroll(page);

  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(editor.getByRole("status").filter({ hasText: /^Saved version 1 at \d\d:\d\d:\d\d\.$/ })).toBeVisible();
  await expect(editor.getByTestId("draft-version")).toContainText("Version 1 · saved by your team at");
  await expect(editor.getByRole("button", { name: "Saved" })).toBeDisabled();

  // This screen types more while the same team saves from another device; then it saves: refused, the text is kept.
  await editor.getByLabel("Customers").fill("Small-town water boards.");
  await ev.n.ok(ev.n.team(x.p_code), "save_draft", "PITCH", { company_name: "Aqua Sense", ticker: "AQS", problem: "Unsafe water.", customers: "Town councils." }, 1);
  // (The page may also have re-read the newer version on its own, which offers the same choice and disables Save.)
  await editor.getByRole("button", { name: "Save draft" }).click({ timeout: 3000 }).catch(() => {});
  const conflict = editor.getByTestId("draft-conflict");
  await expect(conflict).toContainText(/Your team \(on another device\) saved version 2 at \d\d:\d\d:\d\d while you were editing\./);
  await expect(editor.getByLabel("Customers")).toHaveValue("Small-town water boards.");
  await expect(editor.getByRole("button", { name: "Save draft" })).toBeDisabled();
  await conflict.getByRole("button", { name: "Load their version" }).click();
  await expect(editor.getByLabel("Customers")).toHaveValue("Town councils.");
  await expect(editor.getByLabel("The problem")).toHaveValue("Unsafe water.");
  await expect(editor.getByTestId("draft-version")).toContainText("Version 2 · saved by your team");
  const stash = editor.getByTestId("draft-stash");
  await expect(stash).toContainText("Your text from before you loaded the newer version is set aside here.");
  await expect(stash).toContainText("Small-town water boards.");
  await stash.getByRole("button", { name: "Put my text back" }).click();
  await expect(editor.getByLabel("Customers")).toHaveValue("Small-town water boards.");
  await expect(editor.getByLabel("The problem")).toHaveValue("Unsafe water in small towns.");
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(editor.getByRole("status").filter({ hasText: /^Saved version 3 at/ })).toBeVisible();

  // Submit: two clicks, naming what is submitted.
  await editor.getByRole("button", { name: "Submit", exact: true }).click();
  const confirm = editor.getByRole("button", { name: "Click again to submit 16 words as AQS" });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(editor.getByText(/^Submitted at \d\d:\d\d:\d\d \(16 words\)\. Ticker AQS is yours\./)).toBeVisible();
  await expect(editor.getByRole("button", { name: "Submitted" })).toBeDisabled();
  await expect(editor.getByTestId("submitted-state")).toContainText("This text is the submitted version");
  const versions = page.getByTestId("submitted-versions");
  await expect(versions.getByRole("listitem")).toHaveCount(1);
  await expect(versions).toContainText(/by your team · 16 words Current · judged/);
  expect(await ev.n.one("select name, ticker from companies where id = $1", [x.company_id])).toEqual({ name: "Aqua Sense", ticker: "AQS" });
  await noSideScroll(page);

  // A change after submitting is a draft until it is submitted again.
  await editor.getByLabel("Our advantage").fill("Ten times cheaper than lab tests.");
  await expect(editor.getByTestId("submitted-state")).toContainText("This text differs from the version submitted at");
  await editor.getByRole("button", { name: "Save and submit" }).click();
  await editor.getByRole("button", { name: "Click again to save and submit 22 words as AQS" }).click();
  await expect(editor.getByText(/^Submitted at \d\d:\d\d:\d\d \(22 words\)/)).toBeVisible();
  await expect(versions.getByRole("listitem")).toHaveCount(2);
  await expect(versions.getByRole("listitem").first()).toContainText("22 words Current · judged");
  await expect(versions.getByRole("listitem").last()).toContainText("16 words Superseded");

  await page.goto("/team/squad");
  await expect(page.getByTestId("squad-company")).toHaveText("Aqua Sense (AQS)");
  const status = page.getByTestId("status-PITCH");
  await expect(status).toContainText("Submitted");
  await expect(page.getByTestId("draft-PITCH")).toContainText(/Version 4 · 22 words · saved by your team at \d\d:\d\d:\d\d/);
  await expect(page.getByTestId("submitted-PITCH")).toContainText(/\d\d:\d\d:\d\d by your team · 22 words · on time · current \(judged\)/);
  await expect(status).toContainText("1 superseded version");
  await expect(status.getByTestId("draft-PITCH")).toBeVisible();
  await noSideScroll(page);
});

test("Consulting reads the pitch as it is written; a ticker another company claimed is refused, the text kept", async ({ page, browser }) => {
  const [x, y] = s;
  const consulting = await screen(browser, x!.c_code, 390);
  await consulting.goto("/team/squad/pitch");
  const read = consulting.getByRole("form", { name: "Pitch card editor" });
  await expect(read.getByTestId("draft-closed")).toHaveText("The Product team writes the pitch card; you can read it here.");
  await expect(read.getByLabel("Company name")).toHaveValue("Aqua Sense");
  await expect(read.getByLabel("Our advantage")).toHaveAttribute("readonly", "");
  await expect(read.getByRole("button", { name: /Save|Submit/ })).toHaveCount(0);
  await expect(read.getByTestId("draft-version")).toContainText("Version 4 · saved by Product at");
  await consulting.goto("/team/squad");
  await expect(consulting.getByTestId("submitted-PITCH")).toContainText("by Product · 22 words");
  await consulting.context().close();

  await loginAsTeam(page, ev, y!.p_code);
  await page.goto("/team/squad/pitch");
  const editor = page.getByRole("form", { name: "Pitch card editor" });
  await editor.getByLabel("Company name").fill("Blue Cart");
  await editor.getByLabel("Ticker").fill("AQS");
  await editor.getByLabel("The problem").fill("Students waste time queueing for food.");
  await editor.getByRole("button", { name: "Save and submit" }).click();
  await editor.getByRole("button", { name: "Click again to save and submit 6 words as AQS" }).click();
  await expect(editor.getByRole("alert").filter({ hasText: "TICKER_TAKEN: Another company already uses that ticker." })).toBeVisible();
  await expect(editor.getByLabel("The problem")).toHaveValue("Students waste time queueing for food.");
  // The text was saved before the refusal: version 1 is this screen's own save, not someone else's.
  await expect(editor.getByTestId("draft-version")).toContainText("Version 1 · saved by your team");
  await expect(editor.getByTestId("draft-conflict")).toHaveCount(0);
  await editor.getByLabel("Ticker").fill("BLU");
  await editor.getByRole("button", { name: "Save and submit" }).click();
  await editor.getByRole("button", { name: "Click again to save and submit 6 words as BLU" }).click();
  await expect(editor.getByText(/Ticker BLU is yours\./)).toBeVisible();
  expect((await ev.n.one("select ticker from companies where id = $1", [y!.company_id])).ticker).toBe("BLU");
});

test("the pitch hard-closes at its deadline on an open page: read-only, unsaved text kept apart, and the server refuses", async ({ page }) => {
  const z = s[2]!;
  await loginAsTeam(page, ev, z.p_code);
  await ev.n.q("update deadlines set at = now() + interval '15 seconds' where event_id = $1 and code = 'PITCH'", [ev.n.eventId]);
  await page.goto("/team/squad/pitch");
  const editor = page.getByRole("form", { name: "Pitch card editor" });
  await expect(page.getByTestId("pitch-due")).toHaveAttribute("data-state", "open");
  await editor.getByLabel("The problem").fill("Typed but never saved.");
  await expect(editor.getByTestId("draft-closed")).toHaveText(/^The pitch card closed at \d\d:\d\d(:\d\d)?\.$/, { timeout: 30_000 });
  await expect(page.getByTestId("pitch-due")).toHaveAttribute("data-state", "passed");
  await expect(editor.getByLabel("The problem")).toHaveValue("");
  await expect(editor.getByLabel("The problem")).toHaveAttribute("readonly", "");
  await expect(editor.getByRole("button", { name: /Save|Submit/ })).toHaveCount(0);
  const unsaved = editor.getByTestId("draft-unsaved");
  await expect(unsaved).toContainText("Not saved: the text below was typed on this screen but never saved");
  await unsaved.getByText("See the unsaved text").click();
  await expect(unsaved).toContainText("Typed but never saved.");
  expect(await ev.n.call(ev.n.team(z.p_code), "save_draft", "PITCH", { problem: "Late." }, 0)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  expect(await ev.n.call(ev.n.team(z.p_code), "submit_submission", "PITCH")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });

  await page.goto("/team/squad");
  await expect(page.getByTestId("status-PITCH")).toContainText("Not submitted · scores 0");
  await expect(page.getByTestId("status-PITCH")).toContainText("closed");
});
