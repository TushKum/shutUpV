import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { CARDS_PER_PAGE, parseStaffLogins, renderLoginCards, renderStaffLogins, toWinAnsi } from "../lib/cards";
import { buildSeedPlan } from "../lib/seed-plan";

const plan = buildSeedPlan({
  slug: "primus-2026",
  name: "PRIMUS",
  rehearsal: false,
  clockSpeed: 1,
  startsAt: new Date("2026-11-20T14:30:00Z"),
  teamCount: 150,
  cardSecret: "test-secret-0123456789",
  emailDomain: "teams.example.org",
});

const cards = plan.teams.map((t) => ({ code: t.code, password: t.password, teamName: t.name }));

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
    expect(text).toContain("T001");
    expect(text).toContain(cards[0]!.password);
    expect(text).toContain("TEAM CARD");
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

test("staff logins: parsed from the seed's text file, one slip each, 8 to an A4 page, organisers first", async () => {
  const text = "FAIRNESS  f@x.org  AAAA-BBBB-CCCC\nORGANISER lead@x.org  DDDD-EEEE-FFFF\n\nDISPLAY   d@x.org  GGGG-HHHH-JJJJ\n";
  const staff = parseStaffLogins(text);
  expect(staff).toEqual([
    { role: "FAIRNESS", email: "f@x.org", password: "AAAA-BBBB-CCCC" },
    { role: "ORGANISER", email: "lead@x.org", password: "DDDD-EEEE-FFFF" },
    { role: "DISPLAY", email: "d@x.org", password: "GGGG-HHHH-JJJJ" },
  ]);
  expect(() => parseStaffLogins("ORGANISER only-two")).toThrow(/not a staff login line/);
  const one = await PDFDocument.load(await renderStaffLogins(staff, { eventName: "PRIMUS", loginUrl: "https://x.example/login" }));
  expect(one.getPageCount()).toBe(1);
  const many = Array.from({ length: 9 }, (_, i) => ({ role: "ORGANISER", email: `o${i}@x.org`, password: "AAAA-BBBB-CCCC" }));
  const two = await PDFDocument.load(await renderStaffLogins(many, { eventName: "PRIMUS", loginUrl: "https://x.example/login" }));
  expect(two.getPageCount()).toBe(2);
});
