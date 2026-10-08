import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "@msim/engine";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsStaff } from "./support/login";

test.describe.configure({ mode: "serial" });

// Four squads, played to settlement: round 1 has two trades, the fees default, no deal is signed, no plan or flash
// answer is submitted (so every plan scores 0). Flags exist only after settlement; the game raised none here, so the
// three below are inserted directly (test only), one of each kind.
let ev: E2eEvent;
let s: Awaited<ReturnType<typeof trading>>;
const ticker = (i: number) => `EN${"ABCD"[i]}`;

async function settle(ev: E2eEvent) {
  const n = ev.n;
  await n.advanceTo("CRISIS");
  await n.advanceTo("RESCUE_1");
  await n.deadlinePassed("FEE");
  await n.ok(n.lead, "tick", n.eventId); // the default fee of $22,500 for every squad
  await n.advanceTo("RESCUE_2");
  await n.deadlinePassed("PLAN");
  await n.deadlinePassed("DEAL");
  await n.advanceTo("PLANS_PUBLISHED");
  await n.org("seal_missing_scores", n.eventId, "PLAN");
  await n.advanceTo("VERDICTS");
  await n.org("release_scores", n.eventId, "PLAN");
  await n.advanceTo("ROUNDS_13_21");
  for (const r of [13, 14, 15, 16, 17]) {
    await n.openRound(r);
    await n.clearRound(r); // flash scores are released after round 17 clears
  }
  await n.deadlinePassed("FLASH");
  await n.org("seal_missing_scores", n.eventId, "FLASH");
  await n.org("release_scores", n.eventId, "FLASH");
  await n.advanceTo("SETTLEMENT");
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  ev = await seedE2eEvent({ slug: "e2e-fairness", prefix: "N", squads: 4 });
  s = await trading(ev);
  await ev.n.openRound(1);
  await ev.n.ok(ev.n.team(s[0]!.f_code), "place_order", s[1]!.company_id, "BUY", 100);
  await ev.n.ok(ev.n.team(s[1]!.f_code), "place_order", s[2]!.company_id, "BUY", 200);
  await ev.n.clearRound(1);
  await settle(ev);
  expect(Number((await ev.n.one("select count(*)::int as n from flags where event_id = $1", [ev.n.eventId])).n)).toBe(0);

  const id = (code: string) => ev.n.teamId(code);
  const post = (await ev.n.one("select post_crisis_price from companies where id = $1", [s[3]!.company_id])).post_crisis_price as number;
  await ev.n.q(
    `insert into flags (event_id, kind, company_id, team_ids, details, created_at) values
       ($1, 1, $2, $3, $4, now() - interval '3 minutes'),
       ($1, 2, null, $5, $6, now() - interval '2 minutes'),
       ($1, 3, $7, $8, $9, now() - interval '1 minute')`,
    [
      ev.n.eventId,
      s[0]!.company_id,
      [id(s[0]!.p_code), id(s[1]!.f_code), id(s[2]!.f_code), id(s[3]!.f_code)],
      { plan_score: 45, funds_at_cap: 3, ticker: ticker(0) },
      [id(s[1]!.f_code), id(s[2]!.f_code)],
      { cosine: 0.95, orders: [6, 5] },
      s[3]!.company_id,
      [id(s[3]!.p_code), id(s[3]!.c_code), id(s[3]!.f_code)],
      { plan_score: 0, fee_value: 3400000, deal_price: 450, post_crisis_price: post, ticker: ticker(3) },
    ],
  );
});

const panel = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const flagCard = (page: Page, n: number) => panel(page, "Collusion flags").getByRole("listitem", { name: `Flag ${n}`, exact: true });

test("organisers see only that flags are the fairness officer's", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/fairness`);
  await expect(page.getByText("Collusion flags, their decisions and the team drill-down are for the fairness officer only.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collusion flags" })).toHaveCount(0);
  await expect(page.getByText(ticker(3))).toHaveCount(0);
});

test("the fairness officer sees each flag explained: kind, company, teams and details", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/fairness`);
  await expect(page.getByTestId("flag-summary")).toHaveText("3 flags: 3 open, 0 cleared, 0 disqualified.");

  const one = flagCard(page, 1);
  await expect(one).toContainText("Flag 1Funds at the cap of a weak companyOpen");
  await expect(one).toContainText("A company whose plan scored below 50 where 3 or more funds hold the 4,000-share long cap.");
  await expect(one).toContainText(`Company${ticker(0)}`);
  await expect(one).toContainText(`Teams${s[0]!.p_code} (Product)${s[1]!.f_code} (Finance)${s[2]!.f_code} (Finance)${s[3]!.f_code} (Finance)`);
  await expect(one).toContainText("Plan score45Funds at the 4,000-share cap3");

  const two = flagCard(page, 2);
  await expect(two).toContainText("Funds trading alike");
  await expect(two).toContainText("cosine similarity ≥ 0.9, with at least 5 orders each");
  await expect(two).not.toContainText("Company");
  await expect(two).toContainText(`Cosine similarity0.950Filled orders${s[1]!.f_code}: 6 · ${s[2]!.f_code}: 5`);

  const three = flagCard(page, 3);
  const post = (await ev.n.one("select post_crisis_price from companies where id = $1", [s[3]!.company_id])).post_crisis_price as number;
  await expect(three).toContainText("Generous rescue terms");
  await expect(three).toContainText(`Company${ticker(3)}`);
  await expect(three).toContainText(`Teams${s[3]!.p_code} (Product)${s[3]!.c_code} (Consulting)${s[3]!.f_code} (Finance)`);
  await expect(three).toContainText("Fee value$34,000.00 (≥ $33,000)");
  await expect(three).toContainText(`Deal price$4.50, ${(Math.round((450 * 1000) / post) / 10).toFixed(1)}% of the post-crisis price ${formatCents(post)}`);
  await expect(panel(page, "Decisions")).toContainText("No decisions yet.");
});

test("decisions: the database refuses a short reason; clear, disqualify, change; every decision is logged", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/fairness`);

  // Flag 2: a reason under 5 characters is refused by decide_flag, and the form keeps what was typed.
  let two = flagCard(page, 2);
  await two.getByLabel("Clear the flag").check();
  await two.getByLabel("Reason (at least 5 characters; logged)").fill("ok");
  await two.getByRole("button", { name: "Record decision" }).click();
  await two.getByRole("button", { name: "Click again to record the decision" }).click();
  await expect(two.getByRole("alert")).toHaveText("Refused: give a reason (at least 5 characters)");
  await two.getByLabel("Reason (at least 5 characters; logged)").fill("Same news, same trades, no contact");
  await two.getByRole("button", { name: "Record decision" }).click();
  await two.getByRole("button", { name: "Click again to record the decision" }).click();
  await expect(page.getByTestId("flag-summary")).toHaveText("3 flags: 2 open, 1 cleared, 0 disqualified.");
  // Decided flags move below the open ones.
  const cleared = flagCard(page, 3);
  await expect(cleared).toContainText("Funds trading alike");
  await expect(cleared).toContainText("Cleared by Fairness officer at");
  await expect(cleared).toContainText("“Same news, same trades, no contact”");

  // Flag 3 (now second): disqualify the squad's three teams.
  const squad = [s[3]!.p_code, s[3]!.c_code, s[3]!.f_code];
  two = flagCard(page, 2);
  await expect(two).toContainText("Generous rescue terms");
  await two.getByLabel(`Disqualify ${squad.join(", ")}`).check();
  await two.getByLabel("Reason (at least 5 characters; logged)").fill("Fee agreed to move cash to the advisor");
  await two.getByRole("button", { name: "Record decision" }).click();
  await two.getByRole("button", { name: "Click again to record the decision" }).click();
  await expect(page.getByTestId("flag-summary")).toHaveText("3 flags: 1 open, 1 cleared, 1 disqualified.");
  const teams = await ev.n.q("select code, disqualified, disqualified_reason from teams where event_id = $1 and disqualified order by code", [ev.n.eventId]);
  expect(teams.map((t) => t.code)).toEqual([...squad].sort());
  expect(teams.every((t) => t.disqualified_reason === "Fee agreed to move cash to the advisor")).toBe(true);
  const ineligible = await ev.n.q("select t.code from results r join teams t on t.id = r.team_id where r.event_id = $1 and not r.eligible order by t.code", [
    ev.n.eventId,
  ]);
  expect(ineligible.map((r) => r.code)).toEqual([...squad].sort());

  // A decision can be changed before the awards (a mis-click): clear, then disqualify again.
  let decided = panel(page, "Collusion flags").getByRole("listitem").filter({ hasText: "Generous rescue terms" });
  await decided.getByText("Change the decision").click();
  await decided.getByLabel("Clear the flag").check();
  await decided.getByLabel("Reason (at least 5 characters; logged)").fill("Wrong flag, my mistake");
  await decided.getByRole("button", { name: "Change decision" }).click();
  await decided.getByRole("button", { name: "Click again to record the decision" }).click();
  await expect(page.getByTestId("flag-summary")).toHaveText("3 flags: 1 open, 2 cleared, 0 disqualified.");
  expect((await ev.n.q("select 1 from teams where event_id = $1 and disqualified", [ev.n.eventId])).length).toBe(0);
  decided = panel(page, "Collusion flags").getByRole("listitem").filter({ hasText: "Generous rescue terms" });
  await decided.getByText("Change the decision").click();
  await decided.getByLabel(`Disqualify ${squad.join(", ")}`).check();
  await decided.getByLabel("Reason (at least 5 characters; logged)").fill("Fee agreed to move cash to the advisor");
  await decided.getByRole("button", { name: "Change decision" }).click();
  await decided.getByRole("button", { name: "Click again to record the decision" }).click();
  await expect(page.getByTestId("flag-summary")).toHaveText("3 flags: 1 open, 1 cleared, 1 disqualified.");

  const log = panel(page, "Decisions").locator("tbody tr");
  await expect(log).toHaveCount(4);
  const pair = `${s[1]!.f_code}, ${s[2]!.f_code}`;
  const expected = [
    ["Fairness officer", `Flag 3 · ${ticker(3)}`, "Disqualified", "Fee agreed to move cash to the advisor"],
    ["Fairness officer", `Flag 3 · ${ticker(3)}`, "Cleared", "Wrong flag, my mistake"],
    ["Fairness officer", `Flag 3 · ${ticker(3)}`, "Disqualified", "Fee agreed to move cash to the advisor"],
    ["Fairness officer", `Flag 2 · ${pair}`, "Cleared", "Same news, same trades, no contact"],
  ];
  for (const [i, row] of expected.entries()) await expect(log.nth(i).getByRole("cell")).toHaveText([/\d\d:\d\d$/, ...row]);
});

test("the drill-down per team: holdings by lot, orders, ledger rows, calls, result and disqualified status", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/fairness`);
  const drill = panel(page, "Team drill-down");

  // A fund: its squad lot (seed), the IPO-free buy of round 1, every order and ledger row, and its settled result.
  const fund = s[0]!.f_code;
  await drill.getByLabel("Team code").selectOption(fund);
  await drill.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(new RegExp(`team=${fund}`));
  const d = page.getByTestId("drill-down");
  await expect(d).toContainText(`${fund}`);
  await expect(d).toContainText("Not disqualified");
  const holdings = d.getByRole("region", { name: "Holdings by lot" }).locator("tbody tr");
  await expect(holdings).toHaveCount(2);
  await expect(holdings.nth(0).getByRole("cell")).toHaveText([ticker(0), "SQUAD", "5,000", "$50,000.00"]);
  await expect(holdings.nth(1).getByRole("cell").nth(0)).toHaveText(ticker(1));
  await expect(holdings.nth(1).getByRole("cell").nth(1)).toHaveText("EXCHANGE");
  await expect(holdings.nth(1).getByRole("cell").nth(2)).toHaveText("100");
  const fill = (await ev.n.one("select fill_price from orders where team_id = $1", [ev.n.teamId(fund)])).fill_price as number;
  const orders = d.getByRole("region", { name: "Orders" }).locator("tbody tr");
  await expect(orders).toHaveCount(1);
  await expect(orders.first().getByRole("cell")).toHaveText(["1", ticker(1), "BUY", "100", "FILLED", "$10.50", formatCents(fill), /\d\d:\d\d:\d\d/]);
  const ledgerCount = Number((await ev.n.one("select count(*)::int as n from ledger_entries where team_id = $1", [ev.n.teamId(fund)])).n);
  await expect(d.getByRole("region", { name: "Ledger rows" }).locator("tbody tr")).toHaveCount(ledgerCount);
  await expect(d.getByRole("region", { name: "Ledger rows" }).locator("tbody tr").last().getByRole("cell").nth(2)).toHaveText("Starting cash");
  const result = await ev.n.one("select final_value_cents, rank from results where team_id = $1", [ev.n.teamId(fund)]);
  await expect(d).toContainText(`Final value${formatCents(Number(result.final_value_cents))}`);
  await expect(d).toContainText(`Rank${result.rank}`);
  await expect(d.getByRole("region", { name: "Consultant calls" })).toHaveCount(0);

  // A consultant of the disqualified squad: its calls (none made, judged wrong), the fee, and why it is disqualified.
  const consultant = s[3]!.c_code;
  await drill.getByLabel("Team code").selectOption(consultant);
  await drill.getByRole("button", { name: "Show" }).click();
  await expect(d).toContainText(consultant);
  await expect(d).toContainText("Disqualified: Fee agreed to move cash to the advisor");
  await expect(d).toContainText("RankNot ranked (disqualified)");
  await expect(d).toContainText(`Flag 3 · ${ticker(3)}Disqualified`);
  const calls = d.getByRole("region", { name: "Consultant calls" }).locator("tbody tr");
  await expect(calls).toHaveCount(6);
  await expect(calls.first().getByRole("cell").nth(2)).toHaveText("No call");
  await expect(calls.first().getByRole("cell").nth(6)).toHaveText("Wrong");
  await expect(d.getByRole("region", { name: "Orders" })).toHaveCount(0);
  await expect(d.getByRole("region", { name: "Ledger rows" })).toContainText("Default fee");
  await d.getByRole("link", { name: "Open in the ledger" }).click();
  await expect(page).toHaveURL(new RegExp(`/ledger\\?team=${consultant}$`));
});
