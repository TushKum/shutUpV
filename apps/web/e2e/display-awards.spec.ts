import { expect, test, type Page } from "@playwright/test";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's late takeovers: the flash news, the closing bell and the awards. A whole night would be too slow,
// so after the IPO the state is written directly where the game functions cannot be reached quickly (the phase, the
// closing prices, the results and awards), as the database tests do; the flash bulletin and the step into AWARDS
// still go through the real functions and arrive live. Team names appear only at AWARDS.

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 720 } });

let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
test.beforeAll(async () => {
  test.setTimeout(180_000);
  ev = await seedE2eEvent({ slug: "e2e-display-awards", prefix: "V" });
  s = await trading(ev); // three companies EVA, EVB, EVC at $10.50
});

async function screen(page: Page) {
  await page.context().clearCookies();
  await loginAsStaff(page, ev, STAFF.display);
  await page.goto(`/display/${ev.slug}`);
  await expect(page.locator("[data-realtime=SUBSCRIBED]")).toBeVisible();
}

async function noTeamNames(page: Page) {
  const text = await page.getByTestId("stage").innerText();
  for (const t of ev.plan.teams) expect(text, t.code).not.toContain(t.name);
}

const setPhase = (phase: string) =>
  ev.n.q("update events set current_phase = $2::phase_code, phase_started_at = now() where id = $1", [ev.n.eventId, phase]);

/** Whether the flash news box shows everything it holds (nothing spills out of the content area). */
const flashFits = (page: Page) => page.getByTestId("flash-news").evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);

const BODY =
  "The central bank raised rates by two points overnight. Investors now want a path to profit within 12 months, and lenders " +
  "have stopped rolling over short-term loans for companies without revenue.\n\nEvery Product team answers in up to 150 words: " +
  "how does the rescue plan reach profit within 12 months, and what changes if the deal money arrives late? The answers are " +
  "judged with the same rubric for everyone, and the flash tier moves every price after round 17. Funds: the market reopens " +
  "for round 16 as usual, and the verdicts arrive at 04:20.";

test("the flash news shows the bulletin's title and body, live, as large as fits", async ({ page }) => {
  // The flash bulletin is published during rounds 13–21 (04:00); the phase is set directly.
  await setPhase("ROUNDS_13_21");
  await screen(page);
  await ev.n.org("prepare_flash_bulletin", ev.n.eventId, "Interest rates rise", BODY);
  await ev.n.org("publish_flash_bulletin", ev.n.eventId);
  await expect(page.getByRole("heading", { name: "Flash news" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("flash-title")).toHaveText("Interest rates rise");
  await expect(page.getByTestId("flash-body")).toHaveText(BODY);
  expect(await flashFits(page)).toBe(true);
  await noTeamNames(page);

  // A body far too long for the screen: the size steps down to the smallest, then it ends after the last whole word
  // that fits, with an ellipsis.
  const long = `${BODY}\n\n`.repeat(9).slice(0, 4000).trim();
  await ev.n.q("update bulletins set body = $2 where event_id = $1 and kind = 'FLASH'", [ev.n.eventId, long]);
  await page.reload();
  await expect(page.getByTestId("flash-news")).toHaveAttribute("data-clamped", "true");
  await expect(page.getByTestId("flash-news")).toHaveAttribute("data-size", "28");
  expect(await flashFits(page)).toBe(true);
  const shown = (await page.getByTestId("flash-body").textContent())!;
  expect(shown.endsWith("…")).toBe(true);
  expect(shown.length).toBeLessThan(long.length);
  expect(long.startsWith(shown.slice(0, -1))).toBe(true);
  expect(long[shown.length - 1]).toMatch(/\s/); // cut between words
});

test("the closing bell shows the top gainers and losers from the IPO price, and no fund or team", async ({ page }) => {
  // 05:00: closing prices are written as close_market would (its price-writer setting), and the market closes.
  await ev.n.q(
    `select set_config('app.price_writer', 'CLOSE', true);
     update companies set closing_price = case ticker when 'EVA' then 1313 when 'EVB' then 945 else 1050 end where event_id = '${ev.n.eventId}';
     update events set current_phase = 'CLOSE', phase_started_at = now(), market_closed_at = now() where id = '${ev.n.eventId}';`,
  );
  await screen(page);
  await expect(page.getByRole("heading", { name: "Closing bell" })).toBeVisible();
  await expect(page.getByTestId("closing-headline")).toHaveText("The market is closed");
  // $10.50 → $13.13 is +25.05% (2504.76 bp, half-up); $10.50 → $9.45 is −10%; EVC closed at its IPO price.
  await expect(page.getByTestId("closing-gainers-EVA")).toContainText("$10.50 → $13.13");
  await expect(page.getByTestId("closing-gainers-EVA")).toContainText("+25.05%");
  await expect(page.getByTestId("closing-gainers-EVA")).toContainText("Company 1");
  await expect(page.getByTestId("closing-losers-EVB")).toContainText("$10.50 → $9.45");
  await expect(page.getByTestId("closing-losers-EVB")).toContainText("−10%");
  await expect(page.getByTestId("stage")).not.toContainText("EVC");
  await expect(page.getByTestId("closing-awards")).toHaveText("Final results are announced at the awards.");
  await noTeamNames(page);
});

test("before AWARDS no team name is on the screen; at AWARDS the podiums and the special awards appear live", async ({ page }) => {
  // Settlement wrote results and awards (as in supabase/tests/display.test.ts); the fairness officer is deciding flags.
  const team = (code: string) => ev.n.teamId(code);
  const product = ev.plan.teams.filter((t) => t.track === "PRODUCT").map((t) => t.code);
  const consulting = ev.plan.teams.filter((t) => t.track === "CONSULTING").map((t) => t.code);
  const finance = ev.plan.teams.filter((t) => t.track === "FINANCE").map((t) => t.code);
  for (const [i, t] of ev.plan.teams.entries()) {
    await ev.n.q(
      "insert into results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, rank) values ($1, $2, $3, $4, 50000000, $5, 1)",
      [ev.n.eventId, team(t.code), t.track, 50_000_000 + i * 1_000_000, i * 200],
    );
  }
  const award = (code: string, place: number, teamCode: string | null, metric: object, companyId: string | null = null) =>
    ev.n.q("insert into awards (event_id, code, place, team_id, company_id, metric) values ($1, $2, $3, $4, $5, $6)", [
      ev.n.eventId,
      code,
      place,
      teamCode ? team(teamCode) : null,
      companyId,
      metric,
    ]);
  // Product: a tie for second place (1, 2, 2).
  await award("PRODUCT_TOP3", 1, product[1]!, { final_value: 73_413_000, return_bp: 46_826 });
  await award("PRODUCT_TOP3", 2, product[0]!, { final_value: 57_488_000, return_bp: 14_976 });
  await award("PRODUCT_TOP3", 2, product[2]!, { final_value: 57_488_000, return_bp: 14_976 });
  await award("CONSULTING_TOP3", 1, consulting[2]!, { final_value: 6_663_000, return_bp: 3_326 });
  await award("CONSULTING_TOP3", 2, consulting[0]!, { final_value: 5_500_000, return_bp: 1_000 });
  await award("CONSULTING_TOP3", 3, consulting[1]!, { final_value: 4_900_000, return_bp: -200 });
  await award("FINANCE_TOP3", 1, finance[0]!, { final_value: 61_000_000, return_bp: 2_200 });
  await award("FINANCE_TOP3", 2, finance[2]!, { final_value: 52_500_000, return_bp: 500 });
  await award("FINANCE_TOP3", 3, finance[1]!, { final_value: 48_000_000, return_bp: -400 });
  await award("BEST_TURNAROUND", 1, s[0]!.p_code, { closing_price: 1313, post_crisis_price: 893 }, s[0]!.company_id);
  await award("BEST_RESCUE_PLAN", 1, s[1]!.p_code, { score: 88, median: 88 }, s[1]!.company_id);
  await award("BEST_JUDGING_FUND", 1, finance[1]!, { ai_value: 52_000_000, return_bp: 400 });

  // APPEALS, with every earlier takeover long over (the stored moments moved back): the board, and no team name.
  await setPhase("APPEALS");
  await ev.n.q(
    `update events set drawn_at = drawn_at - interval '30 minutes', market_closed_at = now() - interval '10 minutes' where id = '${ev.n.eventId}';
     update scores set released_at = released_at - interval '30 minutes' where event_id = '${ev.n.eventId}';
     update bulletins set published_at = published_at - interval '30 minutes' where event_id = '${ev.n.eventId}';`,
  );
  await screen(page);
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("takeover")).toHaveCount(0);
  await noTeamNames(page);

  // The step into AWARDS goes through the phase machine (no flag is open) and the awards take over live.
  await ev.n.advanceTo("AWARDS");
  await expect(page.getByRole("heading", { name: "Awards" })).toBeVisible({ timeout: 5000 });
  const name = (code: string) => ev.plan.teams.find((t) => t.code === code)!.name;
  const place = (track: string, n: number) => page.getByTestId(`awards-${track}-${n}`);
  await expect(page.getByTestId("awards-PRODUCT")).toContainText("Product");
  await expect(place("PRODUCT", 1)).toContainText(name(product[1]!));
  await expect(place("PRODUCT", 1)).toContainText("$734,130.00");
  await expect(place("PRODUCT", 1)).toContainText("+468.26%");
  await expect(place("PRODUCT", 2)).toContainText(name(product[0]!));
  await expect(place("PRODUCT", 2)).toContainText(name(product[2]!));
  await expect(place("PRODUCT", 3)).toHaveCount(0); // 1, 2, 2: no third place
  for (const [i, code] of [consulting[2]!, consulting[0]!, consulting[1]!].entries()) {
    await expect(place("CONSULTING", i + 1)).toContainText(name(code));
    await expect(place("CONSULTING", i + 1)).toContainText(code);
  }
  for (const [i, code] of [finance[0]!, finance[2]!, finance[1]!].entries()) {
    await expect(place("FINANCE", i + 1)).toContainText(name(code));
    await expect(place("FINANCE", i + 1)).toContainText(code);
  }
  await expect(place("CONSULTING", 3)).toContainText("−2%");

  const turnaround = page.getByTestId("awards-BEST_TURNAROUND");
  await expect(turnaround).toContainText("Best turnaround");
  await expect(turnaround).toContainText(name(s[0]!.p_code));
  await expect(turnaround).toContainText("EVA · Company 1");
  await expect(turnaround).toContainText("$8.93 after the crisis → $13.13 at the close (+47.03%)");
  const plan = page.getByTestId("awards-BEST_RESCUE_PLAN");
  await expect(plan).toContainText("Best rescue plan");
  await expect(plan).toContainText(name(s[1]!.p_code));
  await expect(plan).toContainText("Plan score 88 / 100");
  const fund = page.getByTestId("awards-BEST_JUDGING_FUND");
  await expect(fund).toContainText("Best judging fund");
  await expect(fund).toContainText(name(finance[1]!));
  await expect(fund).toContainText("$520,000.00 at AI prices (+4%)");

  // The awards stay up.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Awards" })).toBeVisible();
  await expect(place("PRODUCT", 1)).toContainText(name(product[1]!));
});
