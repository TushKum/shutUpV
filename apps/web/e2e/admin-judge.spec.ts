import { expect, test, type Browser, type Page } from "@playwright/test";
import { RUBRICS, formatCents, type SubmissionType } from "@msim/engine";
import { service } from "../../../supabase/tests/helpers";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn, trading } from "./support/game";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

/** A breakdown that fits the rubric and adds up to `total` (as the judge worker would store). */
function breakdown(total: number, type: SubmissionType = "PITCH") {
  let left = total;
  return Object.fromEntries(
    RUBRICS[type].map((line) => {
      const v = Math.min(line.max, left);
      left -= v;
      return [line.key, v];
    }),
  );
}

/** What the judge worker reports for a good run (finish_judge_run). */
const output = (type: SubmissionType, total: number) => ({
  ok: true,
  model: "test-model",
  prompt_sha: "a".repeat(64),
  request_text: "<submission>…</submission>",
  raw_response: "{}",
  breakdown: breakdown(total, type),
  total,
  rationale: "One. Two. Three.",
  latency_ms: 900,
});

const row = (page: Page, label: string) => page.getByRole("row", { name: new RegExp(`^${label}\\b`) });
const summary = (page: Page, type: string) => page.getByLabel(`${type} summary`);
// An action's result (Next's route announcer is an alert too, outside main).
const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");
/** A result shown next to its control, or carried to the bar at the top when the control went away. */
const said = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text }).first();
const progress = (page: Page) => page.getByTestId("judge-progress");
const bar = (page: Page, name: string) => progress(page).getByRole("progressbar", { name });
const appealCard = (page: Page, label: string, type: string) => page.getByRole("listitem", { name: `Re-run of ${label} ${type}`, exact: true });
/** A tier as the console writes it: "+5%", "0%", "−10%". */
const pct = (b: number) => (b === 0 ? "0%" : `${b > 0 ? "+" : "−"}${Math.abs(b) / 100}%`);
const twoClicks = async (page: Page, first: string, second: string) => {
  await page.getByRole("button", { name: first, exact: true }).click();
  await page.getByRole("button", { name: second, exact: true }).click();
};

async function as(browser: Browser, ev: E2eEvent, email: string, path: string) {
  const ctx = await browser.newContext({ timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await loginAsStaff(page, ev, email);
  await page.goto(path);
  return { page, close: () => ctx.close() };
}

test.describe("judging the pitches", () => {
  // Four squads in READING: KAQ judged and sealed (64, 66, 68), KSN judged with a spread of 20 (50, 70, 62: it needs
  // 2 more runs), squad 3 with no pitch (it gets the default ticker ZAAD at READING), and KFJ submitted but not judged
  // (the console's judge, the fake one here, judges it).
  let ev: E2eEvent;
  let s: Awaited<ReturnType<typeof drawn>>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ev = await seedE2eEvent({ slug: "e2e-judge", prefix: "K", squads: 4 });
    s = await drawn(ev);
    await ev.n.advanceTo("BUILD");
    for (const [i, ticker] of [
      [0, "KAQ"],
      [1, "KSN"],
      [3, "KFJ"],
    ] as const) {
      const p = ev.n.team(s[i]!.p_code);
      await ev.n.ok(
        p,
        "save_draft",
        "PITCH",
        {
          company_name: `Company ${ticker}`,
          ticker,
          problem: "Unsafe water in small towns.",
          solution: "Sensors in every tank.",
          customers: "Town councils.",
          business_model: "Yearly subscription.",
          advantage: "Cheaper than lab tests.",
          use_of_seed: "First 100 sensors.",
        },
        0,
      );
      await ev.n.ok(p, "submit_submission", "PITCH");
    }
    await ev.n.deadlinePassed("PITCH");
    await ev.n.advanceTo("READING");
    expect((await ev.n.judge(s[0]!.company_id, "PITCH", [64, 66, 68])).ok).toBe(true);
    expect((await ev.n.judge(s[1]!.company_id, "PITCH", [50, 70, 62])).code).toBe("RUNS_INCOMPLETE");
  });

  test("an organiser sees the judge controls, every company's runs, spread and median, and why the release is refused", async ({ page }) => {
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge`);
    await expect(page.getByRole("heading", { name: "Pitch scores" })).toBeVisible(); // READING shows pitches first
    await expect(page.getByText(/Phase 6/)).toHaveCount(0);

    // The controls: the judge runs from this console (the fake judge here), the model in use, calibration.
    await expect(page.getByRole("heading", { name: "Judge", exact: true })).toBeVisible();
    await expect(page.getByTestId("judge-runner")).toHaveAttribute("data-state", "off");
    await expect(page.getByRole("button", { name: "Run the judge here" })).toBeVisible();
    await expect(page.getByText("FAKE JUDGE", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("judge-model")).toHaveText("Primaryclaude-opus-5-5In useBackupclaude-sonnet-5-5");
    await expect(page.getByRole("button", { name: "Switch to the backup model" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calibration", exact: true })).toHaveAttribute("href", `/admin/${ev.slug}/judge/calibration`);

    await expect(summary(page, "Pitch")).toContainText("Companies4");
    await expect(summary(page, "Pitch")).toContainText("3 · 1 without");
    await expect(summary(page, "Pitch")).toContainText("6 done · 0 running · 0 queued · 0 failed");
    await expect(summary(page, "Pitch")).toContainText("1 sealed · 0 released · 0 missing");
    await expect(summary(page, "Plan")).toContainText("None yet");

    // Progress: 6 of 9 runs (3 per submission), 1 of 3 companies with a submission sealed; KFJ is not started.
    await expect(bar(page, "Runs done")).toHaveAttribute("aria-valuenow", "6");
    await expect(bar(page, "Runs done")).toHaveAttribute("aria-valuemax", "9");
    await expect(bar(page, "Companies sealed")).toHaveAttribute("aria-valuenow", "1");
    await expect(bar(page, "Companies sealed")).toHaveAttribute("aria-valuemax", "3");
    await expect(page.getByTestId("judge-progress-counts")).toContainText("6 done · 0 running · 0 queued · 0 failed · 1 submission not started");
    await expect(page.getByTestId("judge-target")).toContainText("Target (the brief): all submissions × 3 runs within 10 minutes.");

    // Company, submission, runs (and the model), spread, median, final, tier, capped, penalty, status.
    await expect(row(page, "KAQ").getByRole("cell")).toHaveText([
      "KAQ Company KAQRuns (3)",
      /^\d\d:\d\d · 20 words$/,
      "64 66 68test-model",
      "4",
      "66",
      "66",
      "+5%",
      "No",
      "0",
      "Sealed",
    ]);
    await expect(row(page, "KSN").getByRole("cell")).toHaveText([
      "KSN Company KSNRuns (3)",
      /words$/,
      "50 70 62test-model",
      "20",
      "—",
      "—",
      "—",
      "—",
      "—",
      "Spread over 10: needs 2 more runs",
    ]);
    await expect(row(page, "KFJ").getByRole("cell").nth(2)).toHaveText("—");
    await expect(row(page, "KFJ").getByRole("cell").nth(9)).toHaveText("Not judged");
    await expect(row(page, "ZAAD").getByRole("cell").nth(1)).toHaveText("None");
    await expect(row(page, "ZAAD").getByRole("cell").nth(9)).toHaveText("No submission");

    // The detail of every run: model, status, total, breakdown, rationale; the published (median) run; the re-run.
    await page.getByRole("button", { name: "Show runs of KAQ" }).click();
    const detail = page.getByRole("region", { name: "Runs of KAQ" });
    await expect(detail.getByText("Problem: Unsafe water in small towns.", { exact: false })).toBeVisible();
    await expect(detail.getByText("One. Two. Three. (run 2)").first()).toBeVisible(); // the published rationale: the first run at the median
    await expect(detail.getByText("From the first run whose total equals the median (66).")).toBeVisible();
    await expect(detail.locator("thead")).not.toContainText("Generation"); // one generation only
    const run1 = detail.getByRole("row").filter({ hasText: "One. Two. Three. (run 1)" });
    await expect(run1).toContainText("test-model");
    await expect(run1).toContainText("DONE");
    await expect(run1).toContainText("How the company makes money14/25");
    await expect(run1).toContainText("Advantage over other options0/25");
    await expect(detail.getByRole("button", { name: "Re-run KAQ's pitch" })).toBeVisible();
    await page.getByRole("button", { name: "Hide runs of KAQ" }).click();
    await expect(detail).toHaveCount(0);

    // Two clicks, and the database's reason is shown.
    await twoClicks(page, "Release pitch scores", "Click again to release pitch scores");
    await expect(alert(page)).toHaveText("NOT_READY: 3 companies have no sealed PITCH score yet.");

    await twoClicks(page, "Seal missing as 0", "Click again to seal missing pitch scores as 0");
    await expect(status(page).filter({ hasText: "Sealed" })).toHaveText("Sealed 1 missing pitch score as 0.");
    await expect(row(page, "ZAAD").getByRole("cell").nth(5)).toHaveText("0");
    await expect(row(page, "ZAAD").getByRole("cell").nth(6)).toHaveText("−10%");
    await expect(row(page, "ZAAD").getByRole("cell").nth(9)).toHaveText("Sealed: missing (0)");
    await expect(summary(page, "Pitch")).toContainText("2 sealed · 0 released · 1 missing");
    await expect(bar(page, "Companies sealed")).toHaveAttribute("aria-valuenow", "1"); // the missing 0 is not a submission

    // Plans are judged after the plan and deal deadlines (READING: not yet).
    await page.getByRole("navigation", { name: "Submission type" }).getByRole("link", { name: "Plan" }).click();
    await expect(page.getByRole("heading", { name: "Plan scores" })).toBeVisible();
    const start = page.getByRole("button", { name: "Start judging" });
    await expect(start).toBeDisabled();
    await expect(start).toHaveAttribute("title", /^Plan judging starts after the plan and deal deadlines \(\d\d:\d\d\)\.$/);
  });

  test("the page follows the judge's progress without a reload while runs are in flight", async ({ page }) => {
    const sub = await ev.n.one("select id from submissions where company_id = $1 and type = 'PITCH' and superseded_at is null", [s[1]!.company_id]);
    const insert = (runNo: number, st: string) =>
      ev.n.q(
        `insert into judge_runs (event_id, submission_id, company_id, type, generation, run_no, model, status, attempts)
         values ($1, $2, $3, 'PITCH', 1, $4, 'test-model', $5, 1)`,
        [ev.n.eventId, sub.id, s[1]!.company_id, runNo, st],
      );
    await insert(4, "RUNNING");
    await insert(5, "QUEUED");

    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
    await expect(row(page, "KSN").getByRole("cell").nth(9)).toHaveText("Judging: 3 of 5 runs done");
    await expect(summary(page, "Pitch")).toContainText("6 done · 1 running · 1 queued · 0 failed");
    // The extra runs 4–5 count among the runs needed.
    await expect(bar(page, "Runs done")).toHaveAttribute("aria-valuemax", "11");
    await expect(bar(page, "Runs done")).toHaveAttribute("aria-valuenow", "6");

    // The worker finishes both runs (no realtime message): the page re-reads itself.
    for (const [runNo, total] of [
      [4, 60],
      [5, 61],
    ] as const) {
      await ev.n.q(
        `update judge_runs set status = 'DONE', total = $3, breakdown = $4, rationale = $5, latency_ms = 1234, finished_at = now()
          where submission_id = $1 and generation = 1 and run_no = $2`,
        [sub.id, runNo, total, breakdown(total), `Extra run ${runNo}.`],
      );
    }
    await expect(row(page, "KSN").getByRole("cell").nth(9)).toHaveText("Judged, not sealed");
    await expect(row(page, "KSN").getByRole("cell").nth(2)).toHaveText("50 70 62 60 61test-model");
    await expect(row(page, "KSN").getByRole("cell").nth(4)).toHaveText("61 (unsealed)");
    await expect(bar(page, "Runs done")).toHaveAttribute("aria-valuenow", "8");

    await page.getByRole("button", { name: "Show runs of KSN" }).click();
    const run5 = page.getByRole("region", { name: "Runs of KSN" }).getByRole("row").filter({ hasText: "Extra run 5." });
    await expect(run5).toContainText("1.2 s");

    // The worker seals it (service role): 5 runs, median 61, +5%.
    expect((await ev.n.call(service, "seal_score", s[1]!.company_id, "PITCH")).ok).toBe(true);
    await page.reload();
    await expect(row(page, "KSN").getByRole("cell")).toHaveText([/^KSN.*Runs \(5\)$/, /words$/, "50 70 62 60 61test-model", "20", "61", "61", "+5%", "No", "0", "Sealed"]);
  });

  test("Start judging queues runs, a failed run is retried, and this console's judge (on the backup model) works the queue to the seal", async ({ page }) => {
    const kfj = s[3]!.company_id;
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=pitch`);

    // The backup model applies to runs claimed from then on.
    await twoClicks(page, "Switch to the backup model", "Click again to switch to the backup model (claude-sonnet-5-5)");
    await expect(said(page, "Runs claimed from now on")).toHaveText(
      "Runs claimed from now on use the backup model (claude-sonnet-5-5); runs already running finish as they are.",
    );
    await expect(page.getByTestId("judge-model")).toHaveText("Primaryclaude-opus-5-5Backupclaude-sonnet-5-5In use");
    expect((await ev.n.one("select judge_model_slot from events where id = $1", [ev.n.eventId])).judge_model_slot).toBe("BACKUP");

    await twoClicks(page, "Start judging", "Click again to start judging pitch submissions");
    await expect(said(page, "Queued")).toHaveText("Queued 3 runs for 1 company.");
    await expect(row(page, "KFJ").getByRole("cell").nth(9)).toHaveText("Judging: 0 of 3 runs done");
    await expect(page.getByTestId("judge-progress-counts")).toContainText("8 done · 0 running · 3 queued · 0 failed");

    // A run that failed for good (test only: as the worker reports it after 5 attempts) is sent back to the queue.
    await ev.n.q(
      "update judge_runs set status = 'FAILED', attempts = 5, error = 'overloaded (529)', finished_at = now() where company_id = $1 and type = 'PITCH' and run_no = 3",
      [kfj],
    );
    await expect(row(page, "KFJ").getByRole("cell").nth(2)).toContainText("Run 3 failed after 5 attempts: overloaded (529)");
    await expect(summary(page, "Pitch")).toContainText("1 failed");
    await twoClicks(page, "Retry 1 failed run", "Click again to retry 1 failed run");
    await expect(said(page, "Sent")).toHaveText("Sent 1 failed run back to the queue.");
    await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
    await expect(page.getByTestId("judge-progress-counts")).toContainText("3 queued · 0 failed");

    // Run the judge here: the fake judge scores KFJ and the score is sealed (3 runs, or 5 when they spread).
    await page.getByRole("button", { name: "Run the judge here" }).click();
    await expect(row(page, "KFJ").getByRole("cell").nth(9)).toHaveText("Sealed", { timeout: 60_000 });
    await expect(row(page, "KFJ").getByRole("cell").nth(2)).toHaveText(/^(\d+ ){2,4}\d+fake-judge$/);
    await expect(page.getByTestId("judge-runner-totals")).toContainText(/This console: \d runs done/);
    await expect(bar(page, "Companies sealed")).toHaveAttribute("aria-valuenow", "3");
    const needed = await bar(page, "Runs done").getAttribute("aria-valuemax");
    await expect(bar(page, "Runs done")).toHaveAttribute("aria-valuenow", needed!);
    await expect(page.getByTestId("judge-progress-counts")).toContainText("0 running · 0 queued · 0 failed");
    await expect(page.getByTestId("judge-target")).toContainText(/Met: 9 runs in (\d+ min|\d+ min \d+ s|\d+ s)\./);
    await page.getByRole("button", { name: "Stop the judge here" }).click();
    await expect(page.getByTestId("judge-runner")).toHaveAttribute("data-state", "off");

    const runs = await ev.n.q("select status, slot, model from judge_runs where company_id = $1 and type = 'PITCH' order by run_no", [kfj]);
    expect(runs.every((r) => r.status === "DONE" && r.slot === "BACKUP" && r.model === "fake-judge")).toBe(true);

    await twoClicks(page, "Switch back to the primary model", "Click again to switch back to the primary model (claude-opus-5-5)");
    await expect(said(page, "primary model")).toHaveText(
      "Runs claimed from now on use the primary model (claude-opus-5-5); runs already running finish as they are.",
    );
    await expect(page.getByTestId("judge-model")).toHaveText("Primaryclaude-opus-5-5In useBackupclaude-sonnet-5-5");
  });

  test("a re-run before release needs a reason and replaces the score as soon as its runs are done", async ({ page }) => {
    const kfj = s[3]!.company_id;
    const before = await ev.n.one("select final_score, tier_bp from scores where company_id = $1 and type = 'PITCH'", [kfj]);
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
    await page.getByRole("button", { name: "Show runs of KFJ" }).click();
    const detail = page.getByRole("region", { name: "Runs of KFJ" });
    await expect(detail.getByTestId("rerun")).toContainText("3 new runs are judged. The score goes back to judging and is sealed again from the new runs.");
    // The reason is checked without its spaces.
    await detail.getByLabel("Reason (at least 5 characters; logged)").fill("    no    ");
    await detail.getByRole("button", { name: "Re-run KFJ's pitch" }).click();
    await detail.getByRole("button", { name: "Click again to re-run KFJ's pitch" }).click();
    await expect(detail.getByRole("alert")).toHaveText("Give a reason (at least 5 characters).");
    await detail.getByLabel("Reason (at least 5 characters; logged)").fill("The judge timed out mid-answer.");
    await detail.getByRole("button", { name: "Re-run KFJ's pitch" }).click();
    await detail.getByRole("button", { name: "Click again to re-run KFJ's pitch" }).click();
    await expect(said(page, "Re-running")).toHaveText(
      "Re-running KFJ's pitch: 3 new runs are queued (generation 2). The score is sealed again when they are done.",
    );
    await expect(row(page, "KFJ").getByRole("cell").nth(9)).toHaveText("Judging: 0 of 3 runs done Re-run: waiting for the judge");
    await expect(detail.getByTestId("rerun-blocked")).toHaveText("The judge is still working on this submission: wait for its runs to finish.");

    const card = appealCard(page, "KFJ", "pitch");
    await expect(card).toContainText("Before release");
    await expect(card).toContainText("Waiting for the judge");
    await expect(card).toContainText("Reason: “The judge timed out mid-answer.”");
    await expect(card.getByTestId("appeal-score")).toHaveText(`${before.final_score} (${pct(before.tier_bp)}) → —`);
    await expect(card.getByTestId("appeal-runs")).toHaveText("0 of 3 done · 3 in flight (generation 2)");
    await expect(page.getByTestId("appeals-gate")).toContainText("None is open."); // before release it waits for no one

    // The console's judge works the new runs; they are sealed by themselves (the fake judge gives the same totals).
    await page.getByRole("button", { name: "Run the judge here" }).click();
    await expect(card).toContainText("Applied", { timeout: 60_000 });
    await expect(row(page, "KFJ").getByRole("cell").nth(9)).toHaveText("Sealed Re-run: applied");
    await expect(row(page, "KFJ").getByRole("cell").nth(2)).toContainText("(re-run 2)");
    await expect(detail.locator("thead")).toContainText("Generation");
    await expect(card).toContainText("Sealed from the new runs (before release).");
    await page.getByRole("button", { name: "Stop the judge here" }).click();
    expect(await ev.n.one("select status, after_release, generation from appeals where company_id = $1", [kfj])).toEqual({
      status: "APPLIED",
      after_release: false,
      generation: 2,
    });
    expect(await ev.n.one("select status, generation from scores where company_id = $1 and type = 'PITCH'", [kfj])).toEqual({ status: "SEALED", generation: 2 });
  });

  test("the fairness officer reads every run but cannot run the judge, switch the model, seal, release or re-run", async ({ page }) => {
    await loginAsStaff(page, ev, STAFF.fairness);
    await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
    await expect(page.getByText("Organisers start the judge, seal and release scores.")).toBeVisible();
    await expect(page.getByText("Organisers run the judge.")).toBeVisible();
    await expect(page.getByText("FAKE JUDGE", { exact: true })).toBeVisible();
    await expect(page.getByTestId("judge-runner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Release|Seal missing|Start judging|Retry|Switch/ })).toHaveCount(0);
    await expect(page.getByTestId("judge-model")).toHaveText("Primaryclaude-opus-5-5In useBackupclaude-sonnet-5-5");
    await page.getByRole("button", { name: "Show runs of KAQ" }).click();
    const detail = page.getByRole("region", { name: "Runs of KAQ" });
    await expect(detail.getByText("One. Two. Three. (run 3)")).toBeVisible();
    await expect(detail.getByTestId("rerun")).toContainText("Organisers re-run a submission.");
    await expect(appealCard(page, "KFJ", "pitch")).toContainText("Applied");
  });

  test("the release waits for call 1 to close, then sets every IPO price; a released pitch is never judged again", async ({ page }) => {
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
    await expect(summary(page, "Pitch")).toContainText("4 sealed · 0 released · 1 missing");

    await twoClicks(page, "Release pitch scores", "Click again to release pitch scores");
    await expect(alert(page)).toHaveText("CALL_1_OPEN: Pitch scores and IPO prices are released after consultant call 1 closes (23:15).");

    await ev.n.deadlinePassed("CALL_1");
    await twoClicks(page, "Release pitch scores", "Click again to release pitch scores");
    await expect(status(page).filter({ hasText: "Released" })).toHaveText("Released 4 pitch scores; IPO prices are set.");
    await expect(page.getByText(/^Released \d\d:\d\d$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Release pitch scores" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start judging" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start judging" })).toHaveAttribute("title", "Pitch scores have been released.");
    await expect(row(page, "KAQ").getByRole("cell").nth(9)).toHaveText("Released");
    await expect(row(page, "ZAAD").getByRole("cell").nth(9)).toHaveText("Released: missing (0)");
    await expect(summary(page, "Pitch")).toContainText("0 sealed · 4 released · 1 missing");

    const prices = await ev.n.q(
      "select c.ticker, c.ipo_price, s.tier_bp from companies c join scores s on s.company_id = c.id and s.type = 'PITCH' where c.event_id = $1 order by c.ticker",
      [ev.n.eventId],
    );
    expect(prices.map((p) => [p.ticker, p.ipo_price])).toEqual([
      ["KAQ", 1050],
      ["KFJ", Math.round(1000 * (1 + prices.find((p) => p.ticker === "KFJ")!.tier_bp / 10_000))],
      ["KSN", 1050],
      ["ZAAD", 900],
    ]);

    await page.getByRole("button", { name: "Show runs of KAQ" }).click();
    await expect(page.getByRole("region", { name: "Runs of KAQ" }).getByTestId("rerun-blocked")).toHaveText(
      "A released pitch score cannot be re-run: it has set the IPO price and the IPO is allocated.",
    );

    // Another type's tab starts clean: no message carried over from the pitch release.
    await page.getByRole("navigation", { name: "Submission type" }).getByRole("link", { name: "Plan" }).click();
    await expect(page.getByRole("heading", { name: "Plan scores" })).toBeVisible();
    await expect(status(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Release plan scores" })).toBeEnabled();
  });

  test("plan scores: judging and sealing wait for the plan and deal deadlines, and the release for Verdicts", async ({ page }) => {
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=plan`);
    await twoClicks(page, "Seal missing as 0", "Click again to seal missing plan scores as 0");
    await expect(alert(page)).toHaveText("NOT_READY: Missing scores are sealed after the submission deadline.");

    // Test-only: bring the plan and deal deadlines forward instead of playing the night to 03:00. The page re-reads
    // itself when the deadline passes: Start judging opens.
    await ev.n.deadlinePassed("PLAN");
    await ev.n.deadlinePassed("DEAL");
    await page.reload();
    await expect(page.getByRole("button", { name: "Start judging" })).toBeEnabled();
    await twoClicks(page, "Start judging", "Click again to start judging plan submissions");
    await expect(said(page, "Nothing to queue")).toHaveText("Nothing to queue: every current plan submission already has judge runs.");

    await twoClicks(page, "Seal missing as 0", "Click again to seal missing plan scores as 0");
    await expect(status(page).filter({ hasText: "Sealed" })).toHaveText("Sealed 4 missing plan scores as 0.");
    await expect(row(page, "KAQ").getByRole("cell").nth(6)).toHaveText("−20%");

    await twoClicks(page, "Release plan scores", "Click again to release plan scores");
    await expect(alert(page)).toHaveText("WRONG_PHASE: Plan scores are released at VERDICTS (03:30).");
    expect((await ev.n.one("select count(*)::int as n from scores where event_id = $1 and type = 'PLAN' and status = 'RELEASED'", [ev.n.eventId])).n).toBe(0);
  });

  test("on a phone the console fits the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
    await expect(page.getByTestId("judge-progress")).toBeVisible();
    await expect(appealCard(page, "KFJ", "pitch")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("appeals after release", () => {
  // Three squads at VERDICTS (re-seeded): plans released for EKA (70, 70, 70, capped at 50: no deal was signed) and
  // EKB (30), EKC sealed as missing (0). The appeal's runs are reported here as the judge worker would.
  let ev: E2eEvent;
  let s: Awaited<ReturnType<typeof trading>>;
  const ticker = (i: number) => `EK${"ABC"[i]}`;
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    ev = await seedE2eEvent({ slug: "e2e-judge", prefix: "K" }); // replaces the four-squad event
    s = await trading(ev);
    const n = ev.n;
    await n.advanceTo("CRISIS");
    await n.advanceTo("RESCUE_1");
    await n.deadlinePassed("FEE");
    await n.ok(n.lead, "tick", n.eventId); // the default fee for every squad
    const plan = (text: string) => ({
      crisis: text,
      new_plan: "License the software.",
      money: "Costs $40,000.",
      deal: "$40,000 at $7.00.",
      time_to_recovery: "Nine months.",
      risks: "Partners may refuse.",
      next_steps: "Sign two partners.",
    });
    for (const i of [0, 1]) {
      await n.ok(n.team(s[i]!.p_code), "save_draft", "PLAN", plan(`Company ${i + 1} rebuilds its supply.`), 0);
      await n.ok(n.team(s[i]!.p_code), "submit_submission", "PLAN");
    }
    await n.advanceTo("RESCUE_2");
    await n.deadlinePassed("PLAN");
    await n.deadlinePassed("DEAL");
    await n.advanceTo("PLANS_PUBLISHED");
    expect((await n.judge(s[0]!.company_id, "PLAN", [70, 70, 70])).ok).toBe(true);
    expect((await n.judge(s[1]!.company_id, "PLAN", [30, 30, 30])).ok).toBe(true);
    await n.org("seal_missing_scores", n.eventId, "PLAN");
    await n.advanceTo("VERDICTS");
    await n.org("release_scores", n.eventId, "PLAN");
  });

  /** The judge worker's part for an appeal's runs: claim them, log the injection check, report each total. */
  async function workAppeal(totals: number[]) {
    const runs: { run_id: string; submission_id: string; attempts: number; claim_token: number }[] = await ev.n.call(service, "claim_judge_runs", ev.n.eventId, 10);
    expect(runs).toHaveLength(totals.length);
    await ev.n.ok(service, "record_injections", runs[0]!.submission_id, "[]");
    for (const [i, t] of totals.entries()) await ev.n.ok(service, "finish_judge_run", runs[i]!.run_id, { ...output("PLAN", t), attempt: runs[i]!.claim_token });
  }

  test("an appeal of a released plan: the new score waits, Apply names the change and says what moved", async ({ page, browser }) => {
    const eka = s[0]!.company_id;
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=plan`);
    await expect(row(page, ticker(0)).getByRole("cell").nth(5)).toHaveText("50");
    await page.getByRole("button", { name: `Show runs of ${ticker(0)}` }).click();
    const detail = page.getByRole("region", { name: `Runs of ${ticker(0)}` });
    await expect(detail.getByTestId("rerun")).toContainText("The score has been released, so this is an appeal");
    await detail.getByLabel("Reason (at least 5 characters; logged)").fill("The judge's answer was cut off (max tokens).");
    await detail.getByRole("button", { name: `Re-run ${ticker(0)}'s plan` }).click();
    await detail.getByRole("button", { name: `Click again to re-run ${ticker(0)}'s plan as an appeal` }).click();
    await expect(said(page, "Appeal opened")).toHaveText(
      `Appeal opened: 3 new runs of ${ticker(0)}'s plan are queued (generation 2). The released score stays until you apply or dismiss the new one.`,
    );
    await expect(row(page, ticker(0)).getByRole("cell").nth(9)).toHaveText("Released Re-run: waiting for the judge");
    const card = appealCard(page, ticker(0), "plan");
    await expect(card).toContainText("After release");
    await expect(card).toContainText("Waiting for the judge");
    await expect(card.getByTestId("appeal-score")).toHaveText("50 (0%) → —");
    await expect(card.getByTestId("appeal-runs")).toHaveText("0 of 3 done · 3 in flight (generation 2)");
    await expect(card).toContainText("The new score can be applied once the judge has finished its runs.");
    await expect(card.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(page.getByTestId("appeals-gate")).toContainText("1 is open.");

    // The worker reports 40, 40, 42: the appeal is ready (a broadcast refreshes the page).
    await workAppeal([40, 40, 42]);
    await expect(card).toContainText("New score ready");
    await expect(card.getByTestId("appeal-score")).toHaveText("50 (0%) → 40 (−10%)");
    await expect(card.getByTestId("appeal-runs")).toHaveText("3 of 3 done (generation 2)");
    await expect(page.getByRole("main").getByText(/^1 appeal has a new score waiting/)).toBeVisible();
    await expect(row(page, ticker(0)).getByRole("cell").nth(9)).toHaveText("Released New score ready: apply or dismiss");
    await expect(row(page, ticker(0)).getByRole("cell").nth(5)).toHaveText("50"); // the released score stays until it is applied
    await expect(detail.getByTestId("rerun-blocked")).toHaveText("A new score is waiting: apply or dismiss it under Appeals and re-runs first.");

    // The fairness officer sees it, read-only.
    const fairness = await as(browser, ev, STAFF.fairness, `/admin/${ev.slug}/judge?type=plan`);
    await expect(appealCard(fairness.page, ticker(0), "plan")).toContainText("New score ready");
    await expect(appealCard(fairness.page, ticker(0), "plan")).toContainText("Organisers apply or dismiss an appeal.");
    await expect(fairness.page.getByRole("button", { name: /Apply|Dismiss/ })).toHaveCount(0);
    await fairness.close();

    const aiBefore = (await ev.n.one("select ai_price from companies where id = $1", [eka])).ai_price as number;
    await card.getByRole("button", { name: "Apply the new score" }).click();
    await card.getByRole("button", { name: `Click again to apply ${ticker(0)} plan 50 → 40` }).click();
    await expect(said(page, "Applied:")).toBeVisible();
    const aiAfter = (await ev.n.one("select ai_price from companies where id = $1", [eka])).ai_price as number;
    expect(aiAfter).toBeLessThan(aiBefore);
    await expect(said(page, "Applied:")).toHaveText(
      `Applied: ${ticker(0)} plan score 50 → 40; tier 0% → −10%; AI price ${formatCents(aiBefore)} → ${formatCents(aiAfter)}.`,
    );
    await expect(card).toContainText("Applied");
    await expect(card.getByRole("list", { name: `What applying the re-run of ${ticker(0)} changed` }).getByRole("listitem")).toHaveText([
      "Score 50 → 40",
      "Tier 0% → −10%",
      `AI price ${formatCents(aiBefore)} → ${formatCents(aiAfter)}`,
    ]);
    await expect(row(page, ticker(0)).getByRole("cell").nth(5)).toHaveText("40");
    await expect(row(page, ticker(0)).getByRole("cell").nth(6)).toHaveText("−10%");
    await expect(row(page, ticker(0)).getByRole("cell").nth(9)).toHaveText("Released Re-run: applied");
    await expect(page.getByTestId("appeals-gate")).toContainText("None is open.");
    expect(await ev.n.one("select status from appeals where company_id = $1 and type = 'PLAN'", [eka])).toEqual({ status: "APPLIED" });
    expect(await ev.n.one("select final_score, status from scores where company_id = $1 and type = 'PLAN'", [eka])).toEqual({ final_score: 40, status: "RELEASED" });
  });

  test("a dismissed appeal keeps the released score, and its runs never count", async ({ page }) => {
    const ekb = s[1]!.company_id;
    await loginAsStaff(page, ev, STAFF.lead);
    await page.goto(`/admin/${ev.slug}/judge?type=plan`);
    await page.getByRole("button", { name: `Show runs of ${ticker(1)}` }).click();
    const detail = page.getByRole("region", { name: `Runs of ${ticker(1)}` });
    await detail.getByLabel("Reason (at least 5 characters; logged)").fill("A team says the judge misread the plan.");
    await detail.getByRole("button", { name: `Re-run ${ticker(1)}'s plan` }).click();
    await detail.getByRole("button", { name: `Click again to re-run ${ticker(1)}'s plan as an appeal` }).click();
    const card = appealCard(page, ticker(1), "plan");
    await expect(card).toContainText("Waiting for the judge");

    // A reason is needed.
    await card.getByLabel("Reason to keep the released score (at least 5 characters; logged)").fill("Re-read: the plan was judged correctly.");
    await card.getByRole("button", { name: "Dismiss" }).click();
    await card.getByRole("button", { name: `Click again to dismiss the re-run of ${ticker(1)}'s plan` }).click();
    await expect(said(page, "Appeal dismissed")).toHaveText(`Appeal dismissed: ${ticker(1)}'s released plan score stays.`);
    await expect(card).toContainText("Dismissed");
    await expect(card).toContainText("“Re-read: the plan was judged correctly.”");
    await expect(row(page, ticker(1)).getByRole("cell").nth(9)).toHaveText("Released Re-run: dismissed");
    // The released runs (generation 1) stay in the row; the dismissed ones are not failed runs to retry.
    await expect(row(page, ticker(1)).getByRole("cell").nth(2)).toHaveText("30 30 30test-model");
    await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
    expect(await ev.n.q("select status, error from judge_runs where company_id = $1 and type = 'PLAN' and generation = 2", [ekb])).toEqual(
      Array.from({ length: 3 }, () => ({ status: "FAILED", error: "The appeal was dismissed." })),
    );
    expect(await ev.n.one("select final_score from scores where company_id = $1 and type = 'PLAN'", [ekb])).toEqual({ final_score: 30 });
  });
});
