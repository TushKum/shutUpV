import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { CARDS_PER_PAGE, renderLoginCards, toWinAnsi } from "../lib/cards";
import { buildSeedPlan } from "../lib/seed-plan";

const plan = buildSeedPlan({
  slug: "live-2026",
  name: "Market Simulation 2026",
  rehearsal: false,
  clockSpeed: 1,
  startsAt: new Date("2026-11-14T14:30:00Z"),
  teamsPerTrack: 50,
  cardSecret: "test-secret-0123456789",
  emailDomain: "teams.example.org",
});

const cards = plan.teams.map((t) => ({ code: t.code, password: t.password, track: t.track, teamName: t.name }));

test("150 cards print on 19 A4 pages, 8 per page", async () => {
  const bytes = await renderLoginCards(cards, { eventName: plan.event.name, loginUrl: "https://msim.example.org/login" });
  const doc = await PDFDocument.load(bytes);
  expect(CARDS_PER_PAGE).toBe(8);
  expect(doc.getPageCount()).toBe(19);
  const { width, height } = doc.getPage(0).getSize();
  expect(Math.round(width)).toBe(595);
  expect(Math.round(height)).toBe(842);

  const dir = mkdtempSync(join(tmpdir(), "cards-"));
  const file = join(dir, "cards.pdf");
  writeFileSync(file, bytes);
  // When poppler is installed, check that the code and password are really on the page.
  if (existsSync("/usr/bin/pdftotext")) {
    const text = execFileSync("pdftotext", ["-f", "1", "-l", "1", file, "-"], { encoding: "utf8" });
    expect(text).toContain("P01");
    expect(text).toContain(cards[0]!.password);
    expect(text).toContain("PRODUCT TEAM");
  }
});

test("names outside the PDF font's character set never break printing", async () => {
  expect(toWinAnsi("Café ☕ 東京")).toBe("Café ? ??");
  const bytes = await renderLoginCards([{ ...cards[0]!, teamName: "Équipe 東京 🚀 with a very very long name indeed" }], {
    eventName: "Test",
    loginUrl: "https://x.org/login",
    rehearsal: true,
  });
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
});
