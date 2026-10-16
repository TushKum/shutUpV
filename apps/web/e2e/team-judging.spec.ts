// Every track can read the published prompts, verify their exact hashes and use the page on a phone.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsTeam } from "./support/login";

let ev: E2eEvent;
const prompts = ["PITCH", "PLAN", "FLASH"].map((type) => {
  const text = readFileSync(join(__dirname, "../../../prompts", `${type}.md`), "utf8");
  return { type, text, sha: createHash("sha256").update(text, "utf8").digest("hex") };
});

test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-team-judging", prefix: "Q", squads: 3 });
});

for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
  test(`${track} has the Judging tab, exact prompt hashes and rendered Markdown without overflow at 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const team = ev.plan.teams.find((t) => t.track === track)!;
    await loginAsTeam(page, ev, team.code);
    await page.getByRole("link", { name: "Judging", exact: true }).click();
    await expect(page).toHaveURL(/\/team\/judging$/);
    await expect(page.getByRole("heading", { name: "How the judge scores", exact: true })).toBeVisible();
    for (const { type, text, sha } of prompts) {
      const panel = page.getByTestId(`judging-prompt-${type}`);
      await expect(panel.getByTestId(`prompt-sha-${type}`)).toHaveText(sha);
      // Real HTML headings, lists and rubric tables, rather than a raw Markdown document.
      await expect(panel.getByRole("heading", { name: text.split("\n")[0]!.replace(/^# /, ""), exact: true })).toBeVisible();
      await expect(panel.locator("table")).toBeVisible();
      expect(await panel.locator("ul li, ol li").count()).toBeGreaterThan(0);
      await expect(panel.locator("table code").first()).toBeVisible();
      const raw = panel.locator("details");
      await raw.locator("summary").click();
      expect(await raw.locator("pre").textContent()).toBe(text);
      const download = panel.getByRole("link", { name: `Download ${type}.md`, exact: true });
      expect(decodeURIComponent((await download.getAttribute("href"))!.split(",").slice(1).join(","))).toBe(text);
    }
    // Rubric tables may scroll inside their frames, but neither formatted nor expanded raw text widens the page.
    expect(await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))).toEqual({ page: 390, viewport: 390 });
  });
}
