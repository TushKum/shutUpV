import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { checkLotteryRecord, sha256Hex, type LotteryRecord } from "@msim/engine";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { seedOf, squads } from "./support/game";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-lottery", prefix: "D" });
});

const lotteryPage = (page: Page) => page.goto(`/admin/${ev.slug}/lottery`);
const panel = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("an organiser publishes the seed commitment in Setup; it is read-only once the event has started", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await lotteryPage(page);
  const commitment = panel(page, "Seed commitment");
  await expect(commitment.getByText("Not published yet")).toBeVisible();
  await expect(panel(page, "Draw").getByText("The draw is entered in the Squad draw phase (21:00). The event is in Setup.")).toBeVisible();

  // A first commitment, then a replacement (allowed while in Setup); upper case is accepted and stored in lower case.
  await commitment.getByLabel("Commitment (64 hex characters)").fill(sha256Hex("an earlier seed").toUpperCase());
  await commitment.getByRole("button", { name: "Save commitment" }).click();
  await expect(commitment.getByRole("status")).toHaveText("Commitment saved. It is fixed once the event starts.");
  await expect(page.getByTestId("commitment")).toHaveText(sha256Hex("an earlier seed"));

  await commitment.getByLabel("Commitment (64 hex characters)").fill(sha256Hex(seedOf(ev)));
  await commitment.getByRole("button", { name: "Replace commitment" }).click();
  await expect(page.getByTestId("commitment")).toHaveText(sha256Hex(seedOf(ev)));
  expect((await ev.n.one("select seed_commitment from events where id = $1", [ev.n.eventId])).seed_commitment).toBe(sha256Hex(seedOf(ev)));

  await ev.n.advanceTo("CHECKIN");
  await page.reload();
  await expect(page.getByText("The commitment is fixed once the event has started.")).toBeVisible();
  await expect(page.getByLabel("Commitment (64 hex characters)")).toHaveCount(0);
  await expect(page.getByTestId("commitment")).toHaveText(sha256Hex(seedOf(ev)));
  // The database refuses a late change anyway.
  const late = await ev.n.call(ev.n.lead, "set_seed_commitment", ev.n.eventId, sha256Hex("x")).catch((e: Error) => e.message);
  expect(late).toMatch(/fixed once the event has started/);
});

test("the draw: a wrong seed is refused (COMMITMENT_MISMATCH) and changes nothing; the right one draws, verified independently", async ({ page }) => {
  await ev.n.advanceTo("SQUAD_DRAW");
  await loginAsStaff(page, ev, STAFF.lead);
  await lotteryPage(page);
  const draw = panel(page, "Draw");

  await draw.getByLabel("Secret seed (64 hex characters)").fill(sha256Hex("not the seed"));
  await draw.getByLabel("Dice roll").fill("4");
  await draw.getByRole("button", { name: "Verify the seed and draw" }).click();
  await draw.getByRole("button", { name: "Click again to draw with dice 4" }).click();
  await expect(draw.getByRole("alert")).toHaveText("COMMITMENT_MISMATCH: SHA-256 of that seed does not match the published commitment.");
  expect((await ev.n.one("select drawn_at from events where id = $1", [ev.n.eventId])).drawn_at).toBeNull();
  // The fields keep what was typed after a refusal.
  await expect(draw.getByLabel("Dice roll")).toHaveValue("4");

  await draw.getByLabel("Secret seed (64 hex characters)").fill(seedOf(ev));
  await draw.getByRole("button", { name: "Verify the seed and draw" }).click();
  // The confirmation names the dice: changed after the first click, the next click only asks again.
  await draw.getByLabel("Dice roll").fill("5");
  await draw.getByRole("button", { name: "Click again to draw with dice 4" }).click();
  await expect(draw.getByRole("button", { name: "Click again to draw with dice 5" })).toBeVisible();
  expect((await ev.n.one("select drawn_at from events where id = $1", [ev.n.eventId])).drawn_at).toBeNull();
  await draw.getByLabel("Dice roll").fill("4");
  await draw.getByRole("button", { name: "Click again to draw with dice 5" }).click();
  await draw.getByRole("button", { name: "Click again to draw with dice 4" }).click();

  await expect(page.getByText("Draw verified.")).toBeVisible();
  await expect(page.getByText("Seed matches commitment", { exact: true })).toBeVisible();
  await expect(page.getByText("Secret until the crisis", { exact: true })).toBeVisible();
  const drawn = panel(page, "Draw");
  await expect(drawn.getByText(sha256Hex(seedOf(ev)))).toBeVisible();
  expect((await ev.n.one("select dice from events where id = $1", [ev.n.eventId])).dice).toBe("4");

  // The squads table shows exactly what the database stored.
  const stored = await squads(ev);
  const rows = panel(page, "Squads").locator("tbody tr");
  await expect(rows).toHaveCount(stored.length);
  for (const [i, s] of stored.entries()) {
    const row = rows.nth(i);
    await expect(row.locator("td").nth(0)).toHaveText(String(s.number));
    await expect(row.locator("td").nth(1)).toHaveText(s.p_code);
    await expect(row.locator("td").nth(2)).toHaveText(s.c_code);
    await expect(row.locator("td").nth(3)).toHaveText(s.f_code);
    const dealt = await ev.n.q(
      "select pc.number from squads s cross join unnest(s.dealt_card_ids) with ordinality d(id, i) join problem_cards pc on pc.id = d.id where s.id = $1 order by d.i",
      [s.id],
    );
    await expect(row.locator("td").nth(4)).toHaveText(dealt.map((d) => `#${d.number}`).join(" · "));
    await expect(row.locator("td").nth(5)).toHaveText("Not picked yet");
    const covers = await ev.n.q(
      "select t.code from coverage cv join companies co on co.id = cv.company_id join teams t on t.id = co.product_team_id where cv.consultant_team_id = $1 order by t.code",
      [s.consulting_team_id],
    );
    await expect(row.locator("td").nth(6)).toHaveText(covers.map((c) => c.code).join(", "));
  }
});

test("the problem-card picks show as picked or default", async ({ page }) => {
  const s1 = await ev.n.squad(1);
  const second = (await ev.n.one("select dealt_card_ids[2] as id from squads where id = $1", [s1.id])).id;
  await ev.n.ok(ev.n.team(s1.p_code), "pick_problem_card", second);
  await ev.n.deadlinePassed("PROBLEM_PICK");
  await ev.n.org("tick", ev.n.eventId);

  await loginAsStaff(page, ev, STAFF.second);
  await lotteryPage(page);
  const rows = panel(page, "Squads").locator("tbody tr");
  const picked = await ev.n.one("select number, title from problem_cards where id = $1", [second]);
  await expect(rows.nth(0).locator("td").nth(5)).toHaveText(`#${picked.number}${picked.title}Picked`);
  const s2 = await ev.n.one("select pc.number, pc.title from squads s join problem_cards pc on pc.id = s.dealt_card_ids[1] where s.event_id = $1 and s.number = 2", [ev.n.eventId]);
  await expect(rows.nth(1).locator("td").nth(5)).toHaveText(`#${s2.number}${s2.title}Default`);
});

test("the lottery record downloads in the verify-lottery format and checks out", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await lotteryPage(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download the lottery record (JSON)" }).click()]);
  expect(download.suggestedFilename()).toBe("lottery-record-e2e-lottery.json");
  const record = JSON.parse(readFileSync((await download.path())!, "utf8")) as LotteryRecord;
  expect(record.seed).toBe(seedOf(ev));
  expect(record.dice).toBe("4");
  expect(record.squads).toHaveLength(3);
  expect(record.teams.product).toEqual(ev.plan.teams.filter((t) => t.track === "PRODUCT").map((t) => t.code).sort());
  expect(checkLotteryRecord(record, sha256Hex(seedOf(ev)))).toEqual([]);
});

test("the record contains the secret seed: a team cannot download it", async ({ page }) => {
  const code = ev.plan.teams.find((t) => t.track === "FINANCE")!.code;
  await loginAsTeam(page, ev, code);
  const r = await page.request.get(`/admin/${ev.slug}/lottery/record`);
  expect(r.status()).toBe(403);
  expect(await r.text()).not.toContain(seedOf(ev));
});

test("the fairness officer sees the draw and can download the record, but has no forms", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await lotteryPage(page);
  await expect(page.getByText("Draw verified.")).toBeVisible();
  await expect(page.getByLabel("Secret seed (64 hex characters)")).toHaveCount(0);
  await expect(page.getByLabel("Commitment (64 hex characters)")).toHaveCount(0);
  const r = await page.request.get(`/admin/${ev.slug}/lottery/record`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-disposition"]).toBe('attachment; filename="lottery-record-e2e-lottery.json"');
  expect(checkLotteryRecord((await r.json()) as LotteryRecord)).toEqual([]);
});

test("a stored draw that differs from the engine's is shown with the differences", async ({ page }) => {
  // Test-only tampering: squad 1's dealt cards in another order.
  const reverse = "update squads set dealt_card_ids = array[dealt_card_ids[3], dealt_card_ids[2], dealt_card_ids[1]] where event_id = $1 and number = 1";
  await ev.n.q(reverse, [ev.n.eventId]);
  try {
    await loginAsStaff(page, ev, STAFF.lead);
    await lotteryPage(page);
    await expect(page.getByText("The stored draw differs from the engine's (1):")).toBeVisible();
    await expect(page.getByText(/^squad 1: problem cards should be #?\d+, \d+, \d+, the record says \d+, \d+, \d+$/)).toBeVisible();
    await expect(page.getByText("Draw verified.")).toHaveCount(0);
  } finally {
    await ev.n.q(reverse, [ev.n.eventId]);
  }
});

test("after the crisis the seed is shown as revealed and the check and the record include each company's crisis card", async ({ page }) => {
  await ev.n.q("select app.apply_crisis($1)", [ev.n.eventId]); // test-only: the 00:30 crisis draw, without the night before it
  await loginAsStaff(page, ev, STAFF.lead);
  await lotteryPage(page);
  await expect(page.getByText("Revealed at the crisis", { exact: true })).toBeVisible();
  await expect(panel(page, "Draw").getByText(seedOf(ev), { exact: true })).toBeVisible();
  await expect(page.getByText("Draw verified. All 3 squads, their dealt problem cards, the coverage and the crisis cards are exactly what the seed and the dice produce.")).toBeVisible();
  const r = await page.request.get(`/admin/${ev.slug}/lottery/record`);
  const record = (await r.json()) as LotteryRecord;
  expect(record.crises).toHaveLength(3);
  expect(record.crisisDeck).toHaveLength(10);
  const stored = await ev.n.q(
    "select s.number as squad, cc.category || ' #' || cc.number as card from companies co join squads s on s.id = co.squad_id join crisis_cards cc on cc.id = co.crisis_card_id where co.event_id = $1 order by s.number",
    [ev.n.eventId],
  );
  expect(record.crises).toEqual(stored);
  expect(checkLotteryRecord(record, sha256Hex(seedOf(ev)))).toEqual([]);
});
