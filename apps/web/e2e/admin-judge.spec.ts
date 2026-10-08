import { expect, test, type Page } from "@playwright/test";
import { RUBRICS } from "@msim/engine";
import { service } from "../../../supabase/tests/helpers";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

// Three squads in READING: KAQ judged and sealed (64, 66, 68), KSN judged with a spread of 20 (50, 70, 62: it needs
// 2 more runs), and squad 3 with no pitch (it gets the default ticker ZAAD at READING).
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: "e2e-judge", prefix: "K" });
  s = await drawn(ev);
  await ev.n.advanceTo("BUILD");
  for (const [i, ticker] of ["KAQ", "KSN"].entries()) {
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

/** A breakdown that fits the rubric and adds up to `total` (as the judge worker would store). */
function breakdown(total: number) {
  let left = total;
  return Object.fromEntries(
    RUBRICS.PITCH.map((line) => {
      const v = Math.min(line.max, left);
      left -= v;
      return [line.key, v];
    }),
  );
}

const row = (page: Page, label: string) => page.getByRole("row", { name: new RegExp(`^${label}\\b`) });
const summary = (page: Page, type: string) => page.getByLabel(`${type} summary`);
// An action's result (Next's route announcer is an alert too, outside main).
const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

test("an organiser sees every company's runs, spread and median, and why the release is refused", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/judge`);
  await expect(page.getByText(/come in Phase 6/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pitch scores" })).toBeVisible(); // READING shows pitches first

  await expect(summary(page, "Pitch")).toContainText("Companies3");
  await expect(summary(page, "Pitch")).toContainText("2 · 1 without");
  await expect(summary(page, "Pitch")).toContainText("6 done · 0 running · 0 queued · 0 failed");
  await expect(summary(page, "Pitch")).toContainText("1 sealed · 0 released · 0 missing");
  await expect(summary(page, "Plan")).toContainText("None yet");

  // Company, submission, runs, spread, median, final, tier, capped, penalty, status.
  await expect(row(page, "KAQ").getByRole("cell")).toHaveText([
    "KAQ Company KAQ",
    /^\d\d:\d\d · 20 words$/,
    "64 66 68",
    "4",
    "66",
    "66",
    "+5%",
    "No",
    "0",
    "Sealed",
    "Runs (3)",
  ]);
  await expect(row(page, "KSN").getByRole("cell")).toHaveText([
    "KSN Company KSN",
    /words$/,
    "50 70 62",
    "20",
    "—",
    "—",
    "—",
    "—",
    "—",
    "Spread over 10: needs 2 more runs",
    "Runs (3)",
  ]);
  await expect(row(page, "ZAAD").getByRole("cell").nth(1)).toHaveText("None");
  await expect(row(page, "ZAAD").getByRole("cell").nth(9)).toHaveText("No submission");

  // The detail of every run: model, status, total, breakdown, rationale; and the published (median) run.
  await page.getByRole("button", { name: "Show runs of KAQ" }).click();
  const detail = page.getByRole("region", { name: "Runs of KAQ" });
  await expect(detail.getByText("Problem: Unsafe water in small towns.", { exact: false })).toBeVisible();
  await expect(detail.getByText("One. Two. Three. (run 2)").first()).toBeVisible(); // the published rationale: the first run at the median
  await expect(detail.getByText("From the first run whose total equals the median (66).")).toBeVisible();
  const run1 = detail.getByRole("row").filter({ hasText: "One. Two. Three. (run 1)" });
  await expect(run1).toContainText("test-model");
  await expect(run1).toContainText("DONE");
  await expect(run1).toContainText("How the company makes money14/25");
  await expect(run1).toContainText("Advantage over other options0/25");
  await page.getByRole("button", { name: "Hide runs of KAQ" }).click();
  await expect(detail).toHaveCount(0);

  // Two clicks, and the database's reason is shown.
  await page.getByRole("button", { name: "Release pitch scores" }).click();
  await page.getByRole("button", { name: "Click again to release pitch scores" }).click();
  await expect(alert(page)).toHaveText("NOT_READY: 2 companies have no sealed PITCH score yet.");

  await page.getByRole("button", { name: "Seal missing as 0" }).click();
  await page.getByRole("button", { name: "Click again to seal missing pitch scores as 0" }).click();
  await expect(status(page).filter({ hasText: "Sealed" })).toHaveText("Sealed 1 missing pitch score as 0.");
  await expect(row(page, "ZAAD").getByRole("cell").nth(5)).toHaveText("0");
  await expect(row(page, "ZAAD").getByRole("cell").nth(6)).toHaveText("−10%");
  await expect(row(page, "ZAAD").getByRole("cell").nth(9)).toHaveText("Sealed: missing (0)");
  await expect(summary(page, "Pitch")).toContainText("2 sealed · 0 released · 1 missing");
});

test("the page follows the judge's progress without a reload while runs are in flight", async ({ page }) => {
  const sub = await ev.n.one("select id from submissions where company_id = $1 and type = 'PITCH' and superseded_at is null", [s[1]!.company_id]);
  const insert = (runNo: number, status: string) =>
    ev.n.q(
      `insert into judge_runs (event_id, submission_id, company_id, type, generation, run_no, model, status, attempts)
       values ($1, $2, $3, 'PITCH', 1, $4, 'test-model', $5, 1)`,
      [ev.n.eventId, sub.id, s[1]!.company_id, runNo, status],
    );
  await insert(4, "RUNNING");
  await insert(5, "QUEUED");

  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
  await expect(row(page, "KSN").getByRole("cell").nth(9)).toHaveText("Judging: 3 of 5 runs done");
  await expect(summary(page, "Pitch")).toContainText("6 done · 1 running · 1 queued · 0 failed");

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
  await expect(row(page, "KSN").getByRole("cell").nth(2)).toHaveText("50 70 62 60 61");
  await expect(row(page, "KSN").getByRole("cell").nth(4)).toHaveText("61 (unsealed)");

  await page.getByRole("button", { name: "Show runs of KSN" }).click();
  const run5 = page.getByRole("region", { name: "Runs of KSN" }).getByRole("row").filter({ hasText: "Extra run 5." });
  await expect(run5).toContainText("1.2 s");

  // The worker seals it (service role): 5 runs, median 61, +5%.
  expect((await ev.n.call(service, "seal_score", s[1]!.company_id, "PITCH")).ok).toBe(true);
  await page.reload();
  await expect(row(page, "KSN").getByRole("cell")).toHaveText([/^KSN/, /words$/, "50 70 62 60 61", "20", "61", "61", "+5%", "No", "0", "Sealed", "Runs (5)"]);
});

test("the fairness officer reads every run but cannot seal or release", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
  await expect(page.getByText("Organisers seal and release scores.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Release|Seal missing/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Show runs of KAQ" }).click();
  await expect(page.getByRole("region", { name: "Runs of KAQ" }).getByText("One. Two. Three. (run 3)")).toBeVisible();
});

test("the release waits for call 1 to close, then sets every IPO price", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/judge?type=pitch`);
  await expect(summary(page, "Pitch")).toContainText("3 sealed · 0 released · 1 missing");

  await page.getByRole("button", { name: "Release pitch scores" }).click();
  await page.getByRole("button", { name: "Click again to release pitch scores" }).click();
  await expect(alert(page)).toHaveText("CALL_1_OPEN: Pitch scores and IPO prices are released after consultant call 1 closes (23:15).");

  await ev.n.deadlinePassed("CALL_1");
  await page.getByRole("button", { name: "Release pitch scores" }).click();
  await page.getByRole("button", { name: "Click again to release pitch scores" }).click();
  await expect(status(page).filter({ hasText: "Released" })).toHaveText("Released 3 pitch scores; IPO prices are set.");
  await expect(page.getByText(/^Released \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Release pitch scores" })).toBeDisabled();
  await expect(row(page, "KAQ").getByRole("cell").nth(9)).toHaveText("Released");
  await expect(row(page, "ZAAD").getByRole("cell").nth(9)).toHaveText("Released: missing (0)");
  await expect(summary(page, "Pitch")).toContainText("0 sealed · 3 released · 1 missing");

  const prices = await ev.n.q("select ticker, ipo_price from companies where event_id = $1 order by ticker", [ev.n.eventId]);
  expect(prices).toEqual([
    { ticker: "KAQ", ipo_price: 1050 },
    { ticker: "KSN", ipo_price: 1050 },
    { ticker: "ZAAD", ipo_price: 900 },
  ]);

  // Another type's tab starts clean: no message carried over from the pitch release.
  await page.getByRole("navigation", { name: "Submission type" }).getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan scores" })).toBeVisible();
  await expect(status(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Release plan scores" })).toBeEnabled();
});

test("plan scores: sealing waits for the plan and deal deadlines, and the release for Verdicts", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/judge?type=plan`);
  await page.getByRole("button", { name: "Seal missing as 0" }).click();
  await page.getByRole("button", { name: "Click again to seal missing plan scores as 0" }).click();
  await expect(alert(page)).toHaveText("NOT_READY: Missing scores are sealed after the submission deadline.");

  // Test-only: bring the plan and deal deadlines forward instead of playing the night to 03:00.
  await ev.n.deadlinePassed("PLAN");
  await ev.n.deadlinePassed("DEAL");
  await page.getByRole("button", { name: "Seal missing as 0" }).click();
  await page.getByRole("button", { name: "Click again to seal missing plan scores as 0" }).click();
  await expect(status(page).filter({ hasText: "Sealed" })).toHaveText("Sealed 3 missing plan scores as 0.");
  await expect(row(page, "KAQ").getByRole("cell").nth(6)).toHaveText("−20%");

  await page.getByRole("button", { name: "Release plan scores" }).click();
  await page.getByRole("button", { name: "Click again to release plan scores" }).click();
  await expect(alert(page)).toHaveText("WRONG_PHASE: Plan scores are released at VERDICTS (03:30).");
  expect((await ev.n.one("select count(*)::int as n from scores where event_id = $1 and type = 'PLAN' and status = 'RELEASED'", [ev.n.eventId])).n).toBe(0);
});
