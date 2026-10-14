import { expect, test, type Page } from "@playwright/test";
import { sha256Hex } from "@msim/engine";
import { seedE2eEvent, STAFF, type E2eEvent } from "./support/event";
import { drawn, seedOf } from "./support/game";
import { loginAsStaff } from "./support/login";

// The big screen's takeovers from the draw to the crisis, on one event walked forward through the real game
// functions: the squad draw with the seed check (and never the seed), the pitch verdicts with the IPO prices, and the
// crisis with every company's card, its price −15% and the seed reveal. Each takeover arrives live, without a
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
