import { expect, test, type Page } from "@playwright/test";
import { aiPrice, applyTier, closingPrice, crisisShock, divRoundHalfUp, formatCents, marketClose, sha256Hex, tierBp } from "@msim/engine";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn, seedOf } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's takeovers from the draw to the closing bell, on one event walked forward through the real game
// functions: the squad draw with the seed check (and never the seed), the pitch verdicts with the IPO prices, the
// crisis with every company's card, its price −15% and the seed reveal, the plan and flash verdicts with the risers
// and fallers, and the closing bell with each company's closing price. Each takeover arrives live, without a
// reload, and no team name is ever on the screen.

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 720 } });

let ev: E2eEvent;
let s: Awaited<ReturnType<typeof drawn>>;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: "e2e-display-takeovers", prefix: "U" });
});

const groups = (hex: string) => hex.match(/.{16}/g)!;

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

/** After the draw: every squad's pitch submitted, judged 60 (+5%, IPO $10.50) and released, as e2e/support/game.ts does. */
async function pitchesReleased() {
  await ev.n.advanceTo("BUILD");
  for (const [i, x] of s.entries()) {
    const p = ev.n.team(x.p_code);
    await ev.n.ok(p, "save_draft", "PITCH", {
      company_name: `Company ${i + 1}`,
      ticker: `EU${"ABC"[i]}`,
      problem: "Unsafe water in small towns.",
      solution: "Sensors in every tank.",
      customers: "Town councils.",
      business_model: "Yearly subscription.",
      advantage: "Cheaper than lab tests.",
      use_of_seed: "First 100 sensors.",
    }, 0);
    await ev.n.ok(p, "submit_submission", "PITCH");
  }
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  for (const x of s) await ev.n.judge(x.company_id, "PITCH", [60, 60, 60]);
  await ev.n.deadlinePassed("CALL_1");
  await ev.n.org("release_scores", ev.n.eventId, "PITCH");
}

test("the squad draw shows the commitment, the dice, the squads and the seed check, never the seed", async ({ page }) => {
  await screen(page);
  await expect(page.getByTestId("board")).toBeVisible();
  s = await drawn(ev);
  await expect(page.getByRole("heading", { name: "Squad draw" })).toBeVisible({ timeout: 5000 });

  const commitment = sha256Hex(seedOf(ev));
  await expect(page.getByTestId("draw-commitment-group")).toHaveText(groups(commitment));
  await expect(page.getByTestId("draw-dice")).toContainText("4");
  await expect(page.getByTestId("draw-squads")).toHaveText("3 squads");
  await expect(page.getByTestId("draw-check")).toHaveText("✓ SHA-256 of the secret seed matches the published commitment");
  const stage = page.getByTestId("stage");
  await expect(stage).toContainText(`/api/lottery-record?event=${ev.slug}`);
  await expect(stage).toContainText("pnpm verify-lottery");

  const text = await stage.innerText();
  for (const g of groups(seedOf(ev))) expect(text).not.toContain(g);
  await noTeamNames(page);
});

test("the pitch verdicts show every company's IPO price", async ({ page }) => {
  await screen(page);
  await pitchesReleased();
  await expect(page.getByRole("heading", { name: "Pitch scores: IPO prices are set" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("verdicts-listed")).toContainText("3");
  await expect(page.getByTestId("verdicts-range")).toContainText("$10.50");
  for (const t of ["EUA", "EUB", "EUC"]) {
    await expect(page.getByTestId(`verdicts-top-${t}`)).toContainText(t);
    await expect(page.getByTestId(`verdicts-top-${t}`)).toContainText("$10.50");
    await expect(page.getByTestId(`verdicts-top-${t}`)).toContainText("60");
  }
  await noTeamNames(page);
});

test("the crisis shows each company's card and its price −15%, and the seed reveal with the check", async ({ page }) => {
  await screen(page);
  await ev.n.advanceTo("IPO");
  await ev.n.advanceTo("ROUNDS_1_4");
  // Leaving rounds 1–4 clears them (nobody traded, so prices stay at $10.50); entering CRISIS draws the crisis.
  await ev.n.advanceTo("CRISIS");
  await expect(page.getByRole("heading", { name: "Crisis" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("crisis-headline")).toHaveText("Every company has been hit. All share prices fell 15%.");

  const cards = await ev.n.q<{ ticker: string; category: string }>(
    "select c.ticker, k.category from companies c join crisis_cards k on k.id = c.crisis_card_id where c.event_id = $1 order by c.ticker",
    [ev.n.eventId],
  );
  expect(cards.map((c) => c.ticker)).toEqual(["EUA", "EUB", "EUC"]);
  for (const c of cards) {
    const card = page.getByTestId(`crisis-${c.ticker}`);
    // 1050 × 0.85 = 892.5 → $8.93 (half-up).
    await expect(card).toContainText("$10.50 → $8.93");
    await expect(card).toContainText(c.category);
  }

  await expect(page.getByTestId("crisis-seed-value-group")).toHaveText(groups(seedOf(ev)));
  await expect(page.getByTestId("crisis-commitment-group")).toHaveText(groups(sha256Hex(seedOf(ev))));
  await expect(page.getByTestId("crisis-dice")).toHaveText("4");
  await expect(page.getByTestId("crisis-seed-check")).toHaveText("✓ SHA-256(seed) = commitment");
  await expect(page.getByTestId("crisis-record")).toHaveText(`http://127.0.0.1:3100/api/lottery-record?event=${ev.slug}`);
  await noTeamNames(page);

  // A reload in the middle of the crisis shows the same screen (everything comes from the database).
  await page.reload();
  await expect(page.getByTestId("crisis-seed-check")).toHaveText("✓ SHA-256(seed) = commitment");
  await expect(page.getByTestId("crisis-EUA")).toContainText("$8.93");
});

// ───────────── After the crisis: the plan and flash verdicts and the closing bell ─────────────

type Probe = Window & { __marker?: number };
/** Marks the page's window: still marked later means the screen changed without a reload. */
const markWindow = (page: Page) => page.evaluate(() => void ((window as Probe).__marker = 1));
const sameWindow = (page: Page) => page.evaluate(() => (window as Probe).__marker === 1);

/** Basis points as the screen writes a change: 2000 → "+20%", -1857 → "−18.57%", 0 → "0%". */
const pct = (b: number) => {
  if (b === 0) return "0%";
  const a = Math.abs(b) / 100;
  return `${b > 0 ? "+" : "−"}${Number.isInteger(a) ? a : a.toFixed(2).replace(/0$/, "")}%`;
};

/** Saves the squad's draft of a plan or flash answer (as its Product team) and submits it. */
async function submitWork(x: (typeof s)[number], type: "PLAN" | "FLASH") {
  const p = ev.n.team(x.p_code);
  const draft = await ev.n.one("select version from submission_drafts where squad_id = $1 and type = $2", [x.id, type]);
  const content =
    type === "FLASH"
      ? { answer: "Licensing is profitable by month 9 with no loans." }
      : {
          crisis: "The chip is unavailable for 18 months.",
          new_plan: "License the software.",
          money: "Costs $60,000.",
          deal: "$42,000 at $7.00.",
          time_to_recovery: "Nine months.",
          risks: "Partners may refuse.",
          next_steps: "Sign two partners.",
        };
  await ev.n.ok(p, "save_draft", type, content, draft.version);
  await ev.n.ok(p, "submit_submission", type);
}

interface TierMove {
  ticker: string;
  name: string;
  score: number;
  tier_bp: number;
  before: number;
  after: number;
  ai_before: number;
  ai_after: number;
}

/** The release's recorded price moves (PLAN_TIER or FLASH_TIER), each checked against the engine's tier rules. */
async function tierMoves(type: "PLAN" | "FLASH"): Promise<TierMove[]> {
  const rows = await ev.n.q<TierMove>(
    `select c.ticker, c.name, s.final_score as score, rp.tier_bp, rp.market_before as before, rp.market_after as after, rp.ai_before, rp.ai_after
       from round_prices rp join companies c on c.id = rp.company_id join scores s on s.company_id = c.id and s.type = $2
      where rp.event_id = $1 and rp.kind = $3 order by c.ticker`,
    [ev.n.eventId, type, `${type}_TIER`],
  );
  expect(rows.map((r) => r.ticker)).toEqual(["EUA", "EUB", "EUC"]);
  for (const r of rows) {
    expect(r.tier_bp, r.ticker).toBe(tierBp(type, r.score));
    expect(r.after, r.ticker).toBe(applyTier(r.before, r.tier_bp)); // half-up
    expect(r.ai_after, r.ticker).toBe(applyTier(r.ai_before, r.tier_bp));
  }
  return rows;
}

/**
 * The tier verdicts on the screen: the count up · unchanged · down, each riser and faller with its score, tier and
 * price before → after, and a 0% company in neither column.
 */
async function seeTierVerdicts(page: Page, rows: TierMove[]) {
  const up = rows.filter((r) => r.tier_bp > 0).length;
  const down = rows.filter((r) => r.tier_bp < 0).length;
  await expect(page.getByTestId("verdicts-summary")).toHaveText(
    `Every price moved by the company's tier: ${up} up · ${rows.length - up - down} unchanged · ${down} down`,
  );
  for (const r of rows) {
    const riser = page.getByTestId(`verdicts-risers-${r.ticker}`);
    const faller = page.getByTestId(`verdicts-fallers-${r.ticker}`);
    const line = `${r.ticker} ${r.name} ${r.score} ${pct(r.tier_bp)} ${formatCents(r.before)} → ${formatCents(r.after)}`;
    await expect(r.tier_bp > 0 ? riser : faller).toHaveCount(r.tier_bp === 0 ? 0 : 1);
    await expect(r.tier_bp > 0 ? faller : riser).toHaveCount(0);
    if (r.tier_bp !== 0) await expect(r.tier_bp > 0 ? riser : faller).toHaveText(line, { useInnerText: true });
  }
}

test("the plan verdicts show the risers and fallers with score, tier and price before → after, live", async ({ page }) => {
  // 03:30, through the real functions: EUA's deal is signed by all three teams and its plan judged 88; EUB's plan is
  // judged 78 but capped at 50 (no deal by 03:00): 0%, in neither column; EUC sends no plan and seal_missing_scores
  // gives it 0. Rounds 5–12 clear untraded on the way, so every price starts from the post-crisis price.
  test.setTimeout(150_000);
  await screen(page);
  await markWindow(page);
  const [a, b] = s;
  await ev.n.advanceTo("RESCUE_2");
  await ev.n.ok(ev.n.team(a.c_code), "edit_deal", null, 700);
  const deal = (await ev.n.ok(ev.n.team(a.f_code), "edit_deal", 4_200_000, null)).deal;
  for (const code of [a.p_code, a.c_code, a.f_code]) await ev.n.ok(ev.n.team(code), "sign_deal", deal.version);
  await submitWork(a, "PLAN");
  await submitWork(b, "PLAN");
  await ev.n.deadlinePassed("PLAN");
  await ev.n.deadlinePassed("DEAL");
  await ev.n.advanceTo("PLANS_PUBLISHED");
  expect(await ev.n.judge(a.company_id, "PLAN", [88, 88, 88])).toMatchObject({ ok: true, final: 88, capped: false });
  expect(await ev.n.judge(b.company_id, "PLAN", [78, 78, 78])).toMatchObject({ ok: true, final: 50, capped: true });
  expect(await ev.n.org("seal_missing_scores", ev.n.eventId, "PLAN")).toMatchObject({ sealed_missing: 1 });
  await ev.n.advanceTo("VERDICTS");
  await expect(page.getByRole("heading", { name: "Rescue plan verdicts" })).toHaveCount(0);

  await ev.n.org("release_scores", ev.n.eventId, "PLAN");
  await expect(page.getByRole("heading", { name: "Rescue plan verdicts" })).toBeVisible({ timeout: 10_000 });
  const rows = await tierMoves("PLAN");
  expect(rows.map((r) => r.score)).toEqual([88, 50, 0]);
  expect(rows.map((r) => Math.sign(r.tier_bp))).toEqual([1, 0, -1]); // a riser, an unchanged company and a faller
  for (const r of rows) expect(r.before, r.ticker).toBe(crisisShock(1050)); // $10.50 IPO −15%, untraded since
  await seeTierVerdicts(page, rows);
  await noTeamNames(page);
  expect(await sameWindow(page)).toBe(true); // live: no reload
});

test("the flash verdicts after round 17 show the risers and fallers, live", async ({ page }) => {
  // 04:20: trading reopens, the flash news is published (its takeover first), every squad answers and the answers
  // are judged 80, 30 and 60; rounds 13–17 clear untraded, and the release after round 17 moves both prices.
  test.setTimeout(150_000);
  await screen(page);
  await markWindow(page);
  await ev.n.advanceTo("ROUNDS_13_21");
  await ev.n.org("prepare_flash_bulletin", ev.n.eventId, "Interest rates rise", "Investors want a path to profit within 12 months.");
  await ev.n.org("publish_flash_bulletin", ev.n.eventId);
  await expect(page.getByRole("heading", { name: "Flash news" })).toBeVisible({ timeout: 10_000 });
  for (const x of s) await submitWork(x, "FLASH");
  await ev.n.deadlinePassed("FLASH");
  for (let r = 13; r <= 17; r++) {
    await ev.n.openRound(r);
    await ev.n.clearRound(r);
  }
  for (const [i, total] of [80, 30, 60].entries()) {
    expect(await ev.n.judge(s[i].company_id, "FLASH", [total, total, total])).toMatchObject({ ok: true, final: total });
  }
  await expect(page.getByRole("heading", { name: "Flash verdicts" })).toHaveCount(0);

  await ev.n.org("release_scores", ev.n.eventId, "FLASH");
  await expect(page.getByRole("heading", { name: "Flash verdicts" })).toBeVisible({ timeout: 10_000 });
  const rows = await tierMoves("FLASH");
  expect(rows.map((r) => Math.sign(r.tier_bp))).toEqual([1, -1, 0]);
  // Each moved from where the plan tier left it (rounds 13–17 were untraded).
  const plan = await tierMoves("PLAN");
  for (const [i, r] of rows.entries()) expect(r.before, r.ticker).toBe(plan[i]!.after);
  await seeTierVerdicts(page, rows);
  await noTeamNames(page);
  expect(await sameWindow(page)).toBe(true);
});

test("the closing bell shows each company's closing price and its change since the IPO, live", async ({ page }) => {
  // 05:00: rounds 18–21 clear through the tick, with trades in rounds 20 and 21 so EUA's and EUB's market prices move
  // away from their AI prices (EUC is untraded); the step into CLOSE runs close_market. Market close = (round 20 +
  // round 21) ÷ 2 and closing price = (market close + AI price) ÷ 2, both half-up; the change is in bp, half-up.
  test.setTimeout(150_000);
  await screen(page);
  await markWindow(page);
  const [a, b, c] = s;
  for (const r of [18, 19]) {
    await ev.n.openRound(r);
    await ev.n.clearRound(r);
  }
  await ev.n.openRound(20);
  await ev.n.orderNet(a.company_id, 5000, [b.f_code, c.f_code]); // +5%
  await ev.n.orderNet(b.company_id, 2000, [a.f_code, c.f_code]); // +2%
  await ev.n.clearRound(20);
  await ev.n.openRound(21);
  await ev.n.orderNet(a.company_id, -3000, [b.f_code, c.f_code]); // −3%
  await ev.n.orderNet(b.company_id, -1000, [a.f_code, c.f_code]); // −1%
  await ev.n.clearRound(21);
  await expect(page.getByRole("heading", { name: "Closing bell" })).toHaveCount(0);

  await ev.n.advanceTo("CLOSE");
  await expect(page.getByRole("heading", { name: "Closing bell" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("closing-headline")).toHaveText("The market is closed");

  const rows = await ev.n.q<{ ticker: string; name: string; ipo: number; r20: number; r21: number; ai: number; market: number; closing: number }>(
    `select c.ticker, c.name, c.ipo_price as ipo, c.ai_price as ai, c.closing_market_price as market, c.closing_price as closing,
            (select rp.market_after from round_prices rp join rounds r on r.id = rp.round_id where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 20) as r20,
            (select rp.market_after from round_prices rp join rounds r on r.id = rp.round_id where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 21) as r21
       from companies c where c.event_id = $1 and c.ticker is not null order by c.ticker`,
    [ev.n.eventId],
  );
  expect(rows.map((r) => r.ticker)).toEqual(["EUA", "EUB", "EUC"]);
  const plan = await tierMoves("PLAN");
  const flash = await tierMoves("FLASH");
  const closing = rows.map((r, i) => {
    // The AI price ignores trading: IPO −15%, then the plan and flash tiers.
    expect(r.ai, r.ticker).toBe(aiPrice(r.ipo, plan[i]!.tier_bp, flash[i]!.tier_bp));
    expect(r.market, r.ticker).toBe(marketClose(r.r20, r.r21));
    expect(r.closing, r.ticker).toBe(closingPrice(marketClose(r.r20, r.r21), r.ai));
    return { ...r, changeBp: divRoundHalfUp((r.closing - r.ipo) * 10_000, r.ipo) };
  });
  expect(closing[0]!.market).not.toBe(closing[0]!.ai); // EUA's trades moved its market price away from the AI price
  expect(closing[1]!.market).not.toBe(closing[1]!.ai);
  expect(closing.map((r) => Math.sign(r.changeBp))).toEqual([1, -1, -1]);

  for (const r of closing) {
    const id = `closing-${r.changeBp > 0 ? "gainers" : "losers"}-${r.ticker}`;
    await expect(page.getByTestId(id)).toHaveText(`${r.ticker} ${r.name} ${formatCents(r.ipo)} → ${formatCents(r.closing)} ${pct(r.changeBp)}`, {
      useInnerText: true,
    });
  }
  // The biggest fall first.
  const losers = closing.filter((r) => r.changeBp < 0).sort((x, y) => x.changeBp - y.changeBp);
  await expect(page.getByTestId("closing-losers").locator("[data-testid^=closing-losers-]")).toHaveText(
    losers.map((r) => new RegExp(`^${r.ticker}`)),
  );
  await expect(page.getByTestId("closing-gainers").locator("[data-testid^=closing-gainers-]")).toHaveCount(1);
  await expect(page.getByTestId("closing-awards")).toHaveText("Final results are announced at the awards.");
  await noTeamNames(page);
  expect(await sameWindow(page)).toBe(true);
});
